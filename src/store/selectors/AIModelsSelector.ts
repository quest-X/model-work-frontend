import { AppState } from '../index';
import { AIModel } from '../aimodels/types';

export class AIModelsSelector {
    public static getAIModels(state: AppState): AIModel[] {
        return state.aimodels.models;
    }

    public static getActiveAIModel(state: AppState): AIModel | null {
        const activeModelId = state.aimodels.activeModelId;
        if (!activeModelId) return null;
        
        return state.aimodels.models.find(model => model.id === activeModelId) || null;
    }

    public static getModelsByType(state: AppState, modelType: 'detection' | 'segmentation'): AIModel[] {
        return state.aimodels.models.filter(model => model.modelType === modelType);
    }

    public static getActiveModelByType(state: AppState, modelType: 'detection' | 'segmentation'): AIModel | null {
        const modelsOfType = AIModelsSelector.getModelsByType(state, modelType);
        // 返回第一个激活的指定类型模型，如果没有激活的则返回第一个
        return modelsOfType.find(model => model.isActive) || modelsOfType[0] || null;
    }

    public static hasModelsOfType(state: AppState, modelType: 'detection' | 'segmentation'): boolean {
        return AIModelsSelector.getModelsByType(state, modelType).length > 0;
    }
}
