import { AIActionTypes, AIState } from './types';
import { Action } from '../Actions';
import { AIStateStorageManager } from '../../utils/AIStateStorageManager';

// 激进的防抖保存：避免频繁的localStorage操作
let saveTimeout: NodeJS.Timeout | null = null;
let pendingStates: Map<string, any> | null = null;

const debouncedSave = (imageAIStates: Map<string, any>) => {
    pendingStates = imageAIStates; // 只保存最新状态的引用
    
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    
    saveTimeout = setTimeout(() => {
        if (pendingStates) {
            // 使用requestIdleCallback在浏览器空闲时保存
            if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(() => {
                    if (pendingStates) {
                        AIStateStorageManager.saveImageAIStates(pendingStates);
                    }
                }, { timeout: 1500 }); // 减少超时时间
            } else {
                // 降级到requestAnimationFrame，避免阻塞主线程
                requestAnimationFrame(() => {
                    if (pendingStates) {
                        AIStateStorageManager.saveImageAIStates(pendingStates);
                    }
                });
            }
        }
        saveTimeout = null;
        pendingStates = null;
    }, 300); // 减少到300ms，提高响应性
};

// 从localStorage恢复AI状态
const storedAIState = AIStateStorageManager.loadImageAIStates();

const initialState: AIState = {
    suggestedLabelList: [],
    rejectedSuggestedLabelList: [],
    isSSDObjectDetectorLoaded: false,
    isYOLOV5ObjectDetectorLoaded: false,
    isPoseDetectorLoaded: false,
    roboflowAPIDetails: {
        status: false,
        model: '',
        key: ''
    },
    isAIDisabled: true,
    segmentationResults: [],
    segmentationAPIConfig: {
        url: 'http://192.168.10.205:8000/segment',
        enabled: true
    },
    isFullImageInferenceInProgress: false,
    imageAIStates: storedAIState
};

export function aiReducer(
    state = initialState,
    action: AIActionTypes
): AIState {
    switch (action.type) {
        case Action.UPDATE_SUGGESTED_LABEL_LIST: {
            return {
                ...state,
                suggestedLabelList: action.payload.labelList
            }
        }
        case Action.UPDATE_REJECTED_SUGGESTED_LABEL_LIST: {
            return {
                ...state,
                rejectedSuggestedLabelList: action.payload.labelList
            }
        }
        case Action.UPDATE_SSD_OBJECT_DETECTOR_STATUS: {
            return {
                ...state,
                isSSDObjectDetectorLoaded: action.payload.isSSDObjectDetectorLoaded
            }
        }
        case Action.UPDATE_YOLO_V5_OBJECT_DETECTOR_STATUS: {
            return {
                ...state,
                isYOLOV5ObjectDetectorLoaded: action.payload.isYOLOV5ObjectDetectorLoaded
            }
        }
        case Action.UPDATE_POSE_DETECTOR_STATUS: {
            return {
                ...state,
                isPoseDetectorLoaded: action.payload.isPoseDetectorLoaded
            }
        }
        case Action.UPDATE_DISABLED_AI_FLAG: {
            return {
                ...state,
                isAIDisabled: action.payload.isAIDisabled
            }
        }
        case Action.UPDATE_ROBOFLOW_API_DETAILS: {
            return {
                ...state,
                roboflowAPIDetails: action.payload.roboflowAPIDetails
            }
        }
        case Action.UPDATE_SEGMENTATION_RESULTS: {
            return {
                ...state,
                segmentationResults: action.payload.segmentationResults
            }
        }
        case Action.UPDATE_SEGMENTATION_API_CONFIG: {
            return {
                ...state,
                segmentationAPIConfig: action.payload.segmentationAPIConfig
            }
        }
        case Action.UPDATE_FULL_IMAGE_INFERENCE_STATUS: {
            return {
                ...state,
                isFullImageInferenceInProgress: action.payload.isFullImageInferenceInProgress
            }
        }
        case Action.TOGGLE_IMAGE_AI_LABELS_VISIBILITY: {
            const { imageId } = action.payload;
            const currentState = state.imageAIStates.get(imageId) || { 
                aiLabelsVisible: false,
                segmentationLabelsVisible: false,
                inferenceHistory: [] 
            };
            
            // 检查状态是否真的需要改变，避免不必要的更新
            const newVisibility = !currentState.aiLabelsVisible;
            if (currentState.aiLabelsVisible === newVisibility) {
                return state; // 状态无变化，直接返回
            }
            
            const newImageAIStates = new Map(state.imageAIStates);
            // 只切换检测标签显示状态，不影响分割标签
            newImageAIStates.set(imageId, {
                ...currentState,
                aiLabelsVisible: newVisibility
            });
            
            const newState = {
                ...state,
                imageAIStates: newImageAIStates
            };
            
            // 使用防抖保存，避免频繁IO操作
            debouncedSave(newState.imageAIStates);
            return newState;
        }
        case Action.ADD_INFERENCE_HISTORY: {
            const { imageId, timestamp, detectedCount, success, type } = action.payload;
            const newImageAIStates = new Map(state.imageAIStates);
            const currentState = newImageAIStates.get(imageId) || { 
                aiLabelsVisible: false,
                segmentationLabelsVisible: false,
                inferenceHistory: [] 
            };
            
            // 添加新的推理记录
            const newHistory = [...currentState.inferenceHistory, {
                timestamp,
                detectedCount,
                success,
                type
            }];
            
            // 根据推理类型分别控制对应的标签可见性
            const newState_inner = { ...currentState, inferenceHistory: newHistory };
            
            if (type === 'detection' && success && detectedCount > 0) {
                // 检测成功时，只影响检测标签可见性
                newState_inner.aiLabelsVisible = true;
            } else if (type === 'segmentation' && success && detectedCount > 0) {
                // 分割成功时，只影响分割标签可见性
                newState_inner.segmentationLabelsVisible = true;
            }
            
            newImageAIStates.set(imageId, newState_inner);
            
            const newState = {
                ...state,
                imageAIStates: newImageAIStates
            };
            
            // 使用防抖保存，避免频繁IO操作
            debouncedSave(newState.imageAIStates);
            return newState;
        }
        default:
            return state;
    }
}
