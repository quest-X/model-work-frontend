import {store} from '../..';
import { RoboflowAPIDetails } from '../ai/types';
import { SegmentationResult, SegmentationAPIConfig } from '../../ai/SegmentationAPIDetector';

export class AISelector {
    public static getSuggestedLabelList(): string[] {
        return store.getState().ai.suggestedLabelList;
    }

    public static getRejectedSuggestedLabelList(): string[] {
        return store.getState().ai.rejectedSuggestedLabelList;
    }

    public static isAISSDObjectDetectorModelLoaded(): boolean {
        return store.getState().ai.isSSDObjectDetectorLoaded;
    }

    public static isAIYOLOObjectDetectorModelLoaded(): boolean {
        return store.getState().ai.isYOLOV5ObjectDetectorLoaded;
    }

    public static isAIPoseDetectorModelLoaded(): boolean {
        return store.getState().ai.isPoseDetectorLoaded;
    }

    public static isRoboflowAPIModelLoaded(): boolean {
        const roboflowAPIDetails = store.getState().ai.roboflowAPIDetails;
        return (
            roboflowAPIDetails.model !== '' && roboflowAPIDetails.key !== '' && roboflowAPIDetails.status
        );
    }

    public static isAIDisabled(): boolean {
        return store.getState().ai.isAIDisabled;
    }

    public static getRoboflowAPIDetails(): RoboflowAPIDetails {
        return store.getState().ai.roboflowAPIDetails
    }

    public static getSegmentationResults(): SegmentationResult[] {
        return store.getState().ai.segmentationResults;
    }

    public static getSegmentationAPIConfig(): SegmentationAPIConfig {
        return store.getState().ai.segmentationAPIConfig;
    }

    public static isSegmentationAPIEnabled(): boolean {
        return store.getState().ai.segmentationAPIConfig.enabled;
    }
}
