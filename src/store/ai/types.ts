import {Action} from '../Actions';

export type RoboflowAPIDetails = {
    status: boolean,
    model: string,
    key: string
}

export type AIState = {
    // SSD LOCAL
    isSSDObjectDetectorLoaded: boolean;

    // YOLO V5 LOCAL
    isYOLOV5ObjectDetectorLoaded: boolean;

    // POSE NET LOCAL
    isPoseDetectorLoaded: boolean;

    // ROBOFLOW API
    roboflowAPIDetails: RoboflowAPIDetails;

    // GENERAL
    suggestedLabelList: string[];
    rejectedSuggestedLabelList: string[];
    isAIDisabled: boolean;

    // FULL IMAGE INFERENCE STATE
    isFullImageInferenceInProgress: boolean;
    
    // AI LABELS VISIBILITY STATE - 每张图片独立
    imageAIStates: Map<string, {
        aiLabelsVisible: boolean; // 检测标签是否显示（默认false闭眼）
        inferenceHistory: Array<{
            timestamp: number;    // 推理时间戳
            detectedCount: number; // 检测到的对象数量
            success: boolean;     // 推理是否成功
            type: 'detection'; // 推理类型
        }>;
    }>;
}

interface UpdateSuggestedLabelList {
    type: typeof Action.UPDATE_SUGGESTED_LABEL_LIST;
    payload: {
        labelList: string[];
    }
}

interface UpdateRejectedSuggestedLabelList {
    type: typeof Action.UPDATE_REJECTED_SUGGESTED_LABEL_LIST;
    payload: {
        labelList: string[];
    }
}

interface UpdateSSDObjectDetectorStatus {
    type: typeof Action.UPDATE_SSD_OBJECT_DETECTOR_STATUS;
    payload: {
        isSSDObjectDetectorLoaded: boolean;
    }
}

interface UpdateYOLOV5ObjectDetectorStatus {
    type: typeof Action.UPDATE_YOLO_V5_OBJECT_DETECTOR_STATUS;
    payload: {
        isYOLOV5ObjectDetectorLoaded: boolean;
    }
}

interface UpdatePoseDetectorStatus {
    type: typeof Action.UPDATE_POSE_DETECTOR_STATUS;
    payload: {
        isPoseDetectorLoaded: boolean;
    }
}

interface UpdateDisabledAIFlag {
    type: typeof Action.UPDATE_DISABLED_AI_FLAG;
    payload: {
        isAIDisabled: boolean;
    }
}

interface UpdateRoboflowAPIDetails {
    type: typeof Action.UPDATE_ROBOFLOW_API_DETAILS;
    payload: {
        roboflowAPIDetails: RoboflowAPIDetails
    }
}

interface UpdateFullImageInferenceStatus {
    type: typeof Action.UPDATE_FULL_IMAGE_INFERENCE_STATUS;
    payload: {
        isFullImageInferenceInProgress: boolean;
    }
}

interface ToggleImageAILabelsVisibility {
    type: typeof Action.TOGGLE_IMAGE_AI_LABELS_VISIBILITY;
    payload: {
        imageId: string;
    }
}

interface AddInferenceHistory {
    type: typeof Action.ADD_INFERENCE_HISTORY;
    payload: {
        imageId: string;
        timestamp: number;
        detectedCount: number;
        success: boolean;
        type: 'detection';
    }
}

export type AIActionTypes = UpdateSuggestedLabelList
    | UpdateRejectedSuggestedLabelList
    | UpdateSSDObjectDetectorStatus
    | UpdateYOLOV5ObjectDetectorStatus
    | UpdatePoseDetectorStatus
    | UpdateDisabledAIFlag
    | UpdateRoboflowAPIDetails
    | UpdateFullImageInferenceStatus
    | ToggleImageAILabelsVisibility
    | AddInferenceHistory
