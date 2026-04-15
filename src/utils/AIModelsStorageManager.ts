import { AIModel } from '../store/aimodels/types';

export class AIModelsStorageManager {
    private static readonly STORAGE_KEY = 'make-sense-ai-models';
    
    public static saveModels(models: AIModel[]): void {
        try {
            const dataToStore = {
                models,
                lastSaved: Date.now(),
                version: '2.1.0'
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
                    return data.models.map((model: any) => ({
                        ...model,
                        createdAt: new Date(model.createdAt) // 确保日期对象正确恢复
                    }));
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
