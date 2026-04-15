import { ImageData, LabelName } from '../store/labels/types';
import { QueueItem } from '../store/queue/types';

export interface StoredProjectData {
    id: string;
    images: StoredImageData[];
    labelNames: LabelName[];
    currentImageIndex: number;
    lastModified: number;
    version: string;
    segmentationResults?: any[]; // AI推理结果
    isVideoProject?: boolean;   // 是否为视频项目（预拆帧模式）
    extractionMetadata?: {      // 视频拆帧元数据
        fps: number;
        duration: number;
        totalFrames: number;
        width: number;
        height: number;
    };
    imageSegmentationResults?: Record<string, any[]>; // 按图像ID存储的推理结果
    queueItems?: QueueItem[];           // 队列项列表
    activeQueueItemId?: string | null;  // 当前活动的队列项ID
}

export interface StoredImageData {
    id: string;
    fileName: string;
    fileData: ArrayBuffer;
    fileType: string;
    loadStatus: boolean;
    labelRects: any[];
    labelPoints: any[];
    labelLines: any[];
    labelPolygons: any[];
    labelNameIds: string[];
}

export class IndexedDBManager {
    private static readonly DB_NAME = 'MakeSenseDB';
    private static readonly DB_VERSION = 1;
    private static readonly STORE_NAME = 'projects';
    private static readonly PROJECT_ID = 'current-project';
    
    private static db: IDBDatabase | null = null;
    private static isInitialized = false;
    
    public static async initialize(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            if (this.isInitialized && this.db) {
                console.log('IndexedDB已经初始化，跳过重复初始化');
                resolve(true);
                return;
            }
            
            if (!window.indexedDB) {
                console.error('浏览器不支持IndexedDB');
                resolve(false);
                return;
            }
            
            const request = window.indexedDB.open(this.DB_NAME, this.DB_VERSION);
            
            request.onerror = () => {
                console.error('IndexedDB初始化失败:', request.error);
                resolve(false);
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                this.isInitialized = true;
                console.log('IndexedDB初始化成功');
                resolve(true);
            };
            
            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
                    store.createIndex('lastModified', 'lastModified', { unique: false });
                    console.log('IndexedDB对象存储创建完成');
                }
            };
        });
    }
    
    public static async saveProject(projectData: StoredProjectData): Promise<boolean> {
        return new Promise((resolve) => {
            if (!this.db) {
                console.error('IndexedDB未初始化');
                resolve(false);
                return;
            }
            
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);
            
            const saveData = {
                ...projectData,
                id: this.PROJECT_ID,
                lastModified: Date.now(),
                version: '2.1.0'
            };
            
            const request = store.put(saveData);
            
            request.onsuccess = () => {
                // 静默保存
                resolve(true);
            };
            
            request.onerror = () => {
                console.error('保存项目数据失败:', request.error);
                resolve(false);
            };
        });
    }
    
    public static async loadProject(): Promise<StoredProjectData | null> {
        return new Promise((resolve) => {
            if (!this.db) {
                console.error('IndexedDB未初始化');
                resolve(null);
                return;
            }
            
            const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
            const store = transaction.objectStore(this.STORE_NAME);
            const request = store.get(this.PROJECT_ID);
            
            request.onsuccess = () => {
                if (request.result) {
                    console.log('从IndexedDB加载项目数据成功');
                    resolve(request.result);
                } else {
                    console.log('IndexedDB中没有项目数据');
                    resolve(null);
                }
            };
            
            request.onerror = () => {
                console.error('加载项目数据失败:', request.error);
                resolve(null);
            };
        });
    }
    
    public static async hasStoredProject(): Promise<boolean> {
        const project = await this.loadProject();
        return !!project && project.images.length > 0;
    }
    
    public static async clearProject(): Promise<boolean> {
        return new Promise((resolve) => {
            if (!this.db) {
                resolve(false);
                return;
            }
            
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);
            const request = store.delete(this.PROJECT_ID);
            
            request.onsuccess = () => {
                console.log('项目数据已从IndexedDB清除');
                resolve(true);
            };
            
            request.onerror = () => {
                console.error('清除项目数据失败:', request.error);
                resolve(false);
            };
        });
    }
    
    public static async getStorageInfo(): Promise<{ used: number; quota: number }> {
        try {
            if ('storage' in navigator && 'estimate' in navigator.storage) {
                const estimate = await navigator.storage.estimate();
                return {
                    used: estimate.usage || 0,
                    quota: estimate.quota || 0
                };
            }
        } catch (error) {
            console.error('获取存储信息失败:', error);
        }

        return { used: 0, quota: 0 };
    }
}
