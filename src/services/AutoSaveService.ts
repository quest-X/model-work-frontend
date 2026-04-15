import { store } from '../index';
import { LocalStorageManager, ProjectSettings } from '../utils/LocalStorageManager';
import { IndexedDBManager, StoredProjectData, StoredImageData } from '../utils/IndexedDBManager';
import { AIStateStorageManager } from '../utils/AIStateStorageManager';
import { LabelsSelector } from '../store/selectors/LabelsSelector';
import { GeneralSelector } from '../store/selectors/GeneralSelector';
import { ImageRepository } from '../logic/imageRepository/ImageRepository';

export class AutoSaveService {
    private static saveTimer: NodeJS.Timeout | null = null;
    private static readonly SAVE_INTERVAL = 30000; // 30秒自动保存一次
    private static isInitialized = false;
    
    public static async initialize(): Promise<void> {
        if (this.isInitialized) {
            console.log('自动保存服务已经初始化，跳过重复初始化');
            return;
        }
        
        console.log('开始初始化自动保存服务...');
        
        // 清理可能存在的旧定时器
        this.stopAutoSave();
        
        // 初始化IndexedDB
        const dbInitialized = await IndexedDBManager.initialize();
        if (!dbInitialized) {
            console.warn('IndexedDB初始化失败，将只使用localStorage');
        }
        
        // 设置定期自动保存
        this.startAutoSave();
        
        // 监听页面关闭事件，确保保存
        window.addEventListener('beforeunload', this.saveBeforeUnload);
        
        this.isInitialized = true;
        console.log('自动保存服务初始化完成');
    }
    
    public static startAutoSave(): void {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
        }
        
        this.saveTimer = setInterval(() => {
            this.saveCurrentState();
        }, this.SAVE_INTERVAL);
        
        console.log('自动保存定时器已启动');
    }
    
    public static stopAutoSave(): void {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = null;
            console.log('自动保存定时器已停止');
        }
    }
    
    public static async saveCurrentState(): Promise<void> {
        try {
            // 保存轻量设置到localStorage
            await this.saveSettings();
            
            // 保存AI状态到localStorage
            await this.saveAIState();
            
            // 保存重型数据到IndexedDB
            await this.saveProjectData();
            
            // 静默保存，不刷屏
        } catch (error) {
            console.error('保存当前状态失败:', error);
        }
    }
    
    private static async saveSettings(): Promise<void> {
        const state = store.getState();
        
        const settings: Partial<ProjectSettings> = {
            language: state.general.language,
            projectName: state.general.projectData.name,
            zoom: state.general.zoom,
            imageDragMode: state.general.imageDragMode,
            smartAnnotationActive: state.general.smartAnnotationActive,
            currentImageIndex: state.labels.activeImageIndex,
            activeLabelType: state.labels.activeLabelType
        };

        LocalStorageManager.saveSettings(settings);
    }
    
    private static async saveAIState(): Promise<void> {
        const state = store.getState();
        
        // 保存每张图片的AI状态
        AIStateStorageManager.saveImageAIStates(state.ai.imageAIStates);
    }
    
    private static async saveProjectData(): Promise<void> {
        const state = store.getState();
        const imagesData = state.labels.imagesData;
        const labelNames = state.labels.labels;

        if (imagesData.length === 0) {
            return;
        }

        // 估算总数据大小，超过 500MB 跳过（防止 OOM）
        const totalSize = imagesData.reduce((sum, img) => sum + (img.fileData?.size || 0), 0);
        if (totalSize > 500 * 1024 * 1024) {
            console.warn(`自动保存跳过：数据量过大 (${(totalSize / 1024 / 1024).toFixed(0)}MB)`);
            return;
        }

        // 转换ImageData到StoredImageData格式（File → ArrayBuffer 以支持 IndexedDB 持久化）
        // 视频模式下每帧是小 JPEG (~50KB)，可以正常保存
        const storedImages: StoredImageData[] = await Promise.all(
            imagesData.map(async (imageData): Promise<StoredImageData> => ({
                id: imageData.id,
                fileName: imageData.fileData.name,
                fileData: await imageData.fileData.arrayBuffer(),
                fileType: imageData.fileData.type,
                loadStatus: imageData.loadStatus,
                labelRects: imageData.labelRects || [],
                labelPoints: imageData.labelPoints || [],
                labelLines: imageData.labelLines || [],
                labelPolygons: imageData.labelPolygons || [],
                labelNameIds: imageData.labelNameIds || []
            }))
        );

        // 转换 imageSegmentationResults Map 到普通对象以便序列化
        const imageSegmentationResultsObj: Record<string, any[]> = {};
        if (state.ai?.imageSegmentationResults) {
            state.ai.imageSegmentationResults.forEach((results, imageId) => {
                imageSegmentationResultsObj[imageId] = results;
            });
        }

        // 视频模式：保存拆帧元数据以支持恢复
        const isVideoMode = state.video?.isVideoMode || false;
        const activeVideo = isVideoMode ? state.video?.activeVideo : null;

        // 保存队列数据
        const queueItems = state.queue?.items || [];
        const activeQueueItemId = state.queue?.activeQueueItemId || null;

        const projectData: StoredProjectData = {
            id: 'current-project',
            images: storedImages,
            labelNames: labelNames || [],
            currentImageIndex: state.labels.activeImageIndex,
            lastModified: Date.now(),
            version: '1.11.0-alpha',
            segmentationResults: state.ai?.segmentationResults || [],
            imageSegmentationResults: imageSegmentationResultsObj,
            isVideoProject: isVideoMode && !!activeVideo?.preExtractedFrames,
            extractionMetadata: activeVideo?.preExtractedFrames ? {
                fps: activeVideo.fps,
                duration: activeVideo.duration,
                totalFrames: activeVideo.totalFrames,
                width: activeVideo.videoSize.width,
                height: activeVideo.videoSize.height,
            } : undefined,
            queueItems: queueItems,
            activeQueueItemId: activeQueueItemId,
        };

        await IndexedDBManager.saveProject(projectData);
    }
    
    private static saveBeforeUnload = (): void => {
        // 同步保存（页面关闭时）
        try {
            const state = store.getState();
            const settings: Partial<ProjectSettings> = {
                language: state.general.language,
                projectName: state.general.projectData.name,
                zoom: state.general.zoom,
                imageDragMode: state.general.imageDragMode,
                smartAnnotationActive: state.general.smartAnnotationActive,
                currentImageIndex: state.labels.activeImageIndex,
                activeLabelType: state.labels.activeLabelType
            };
            
            LocalStorageManager.saveSettings(settings);
            console.log('页面关闭前保存完成');
        } catch (error) {
            console.error('页面关闭前保存失败:', error);
        }
    };
    
    public static destroy(): void {
        this.stopAutoSave();
        window.removeEventListener('beforeunload', this.saveBeforeUnload);
        this.isInitialized = false;
        console.log('自动保存服务已销毁');
    }
}
