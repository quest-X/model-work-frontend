import { AIModel } from '../store/aimodels/types';
import {normalizeEngineBaseUrl, ServiceEngineType} from './DefaultBackendUrl';

type StoredEngine = Omit<AIModel, 'modelType' | 'createdAt'> & {
    modelType?: string;
    createdAt: Date | string | number;
};

const LEGACY_CORE_TYPES = new Set(['core', 'custom', 'detection', 'segmentation', 'ocr']);

const migrateEngine = (model: StoredEngine): AIModel | null => {
    const modelType: ServiceEngineType | null = model.modelType === 'extension'
        ? 'extension'
        : LEGACY_CORE_TYPES.has(model.modelType || '') ? 'core' : null;
    if (!modelType || !model.url) return null;
    return {
        ...model,
        modelType,
        url: normalizeEngineBaseUrl(model.url, modelType),
        createdAt: new Date(model.createdAt),
    };
};

const deduplicateEngines = (models: AIModel[]): AIModel[] => {
    const unique = new Map<string, AIModel>();
    models.forEach(model => {
        const key = `${model.modelType}:${model.url}`;
        const existing = unique.get(key);
        if (!existing) {
            unique.set(key, model);
            return;
        }
        // Keep the first registration/id stable, but do not lose an enabled state.
        if (model.isActive && !existing.isActive) {
            unique.set(key, {...existing, isActive: true});
        }
    });
    return Array.from(unique.values());
};

export class AIModelsStorageManager {
    private static readonly STORAGE_KEY = 'make-sense-ai-models';
    
    public static saveModels(models: AIModel[]): void {
        try {
            const dataToStore = {
                models,
                lastSaved: Date.now(),
                version: '3.0.0'
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(dataToStore));
            console.log('AI模型数据已保存到localStorage');
        } catch (error) {
            console.error('保存AI模型数据失败:', error);
        }
    }
    
    public static loadModels(): AIModel[] {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                // 验证数据结构
                if (data.models && Array.isArray(data.models)) {
                    const migrated = data.models
                        .map((model: StoredEngine) => migrateEngine(model))
                        .filter((model: AIModel | null): model is AIModel => model !== null);
                    return deduplicateEngines(migrated);
                }
            }
        } catch (error) {
            console.error('读取AI模型数据失败:', error);
        }
        
        return []; // 返回空数组作为默认值
    }
    
    public static hasStoredModels(): boolean {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (!stored) return false;
            
            const data = JSON.parse(stored);
            return data.models && Array.isArray(data.models) && data.models.length > 0;
        } catch (error) {
            console.error('检查存储的AI模型数据失败:', error);
            return false;
        }
    }
    
    public static clearModels(): void {
        try {
            localStorage.removeItem(this.STORAGE_KEY);
            console.log('AI模型数据已清除');
        } catch (error) {
            console.error('清除AI模型数据失败:', error);
        }
    }
    
    public static getLastSavedTime(): number {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                return data.lastSaved || 0;
            }
        } catch (error) {
            console.error('读取最后保存时间失败:', error);
        }
        return 0;
    }
}
