import { store } from '../index';
import { LocalStorageManager } from '../utils/LocalStorageManager';
import { IndexedDBManager, StoredProjectData } from '../utils/IndexedDBManager';
import { updateLanguage, updateZoom, updateImageDragModeStatus, updateSmartAnnotationActiveStatus } from '../store/general/actionCreators';
import { updateActiveImageIndex, updateActiveLabelType, updateLabelNames, updateImageDataById, addImageData, updateImageData } from '../store/labels/actionCreators';
import { updateSegmentationResults } from '../store/ai/actionCreators';
import { updateVideoMode, addVideoData } from '../store/video/actionCreators';
import { addQueueItems, setActiveQueueItem } from '../store/queue/actionCreators';
import {QueueDataSyncStatus, QueueItem} from '../store/queue/types';
import { VideoData } from '../store/video/types';
import { ImageData, LabelName } from '../store/labels/types';
import { ImageRepository } from '../logic/imageRepository/ImageRepository';
import { LabelType } from '../data/enums/LabelType';

export class ProjectRestoreService {
    public static normalizeQueueItems(queueItems: QueueItem[]): QueueItem[] {
        return queueItems.map(item => item.dataSyncStatus === QueueDataSyncStatus.SYNCING
            ? {
                ...item,
                dataSyncStatus: QueueDataSyncStatus.ERROR,
                dataSyncError: '上次同步被中断，请重试 / Previous sync was interrupted; retry.',
            }
            : item
        );
    }

    
    public static async checkForStoredData(): Promise<{
        hasSettings: boolean;
        hasProject: boolean;
        lastSaved: number;
        projectName?: string;
        imageCount?: number;
        validImageCount?: number;
        labelCount?: number;
        isVideoProject?: boolean;
    }> {
        const hasSettings = LocalStorageManager.hasStoredSettings();
        const lastSaved = LocalStorageManager.getLastSavedTime();
        const projectName = hasSettings ? LocalStorageManager.getSettings().projectName : undefined;
        const meta = await IndexedDBManager.getProjectMeta();
        const hasProject = meta !== null && meta.validImageCount > 0;

        return {
            hasSettings,
            hasProject,
            lastSaved,
            projectName,
            imageCount: meta?.imageCount,
            validImageCount: meta?.validImageCount,
            labelCount: meta?.labelCount,
            isVideoProject: meta?.isVideoProject,
        };
    }
    
    public static async restoreSettings(): Promise<boolean> {
        try {
            const settings = LocalStorageManager.getSettings();
            
            if (settings.lastSaved === 0) {
                console.log('没有存储的设置需要恢复');
                return false;
            }
            
            // 恢复Redux状态
            store.dispatch(updateLanguage(settings.language));
            store.dispatch(updateZoom(settings.zoom));
            store.dispatch(updateImageDragModeStatus(settings.imageDragMode));
            store.dispatch(updateSmartAnnotationActiveStatus(settings.smartAnnotationActive));
            store.dispatch(updateActiveImageIndex(settings.currentImageIndex));
            store.dispatch(updateActiveLabelType(settings.activeLabelType as LabelType));
            
            console.log('设置恢复成功');
            return true;
        } catch (error) {
            console.error('恢复设置失败:', error);
            return false;
        }
    }
    
