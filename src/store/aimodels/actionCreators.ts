import { AIModel, AIModelsActionTypes } from './types';

export const addAIModel = (model: AIModel): AIModelsActionTypes => ({
    type: 'ADD_AI_MODEL',
    payload: model
});

export const updateAIModel = (model: AIModel): AIModelsActionTypes => ({
    type: 'UPDATE_AI_MODEL',
    payload: model
});

export const deleteAIModel = (modelId: string): AIModelsActionTypes => ({
    type: 'DELETE_AI_MODEL',
    payload: modelId
});

export const setActiveAIModel = (modelId: string | null): AIModelsActionTypes => ({
    type: 'SET_ACTIVE_AI_MODEL',
    payload: modelId
});

export const setAIModels = (models: AIModel[]): AIModelsActionTypes => ({
    type: 'SET_AI_MODELS',
    payload: models
});
