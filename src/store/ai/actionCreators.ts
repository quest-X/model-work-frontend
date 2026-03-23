import { Action } from '../Actions';
import { AIActionTypes, RoboflowAPIDetails } from './types';
import { SegmentationResult, SegmentationAPIConfig } from '../../ai/SegmentationAPIDetector';

export function updateSuggestedLabelList(labelList: string[]): AIActionTypes {
    return {
        type: Action.UPDATE_SUGGESTED_LABEL_LIST,
        payload: {
            labelList,
        }
    }
}

export function updateRejectedSuggestedLabelList(labelList: string[]): AIActionTypes {
    return {
        type: Action.UPDATE_REJECTED_SUGGESTED_LABEL_LIST,
        payload: {
            labelList,
        }
    }
}

export function updateSSDObjectDetectorStatus(isSSDObjectDetectorLoaded: boolean): AIActionTypes {
    return {
        type: Action.UPDATE_SSD_OBJECT_DETECTOR_STATUS,
        payload: {
            isSSDObjectDetectorLoaded,
        }
    }
}

export function updateYOLOV5ObjectDetectorStatus(isYOLOV5ObjectDetectorLoaded: boolean): AIActionTypes {
    return {
        type: Action.UPDATE_YOLO_V5_OBJECT_DETECTOR_STATUS,
        payload: {
            isYOLOV5ObjectDetectorLoaded,
        }
    }
}

export function updatePoseDetectorStatus(isPoseDetectorLoaded: boolean): AIActionTypes {
    return {
        type: Action.UPDATE_POSE_DETECTOR_STATUS,
        payload: {
            isPoseDetectorLoaded,
        }
    }
}

export function updateDisabledAIFlag(isAIDisabled: boolean): AIActionTypes {
    return {
        type: Action.UPDATE_DISABLED_AI_FLAG,
        payload: {
            isAIDisabled,
        }
    }
}

export function updateRoboflowAPIDetails(roboflowAPIDetails: RoboflowAPIDetails): AIActionTypes {
    return {
        type: Action.UPDATE_ROBOFLOW_API_DETAILS,
        payload: {
            roboflowAPIDetails
        }
    }
}

export function updateSegmentationResults(segmentationResults: SegmentationResult[]): AIActionTypes {
    return {
        type: Action.UPDATE_SEGMENTATION_RESULTS,
        payload: {
            segmentationResults
        }
    }
}

export function updateSegmentationAPIConfig(segmentationAPIConfig: SegmentationAPIConfig): AIActionTypes {
    return {
        type: Action.UPDATE_SEGMENTATION_API_CONFIG,
        payload: {
            segmentationAPIConfig
        }
    }
}

export function updateFullImageInferenceStatus(isFullImageInferenceInProgress: boolean): AIActionTypes {
    return {
        type: Action.UPDATE_FULL_IMAGE_INFERENCE_STATUS,
        payload: {
            isFullImageInferenceInProgress
        }
    }
}

export function updateRetrievalModeStatus(isRetrievalModeEnabled: boolean): AIActionTypes {
    return {
        type: Action.UPDATE_RETRIEVAL_MODE_STATUS,
        payload: {
            isRetrievalModeEnabled
        }
    }
}

export function updateRetrievalSegmentationStatus(enableRetrievalSegmentation: boolean): AIActionTypes {
    return {
        type: Action.UPDATE_RETRIEVAL_SEGMENTATION_STATUS,
        payload: {
            enableRetrievalSegmentation
        }
    }
}

export function toggleImageAILabelsVisibility(imageId: string): AIActionTypes {
    return {
        type: Action.TOGGLE_IMAGE_AI_LABELS_VISIBILITY,
        payload: {
            imageId
        }
    }
}

export function addInferenceHistory(imageId: string, detectedCount: number, success: boolean = true, type: 'detection' | 'segmentation' | 'retrieval' = 'detection'): AIActionTypes {
    return {
        type: Action.ADD_INFERENCE_HISTORY,
        payload: {
            imageId,
            timestamp: Date.now(),
            detectedCount,
            success,
            type
        }
    }
}
