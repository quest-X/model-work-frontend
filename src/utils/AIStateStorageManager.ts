export interface InferenceHistoryRecord {
    timestamp: number;
    detectedCount: number;
    success: boolean;
}

export interface ImageAIState {
    aiLabelsVisible: boolean;
    inferenceHistory: InferenceHistoryRecord[];
}

export interface AIStateData {
    imageAIStates: Array<[string, ImageAIState]>; // Map.entries() 序列化结果，向后兼容旧的对象格式
    lastSaved: number;
    version: string;
}

export class AIStateStorageManager {
    private static readonly STORAGE_KEY = 'make-sense-ai-state';
    private static readonly CURRENT_VERSION = '1.0.0';
    
    public static saveImageAIStates(imageAIStates: Map<string, ImageAIState>): void {
        try {
            // 使用更高效的序列化方式
            const entriesArray = Array.from(imageAIStates.entries());
            const dataToStore = {
                imageAIStates: entriesArray, // 直接存储数组，避免Object.fromEntries的开销
                lastSaved: Date.now(),
                version: this.CURRENT_VERSION
            };
            
            // 使用更快的JSON序列化
            const jsonString = JSON.stringify(dataToStore);
            localStorage.setItem(this.STORAGE_KEY, jsonString);
        } catch (error) {
            // 静默处理错误，避免console.error的性能开销
        }
    }
    
    public static loadImageAIStates(): Map<string, ImageAIState> {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                
                // 快速兼容性处理
                let statesData;
                if (Array.isArray(data.imageAIStates)) {
                    // 新的数组格式
                    statesData = data.imageAIStates;
                } else {
                    // 旧的对象格式，转换为数组
                    statesData = Object.entries(data.imageAIStates);
                }
                
                // 快速构建Map，减少迁移逻辑的性能开销
                const result = new Map<string, ImageAIState>();
                for (const [imageId, state] of statesData) {
                    const stateObj = state as any;
                    
                    // 简化的格式处理
                    if ('isInferred' in stateObj && !('inferenceHistory' in stateObj)) {
                        // 旧格式快速转换
                        result.set(imageId, {
                            aiLabelsVisible: stateObj.aiLabelsVisible || false,
                            inferenceHistory: stateObj.isInferred ? [{
                                timestamp: Date.now() - 86400000,
                                detectedCount: 1,
                                success: true
                            }] : []
                        });
                    } else {
                        // 新格式直接使用
                        result.set(imageId, stateObj);
                    }
                }
                
                return result;
            }
        } catch (error) {
            // 静默处理错误
        }
        
        return new Map<string, ImageAIState>();
    }
    
    public static hasStoredAIState(): boolean {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            return !!stored;
        } catch (error) {
            return false;
        }
    }
    
    public static clearImageAIStates(): void {
        try {
            localStorage.removeItem(this.STORAGE_KEY);
            console.log('🗑️ 图片AI状态已清除');
        } catch (error) {
            console.error('❌ 清除图片AI状态失败:', error);
        }
    }
    
    public static getLastSavedTime(): number {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                const data: AIStateData = JSON.parse(stored);
                return data.lastSaved;
            }
        } catch (error) {
            console.error('❌ 获取AI状态保存时间失败:', error);
        }
        return 0;
    }
    
    // 获取指定图片的AI状态（默认为隐藏且无推理历史）
    public static getImageAIState(imageId: string): ImageAIState {
        const allStates = this.loadImageAIStates();
        return allStates.get(imageId) || { aiLabelsVisible: false, inferenceHistory: [] };
    }
    
    // 获取指定图片的最高检测数量
    public static getMaxDetectedCount(imageId: string): number {
        const state = this.getImageAIState(imageId);
        if (state.inferenceHistory.length === 0) return 0;
        
        return Math.max(...state.inferenceHistory
            .filter(record => record.success)
            .map(record => record.detectedCount)
        );
    }
    
    // 检查是否需要重新推理
    public static shouldTriggerInference(imageId: string, currentAILabelCount: number): boolean {
        const state = this.getImageAIState(imageId);
        const maxDetected = this.getMaxDetectedCount(imageId);
        
        // 如果从未推理过（没有推理历史），则需要推理
        if (state.inferenceHistory.length === 0) {
            console.log(`🧠 图片 ${imageId} 从未推理过，需要推理`);
            return true;
        }
        
        // 如果当前AI标签数量少于历史最高记录，则需要重新推理
        const needsReinference = currentAILabelCount < maxDetected;
        console.log(`🧠 图片 ${imageId} 推理检查: 当前标签=${currentAILabelCount}, 历史最高=${maxDetected}, 需要推理=${needsReinference}`);
        return needsReinference;
    }
}
