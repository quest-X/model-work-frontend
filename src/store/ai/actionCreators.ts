import { Action } from '../Actions';
import { AIActionTypes, RoboflowAPIDetails, SegmentationResult } from './types';

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

export function updateFullImageInferenceStatus(isFullImageInferenceInProgress: boolean): AIActionTypes {
    return {
        type: Action.UPDATE_FULL_IMAGE_INFERENCE_STATUS,
        payload: {
            isFullImageInferenceInProgress
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

export function updateSegmentationResults(segmentationResults: SegmentationResult[], imageId?: string): AIActionTypes {
    return {
        type: Action.UPDATE_SEGMENTATION_RESULTS,
        payload: {
            segmentationResults,
            imageId
        }
    }
}

export function toggleImageSegmentationLabelsVisibility(imageId: string): AIActionTypes {
    return {
        type: Action.TOGGLE_IMAGE_SEGMENTATION_LABELS_VISIBILITY,
        payload: {
            imageId
        }
    }
}

export function addInferenceHistory(imageId: string, detectedCount: number, success: boolean = true, type: 'detection' | 'segmentation' = 'detection'): AIActionTypes {
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
