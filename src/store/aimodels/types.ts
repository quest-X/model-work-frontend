export interface AIModel {
    id: string;
    name: string;
    url: string;
    modelType: 'detection' | 'segmentation' | 'retrieval';
    apiKey?: string;
    description?: string;
    createdAt: Date;
    isActive: boolean;
}

export interface AIModelsState {
    models: AIModel[];
    activeModelId: string | null;
}

export type AIModelsActionTypes = 
    | { type: 'ADD_AI_MODEL'; payload: AIModel }
    | { type: 'UPDATE_AI_MODEL'; payload: AIModel }
    | { type: 'DELETE_AI_MODEL'; payload: string }
    | { type: 'SET_ACTIVE_AI_MODEL'; payload: string | null }
    | { type: 'SET_AI_MODELS'; payload: AIModel[] };
