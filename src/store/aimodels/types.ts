export type EngineType = 'core' | 'extension';
export type InferenceModelType = 'custom' | 'detection' | 'segmentation' | 'ocr';

export interface AIModel {
    id: string;
    name: string;
    url: string;
    // Detection, segmentation and OCR are core-engine capabilities/model slots,
    // not independently registered engine types.
    modelType: EngineType;
    apiKey?: string;
    description?: string;
    createdAt: Date;
    isActive: boolean;
}

export interface AIModelsState {
    models: AIModel[];
    activeModelId: string | null;
    /** 当前在 navbar 下拉中选中的模型任务类型（'detect' | 'segment' | null），不持久化 */
    selectedModelTask: string | null;
}

export type AIModelsActionTypes =
    | { type: 'ADD_AI_MODEL'; payload: AIModel }
    | { type: 'UPDATE_AI_MODEL'; payload: AIModel }
    | { type: 'DELETE_AI_MODEL'; payload: string }
    | { type: 'SET_ACTIVE_AI_MODEL'; payload: string | null }
    | { type: 'SET_AI_MODELS'; payload: AIModel[] }
    | { type: 'SET_SELECTED_MODEL_TASK'; payload: string | null };
