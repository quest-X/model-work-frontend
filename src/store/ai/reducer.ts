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
    isFullImageInferenceInProgress: false,
    segmentationResults: [],
    imageSegmentationResults: new Map(),
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
        case Action.UPDATE_SEGMENTATION_RESULTS: {
            const { segmentationResults, imageId } = action.payload;
            const newImageSegmentationResults = new Map(state.imageSegmentationResults);

            if (imageId) {
                newImageSegmentationResults.set(imageId, segmentationResults);
            }

            return {
                ...state,
                segmentationResults: segmentationResults,
                imageSegmentationResults: newImageSegmentationResults
            }
        }
        case Action.ADD_INFERENCE_HISTORY: {
            const { imageId, timestamp, detectedCount, success, type } = action.payload;
            const newImageAIStates = new Map(state.imageAIStates);
            const currentState = newImageAIStates.get(imageId) || {
                aiLabelsVisible: false,
                inferenceHistory: []
            };

            // 添加新的推理记录
            const newHistory = [...currentState.inferenceHistory, {
                timestamp,
                detectedCount,
                success,
                type
            }];

            const newState_inner = { ...currentState, inferenceHistory: newHistory };

            if (success && detectedCount > 0) {
                newState_inner.aiLabelsVisible = true;
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
