import { store } from '../index';
import { LocalStorageManager } from '../utils/LocalStorageManager';
import { IndexedDBManager, StoredProjectData } from '../utils/IndexedDBManager';
import { updateLanguage, updateZoom, updateImageDragModeStatus, updateCrossHairVisibleStatus } from '../store/general/actionCreators';
import { updateActiveImageIndex, updateActiveLabelType, updateLabelNames, updateImageDataById, addImageData, updateImageData } from '../store/labels/actionCreators';
import { updateVideoMode, addVideoData } from '../store/video/actionCreators';
import { VideoData } from '../store/video/types';
import { ImageData, LabelName } from '../store/labels/types';
import { ImageRepository } from '../logic/imageRepository/ImageRepository';
import { LabelType } from '../data/enums/LabelType';

export class ProjectRestoreService {
    
    public static async checkForStoredData(): Promise<{
        hasSettings: boolean;
        hasProject: boolean;
        lastSaved: number;
    }> {
        const hasSettings = LocalStorageManager.hasStoredSettings();
        const hasProject = await IndexedDBManager.hasStoredProject();
        const lastSaved = LocalStorageManager.getLastSavedTime();
        
        return { hasSettings, hasProject, lastSaved };
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
            store.dispatch(updateCrossHairVisibleStatus(settings.crossHairVisible));
            store.dispatch(updateActiveImageIndex(settings.currentImageIndex));
            store.dispatch(updateActiveLabelType(settings.activeLabelType as LabelType));
            
            console.log('设置恢复成功');
            return true;
        } catch (error) {
            console.error('恢复设置失败:', error);
            return false;
        }
    }
    
    public static async restoreProject(): Promise<boolean> {
        try {
            const storedProject = await IndexedDBManager.loadProject();
            
            if (!storedProject || storedProject.images.length === 0) {
                console.log('没有存储的项目需要恢复');
                return false;
            }
            
            // 恢复标签名称
            if (storedProject.labelNames.length > 0) {
                store.dispatch(updateLabelNames(storedProject.labelNames));
            }
            
            // 恢复图像数据 - ArrayBuffer → File，设置loadStatus为false让组件重新加载图像
            const restoredImages: ImageData[] = storedProject.images.map((storedImage): ImageData => ({
                id: storedImage.id,
                fileData: new File([storedImage.fileData], storedImage.fileName, { type: storedImage.fileType || '' }),
                loadStatus: false, // 重要：设置为false让ImagePreview重新加载
                labelRects: storedImage.labelRects || [],
                labelPoints: storedImage.labelPoints || [],
                labelLines: storedImage.labelLines || [],
                labelPolygons: storedImage.labelPolygons || [],
                labelNameIds: storedImage.labelNameIds || [],
                // 添加AI相关的默认字段
                isVisitedByYOLOObjectDetector: false,
                isVisitedBySSDObjectDetector: false,
                isVisitedByPoseDetector: false,
                isVisitedByRoboflowAPI: false
            }));
            
            // 替换图像数据（不是追加）
            store.dispatch(updateImageData(restoredImages));

            // 检测是否为视频项目
            // 同时检查 MIME 类型和文件扩展名（IndexedDB 恢复后 type 可能丢失）
            const firstFile = restoredImages[0]?.fileData;
            const isVideoProject = firstFile && (
                firstFile.type.startsWith('video/') ||
                /\.(mp4|webm|mov|avi|mkv|m4v|ogg)$/i.test(firstFile.name)
            );

            if (isVideoProject) {
                // 恢复视频模式：创建 VideoData 并激活视频模式
                // VideoEditor 挂载后会自动检测 FPS、生成缩略图
                const videoData: VideoData = {
                    id: restoredImages[0].id.split('-')[0] || restoredImages[0].id, // 用第一帧 ID 作为视频 ID
                    fileData: firstFile,
                    loadStatus: false,
                    duration: 0,        // VideoEditor 加载后自动填充
                    fps: 30,            // VideoEditor 加载后自动检测
                    totalFrames: restoredImages.length,
                    videoSize: { width: 0, height: 0 },
                    currentFrame: 0,
                    currentTime: 0,
                    isPlaying: false,
                    frames: new Map()
                };
                store.dispatch(updateVideoMode(true));
                store.dispatch(addVideoData(videoData));
                ImageRepository.setActiveFileId(videoData.id);
                console.log('检测到视频项目，已恢复视频模式', { frames: restoredImages.length });
            } else {
                console.log('图像数据已添加到Redux，ImagePreview将自动加载图像');
            }
            
            // 设置当前图像索引，确保在有效范围内
            const validImageIndex = Math.min(
                Math.max(0, storedProject.currentImageIndex), 
                restoredImages.length - 1
            );
            store.dispatch(updateActiveImageIndex(validImageIndex));
            
            console.log('项目恢复成功:', {
                恢复图像数量: storedProject.images.length,
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
