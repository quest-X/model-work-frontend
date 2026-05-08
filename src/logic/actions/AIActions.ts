import {LabelType} from '../../data/enums/LabelType';
import {LabelsSelector} from '../../store/selectors/LabelsSelector';
import {ImageData} from '../../store/labels/types';
import {AISelector} from '../../store/selectors/AISelector';
import { AIRoboflowAPIObjectDetectionActions } from './AIRoboflowAPIObjectDetectionActions';

export class AIActions {
    public static excludeRejectedLabelNames(suggestedLabels: string[], rejectedLabels: string[]): string[] {
        return suggestedLabels.reduce((acc: string[], label: string) => {
            if (!rejectedLabels.includes(label)) {
                acc.push(label)
            }
            return acc;
        }, [])
    }

    public static detect(imageId: string, image: HTMLImageElement): void {
        const imageData =  LabelsSelector.getImageDataById(imageId)
        const activeLabelType: LabelType = LabelsSelector.getActiveLabelType();
        const isRoboflowAPIModelLoaded = AISelector.isRoboflowAPIModelLoaded();
        switch (activeLabelType) {
            case LabelType.RECT:
                if (isRoboflowAPIModelLoaded) {
                    AIRoboflowAPIObjectDetectionActions.detectRects(imageData)
                }
                break;
        }
    }

    public static rejectAllSuggestedLabels(imageData: ImageData) {
        const activeLabelType: LabelType = LabelsSelector.getActiveLabelType();
        const isRoboflowAPIModelLoaded = AISelector.isRoboflowAPIModelLoaded();
        switch (activeLabelType) {
            case LabelType.RECT:
                if (isRoboflowAPIModelLoaded) {
                    AIRoboflowAPIObjectDetectionActions.rejectAllSuggestedRectLabels(imageData)
                }
                break;
        }
    }

    public static acceptAllSuggestedLabels(imageData: ImageData) {
        const activeLabelType: LabelType = LabelsSelector.getActiveLabelType();
        const isRoboflowAPIModelLoaded = AISelector.isRoboflowAPIModelLoaded();
        switch (activeLabelType) {
            case LabelType.RECT:
                if (isRoboflowAPIModelLoaded) {
                    AIRoboflowAPIObjectDetectionActions.acceptAllSuggestedRectLabels(imageData)
                }
                break;
        }
    }
}
