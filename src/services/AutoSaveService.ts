import { store } from '../index';
import { LocalStorageManager, ProjectSettings } from '../utils/LocalStorageManager';
import { IndexedDBManager, StoredProjectData, StoredImageData } from '../utils/IndexedDBManager';
import { AIStateStorageManager } from '../utils/AIStateStorageManager';
import { LabelsSelector } from '../store/selectors/LabelsSelector';
import { GeneralSelector } from '../store/selectors/GeneralSelector';
import { ImageRepository } from '../logic/imageRepository/ImageRepository';
import { TaskTracker } from './TaskTracker';
import { TaskType } from '../store/tasks/types';
import { LanguageConfig } from '../data/LanguageConfig';

export class AutoSaveService {
    private static saveTimer: NodeJS.Timeout | null = null;
    // 周期 save 间隔：60s 太稀疏，丢电/崩溃时容易丢数据。配 signature-skip
    // (v2.4.2) 后无变化 tick 是 0 序列化的，所以可以放心调激进。
    private static readonly SAVE_INTERVAL = 15000;
    // Edit-driven debounce：每次 Redux dispatch 后 N 毫秒无新动作就 save。
    // 比纯 interval 反应快，比"每个 dispatch 都 save"省得多。
    private static readonly EDIT_DEBOUNCE_MS = 3000;
    private static editDebounceTimer: NodeJS.Timeout | null = null;
    private static unsubscribeStore: (() => void) | null = null;
    private static visibilityListener: (() => void) | null = null;
    private static isInitialized = false;
    // 保存完成回调：UI 层注册，用于触发绿色闪烁等视觉反馈
    public static onSaveComplete: (() => void) | null = null;

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

        // Redux store 订阅：编辑后 EDIT_DEBOUNCE_MS 内无新动作就触发一次 save。
        this.unsubscribeStore = store.subscribe(() => {
            if (this.editDebounceTimer) clearTimeout(this.editDebounceTimer);
            this.editDebounceTimer = setTimeout(() => {
                if (typeof document !== 'undefined' && document.hidden) return;
                this.saveCurrentState();
            }, this.EDIT_DEBOUNCE_MS);
        });

        // 标签页切换到隐藏时强制 flush 一次（用户切走前这一刻可能有未持久化的编辑）。
        // beforeunload 之外的额外保障，因为浏览器对 beforeunload 期间的 IDB 异步写入不可靠。
        this.visibilityListener = () => {
            if (typeof document !== 'undefined' && document.hidden) {
                this.saveCurrentState();
            }
        };
        document.addEventListener('visibilitychange', this.visibilityListener);

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
            // 标签页/屏幕休眠时跳过：用户没在编辑，没新东西要存；
            // 整夜每 N 秒一次序列化整个 store 写 IndexedDB 是 dev 模式下内存增长的主因之一。
            if (typeof document !== 'undefined' && document.hidden) return;
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
    
    /**
     * Cheap signature of the data slices we serialize, so we can skip the
     * heavy IndexedDB write when nothing relevant has changed since the last
     * save. Catches add/remove/move of any label or queue item, video mode
     * toggle, and active selection. Does NOT catch in-place vertex drags
     * where rect/polygon count stays constant — for that case we still rely
     * on the manual Ctrl+S path; the periodic save is best-effort. Worth it
     * because it turns "videos with 8000+ frame placeholders, idle, polling"
     * from "serialize 400 MB to IDB every minute forever" into "no-op".
     */
    private static lastSavedSignature: string = '';
    private static computeSignature(): string {
        const state = store.getState();
        const imagesData = state.labels.imagesData;
        // Aggregate per-image label counts into one string. For 10k images
        // this is ~150 KB string compare per tick — negligible vs. a full
        // ArrayBuffer serialize.
        const labelDetail = imagesData.map(i => {
            const r = i.labelRects?.length || 0;
            const p = i.labelPoints?.length || 0;
            const l = i.labelLines?.length || 0;
            // Polygon vertex total catches "added a vertex" without scanning coords.
            const polyVerts = (i.labelPolygons || []).reduce(
                (s, poly: any) => s + (poly?.vertices?.length || 0), 0
            );
            return `${r},${p},${l},${(i.labelPolygons?.length || 0)}/${polyVerts}`;
        }).join('|');
        return [
            imagesData.length,
            (state.labels.labels || []).length,
            state.labels.activeImageIndex,
            state.video?.isVideoMode ? 'V' : 'I',
            state.video?.activeVideo?.id || '',
            (state.queue?.items || []).length,
            state.queue?.activeQueueItemId || '',
            (state.ai?.segmentationResults || []).length,
            labelDetail,
        ].join('::');
    }