    public static async restoreProject(onProgress?: (msg: string) => void): Promise<boolean> {
        try {
            const storedProject = await IndexedDBManager.loadProject();

            if (!storedProject || storedProject.images.length === 0) {
                console.log('没有存储的项目需要恢复');
                return false;
            }

            // 恢复标签名称
            onProgress?.('正在恢复标签信息...');
            if (storedProject.labelNames.length > 0) {
                store.dispatch(updateLabelNames(storedProject.labelNames));
            }

            // 恢复队列数据
            onProgress?.('正在恢复队列数据...');
            if (storedProject.queueItems && storedProject.queueItems.length > 0) {
                const restoredQueueItems = this.normalizeQueueItems(storedProject.queueItems);
                store.dispatch(addQueueItems(restoredQueueItems));
                if (storedProject.activeQueueItemId) {
                    store.dispatch(setActiveQueueItem(storedProject.activeQueueItemId));
                    ImageRepository.setActiveFileId(storedProject.activeQueueItemId);
                }
                console.log('队列数据恢复成功:', {
                    队列项数量: storedProject.queueItems.length,
                    活动队列项ID: storedProject.activeQueueItemId
                });
            }

            // 恢复图像数据 - 过滤 0 字节条目（视频按需加载模式的空占位帧）
            const validStoredImages = storedProject.images.filter(img => img.fileData?.byteLength > 0);
            onProgress?.(`正在恢复图像数据 (${validStoredImages.length} 张)...`);
            const restoredImages: ImageData[] = validStoredImages.map((storedImage): ImageData => ({
                id: storedImage.id,
                fileData: new File([storedImage.fileData], storedImage.fileName, { type: storedImage.fileType || '' }),
                loadStatus: false, // 重要：设置为false让ImagePreview重新加载
                labelRects: storedImage.labelRects || [],
                labelPoints: storedImage.labelPoints || [],
                labelLines: storedImage.labelLines || [],
                labelPolygons: storedImage.labelPolygons || [],
                labelNameIds: storedImage.labelNameIds || [],
                // 添加AI相关的默认字段
                isVisitedByRoboflowAPI: false
            }));
            
            // 替换图像数据（不是追加）
            store.dispatch(updateImageData(restoredImages));

            // 恢复AI推理结果
            if (storedProject.segmentationResults && storedProject.segmentationResults.length > 0) {
                store.dispatch(updateSegmentationResults(storedProject.segmentationResults));
                console.log('全局推理结果已恢复:', storedProject.segmentationResults.length, '个结果');
            }

            // 恢复按图像ID存储的推理结果
            if (storedProject.imageSegmentationResults) {
                Object.entries(storedProject.imageSegmentationResults).forEach(([imageId, results]) => {
                    store.dispatch(updateSegmentationResults(results, imageId));
                });
                console.log('按图像存储的推理结果已恢复:', Object.keys(storedProject.imageSegmentationResults).length, '张图像');
            }

            // 检测是否为视频项目
            // 优先使用 isVideoProject 标记（v1.8.5+），回退到文件名/MIME 推断
            const firstFile = restoredImages[0]?.fileData;
            const isVideoProject = storedProject.isVideoProject || (firstFile && (
                firstFile.type.startsWith('video/') ||
                /\.(mp4|webm|mov|avi|mkv|m4v|ogg)$/i.test(firstFile.name)
            ));

            if (isVideoProject) {
                onProgress?.('正在恢复视频帧...');
                const meta = storedProject.extractionMetadata;
                // 从恢复的 ImageData 重建 preExtractedFrames（每帧就是一个小 JPEG File）
                const preExtractedFrames = restoredImages.map(img => img.fileData);

                const videoData: VideoData = {
                    id: restoredImages[0].id.split('-')[0] || restoredImages[0].id,
                    fileData: firstFile,
                    loadStatus: !!meta,
                    duration: meta?.duration || 0,
                    fps: meta?.fps || (console.warn('[ProjectRestore] fps 缺失，使用默认值 30'), 30),
                    totalFrames: meta?.totalFrames || restoredImages.length,
                    videoSize: meta
                        ? { width: meta.width, height: meta.height }
                        : { width: 0, height: 0 },
                    currentFrame: 0,
                    currentTime: 0,
                    isPlaying: false,
                    frames: new Map(),
                    preExtractedFrames,
                };
                store.dispatch(updateVideoMode(true));
                store.dispatch(addVideoData(videoData));
                ImageRepository.setActiveFileId(videoData.id);
                console.log('检测到视频项目，已恢复视频模式（含预拆帧）', {
                    frames: restoredImages.length,
                    hasMetadata: !!meta,
                    fps: videoData.fps
                });
            } else {
                console.log('图像数据已添加到Redux，ImagePreview将自动加载图像');
            }
            
            // 设置当前图像索引，确保在有效范围内
            const validIdx = Math.max(0, Math.min(storedProject.currentImageIndex, restoredImages.length - 1));
            store.dispatch(updateActiveImageIndex(validIdx));
            // Note: if frames were filtered out, validIdx may point to a different frame than originally viewed.
            
            onProgress?.('恢复完成');
            console.log('项目恢复成功:', {
                总记录数: storedProject.images.length,
                有效恢复数量: validStoredImages.length,
                标签名称数量: storedProject.labelNames.length,
                当前图像索引: storedProject.currentImageIndex,
                Redux状态: store.getState().labels.imagesData.length
            });
            return true;
        } catch (error) {
            console.error('恢复项目失败:', error);
            return false;
        }
    }
    
    
    public static async clearAllStoredData(): Promise<void> {
        try {
            LocalStorageManager.clearSettings();
            await IndexedDBManager.clearProject();
            console.log('所有存储数据已清除');
        } catch (error) {
            console.error('清除存储数据失败:', error);
        }
    }
    
    public static formatLastSavedTime(timestamp: number): string {
        if (timestamp === 0) return '从未保存';
        
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));
        
        if (diffMins < 1) return '刚刚';
        if (diffMins < 60) return `${diffMins}分钟前`;
        if (diffMins < 1440) return `${Math.floor(diffMins / 60)}小时前`;
        
        return date.toLocaleString();
    }
}
