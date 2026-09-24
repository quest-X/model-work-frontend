import { AIActionTypes, AIState } from './types';
import { Action } from '../Actions';
import { AIStateStorageManager, ImageAIState } from '../../utils/AIStateStorageManager';

// 防抖结束后保存捕获的最新快照，不再等待第二层闲时回调。
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

const debouncedSave = (imageAIStates: AIState['imageAIStates']) => {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    
    saveTimeout = setTimeout(() => {
        AIStateStorageManager.saveImageAIStates(imageAIStates);
        saveTimeout = null;
    }, 300);
};

const updateImageAIState = (
    state: AIState,
    imageId: string,
    update: (current: ImageAIState) => ImageAIState,
): AIState => {
    const imageAIStates = new Map(state.imageAIStates);
    // 默认可见：首次点击眼睛按钮隐藏对应类型。
    const current = imageAIStates.get(imageId) || {
        aiLabelsVisible: true,
        segmentationLabelsVisible: true,
        inferenceHistory: [],
    };
    imageAIStates.set(imageId, update(current));
    debouncedSave(imageAIStates);
    return {...state, imageAIStates};
};

// 从localStorage恢复AI状态
const storedAIState = AIStateStorageManager.loadImageAIStates();

const initialState: AIState = {
    suggestedLabelList: [],
    rejectedSuggestedLabelList: [],
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
        case Action.TOGGLE_IMAGE_AI_LABELS_VISIBILITY:
        case Action.TOGGLE_IMAGE_SEGMENTATION_LABELS_VISIBILITY: {
            const visibility = action.type === Action.TOGGLE_IMAGE_AI_LABELS_VISIBILITY
                ? 'aiLabelsVisible' : 'segmentationLabelsVisible';
            return updateImageAIState(state, action.payload.imageId, current => ({
                ...current,
                [visibility]: !current[visibility],
            }));
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
        case Action.REMOVE_SEGMENTATION_RESULTS_BY_CLASS_NAMES: {
            const removedClassNames = new Set(
                action.payload.classNames
                    .map(className => className.trim().toLowerCase())
                    .filter(Boolean)
            );
            if (removedClassNames.size === 0) {
                return state;
            }

            const shouldKeepResult = (result: AIState['segmentationResults'][number]) => {
                const className = (result.info?.name || result.class_name || '').trim().toLowerCase();
                return !removedClassNames.has(className);
            };
            const newSegmentationResults = state.segmentationResults.filter(shouldKeepResult);
            const newImageSegmentationResults = new Map<string, AIState['segmentationResults']>();

            state.imageSegmentationResults.forEach((results, imageId) => {
                newImageSegmentationResults.set(imageId, results.filter(shouldKeepResult));
            });

            return {
                ...state,
                segmentationResults: newSegmentationResults,
                imageSegmentationResults: newImageSegmentationResults
            }
        }
        case Action.ADD_INFERENCE_HISTORY: {
            const { imageId, timestamp, detectedCount, success, type } = action.payload;
            return updateImageAIState(state, imageId, current => {
                const updated = {
                    ...current,
                    inferenceHistory: [...current.inferenceHistory, {timestamp, detectedCount, success, type}],
                };
                if (success && detectedCount > 0) {
                    const visibility = type === 'segmentation' ? 'segmentationLabelsVisible' : 'aiLabelsVisible';
                    updated[visibility] = true;
                }
                return updated;
            });
        }
        default:
            return state;
    }
}