    public static async saveCurrentState(): Promise<void> {
        // Skip the entire heavy path when nothing changed since last save.
        // First call always falls through (lastSavedSignature is empty).
        // 注意：信号无变化时直接 return，不创建 task — 避免每 3s 闪一次面板。
        const sig = this.computeSignature();
        if (sig === this.lastSavedSignature && this.lastSavedSignature !== '') {
            return;
        }

        // 走到这里就是真正要写盘了，登记 P0 task。stableId='autosave' 确保
        // 重复触发时是 upsert 替换，不刷屏；autoRemove 1500ms 让一次绿闪后立即消失。
        const lang = store.getState().general.language;
        const t = LanguageConfig[lang].taskManager;
        const task = TaskTracker.startTask({
            type: TaskType.AUTO_SAVE,
            priority: 'P0',
            title: t.types.autoSave,
            cancellable: false,
            stableId: 'autosave',
            autoRemoveAfterMs: 1500,
        });

        try {
            // 保存轻量设置到localStorage
            await this.saveSettings();

            // 保存AI状态到localStorage
            await this.saveAIState();

            // 保存重型数据到IndexedDB
            const saved = await this.saveProjectData();

            if (saved) {
                this.lastSavedSignature = sig;
                if (this.onSaveComplete) this.onSaveComplete();
                task.complete();
            } else {
                // 比如数据量超 500MB 守卫触发，跳过但不算失败
                task.complete();
            }
        } catch (error) {
            console.error('保存当前状态失败:', error);
            task.fail(error);
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
    
    private static async saveProjectData(): Promise<boolean> {
        const state = store.getState();
        const imagesData = state.labels.imagesData;
        const labelNames = state.labels.labels;

        if (imagesData.length === 0) {
            return true;
        }

        // 估算总数据大小，超过 500MB 跳过（防止 OOM）
        const totalSize = imagesData.reduce((sum, img) => sum + (img.fileData?.size || 0), 0);
        if (totalSize > 500 * 1024 * 1024) {
            console.warn(`自动保存跳过：数据量过大 (${(totalSize / 1024 / 1024).toFixed(0)}MB)`);
            return false;
        }

        // 转换ImageData到StoredImageData格式（File → ArrayBuffer 以支持 IndexedDB 持久化）
        // 视频模式下每帧是小 JPEG (~50KB)，可以正常保存
        const storedImages: StoredImageData[] = (await Promise.all(
            imagesData.map(async (imageData): Promise<StoredImageData | null> => {
                try {
                    return {
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
                    };
                } catch {
                    // File reference expired (e.g. on-demand video frame not yet loaded)
                    return null;
                }
            })
        )).filter((img): img is StoredImageData => img !== null && img.fileData.byteLength > 0);

        // 关键守卫：filter 后全空但 Redux 里其实有 entries（典型场景：视频 on-demand
        // 模式下的 0-byte 占位帧，autosave 在帧数据真正解码前触发）。这种情况下绝不能
        // 把 images:[] 写进 IDB，否则会覆盖之前真正有数据的快照，导致下次"恢复工作"
        // 弹窗显示 0 张 / 0 帧、点击恢复后进到空白编辑器。
        if (storedImages.length === 0 && imagesData.length > 0) {
            console.warn(
                `[AutoSave] all ${imagesData.length} imagesData entries filtered (byteLength=0 placeholders); ` +
                `skipping IDB write to preserve prior snapshot`
            );
            return false;
        }

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
            version: '2.1.0',
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

        const saved = await IndexedDBManager.saveProject(projectData);
        if (!saved) {
            console.warn('[AutoSave] IndexedDB save failed — project data may not be persisted. Check storage quota.');
        }
        return saved;
    }
    
    private static saveBeforeUnload = (): void => {
        // NOTE: IndexedDB writes are async and cannot be reliably completed in beforeunload.
        // Only synchronous localStorage settings are saved here. Project data relies on the
        // 60-second autosave interval.
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
        if (this.editDebounceTimer) {
            clearTimeout(this.editDebounceTimer);
            this.editDebounceTimer = null;
        }
        if (this.unsubscribeStore) {
            this.unsubscribeStore();
            this.unsubscribeStore = null;
        }
        if (this.visibilityListener) {
            document.removeEventListener('visibilitychange', this.visibilityListener);
            this.visibilityListener = null;
        }
        window.removeEventListener('beforeunload', this.saveBeforeUnload);
        this.isInitialized = false;
        console.log('自动保存服务已销毁');
    }
}
