import { AIModelsState, AIModelsActionTypes } from './types';
import { AIModelsStorageManager } from '../../utils/AIModelsStorageManager';

const initialState: AIModelsState = {
    models: AIModelsStorageManager.loadModels(), // 从localStorage恢复数据
    activeModelId: null,
    selectedModelTask: null,
};

export const aiModelsReducer = (
    state: AIModelsState = initialState, 
    action: AIModelsActionTypes
): AIModelsState => {
    let newState: AIModelsState;
    
    switch (action.type) {
        case 'ADD_AI_MODEL':
            newState = {
                ...state,
                models: [...state.models, action.payload]
            };
            break;
        case 'UPDATE_AI_MODEL':
            newState = {
                ...state,
                models: state.models.map(model => 
                    model.id === action.payload.id ? action.payload : model
                )
            };
            break;
        case 'DELETE_AI_MODEL':
            const remainingModels = state.models.filter(model => model.id !== action.payload);
            newState = {
                ...state,
                models: remainingModels,
                activeModelId: state.activeModelId === action.payload ? null : state.activeModelId
            };
            break;
        case 'SET_ACTIVE_AI_MODEL':
            newState = {
                ...state,
                activeModelId: action.payload
            };
            break;
        case 'SET_AI_MODELS':
            newState = {
                ...state,
                models: action.payload
            };
            break;
        case 'SET_SELECTED_MODEL_TASK':
            // 不写 localStorage，只更新内存状态
            return { ...state, selectedModelTask: action.payload };
        default:
            return state;
    }

    // 每次状态变更后自动保存到localStorage
    AIModelsStorageManager.saveModels(newState.models);
    
    return newState;
};
