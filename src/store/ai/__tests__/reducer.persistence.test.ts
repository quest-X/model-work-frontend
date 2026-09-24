import {aiReducer} from '../reducer';
import {addInferenceHistory, toggleImageAILabelsVisibility, toggleImageSegmentationLabelsVisibility} from '../actionCreators';
import {AIStateStorageManager} from '../../../utils/AIStateStorageManager';

describe('AI visibility and history persistence', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('persists only the latest snapshot after the debounce without an idle callback', () => {
        const save = jest.spyOn(AIStateStorageManager, 'saveImageAIStates');
        const first = aiReducer(undefined, toggleImageAILabelsVisibility('image'));
        jest.advanceTimersByTime(200);
        const latest = aiReducer(first, addInferenceHistory('image', 3, true, 'segmentation'));

        jest.advanceTimersByTime(299);
        expect(save).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(AIStateStorageManager.loadImageAIStates()).toEqual(latest.imageAIStates);
        expect(save).toHaveBeenCalledTimes(1);
        expect(first.imageAIStates.get('image').inferenceHistory).toEqual([]);
        jest.advanceTimersByTime(2000);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('toggles label kinds independently and only unhides successful nonempty inference', () => {
        const detectionHidden = aiReducer(undefined, toggleImageAILabelsVisibility('image'));
        expect(detectionHidden.imageAIStates.get('image')).toMatchObject({
            aiLabelsVisible: false, segmentationLabelsVisible: true,
        });
        const bothHidden = aiReducer(detectionHidden, toggleImageSegmentationLabelsVisibility('image'));
        expect(bothHidden.imageAIStates.get('image')).toMatchObject({
            aiLabelsVisible: false, segmentationLabelsVisible: false,
        });

        const empty = aiReducer(bothHidden, addInferenceHistory('image', 0, true, 'segmentation'));
        const failed = aiReducer(empty, addInferenceHistory('image', 2, false, 'detection'));
        expect(failed.imageAIStates.get('image')).toMatchObject({
            aiLabelsVisible: false, segmentationLabelsVisible: false,
        });
        const segmented = aiReducer(failed, addInferenceHistory('image', 3, true, 'segmentation'));
        expect(segmented.imageAIStates.get('image')).toMatchObject({
            aiLabelsVisible: false, segmentationLabelsVisible: true,
        });
        const detected = aiReducer(segmented, addInferenceHistory('image', 1, true, 'detection'));
        expect(detected.imageAIStates.get('image')).toMatchObject({
            aiLabelsVisible: true, segmentationLabelsVisible: true,
        });
        expect(detected.imageAIStates.get('image').inferenceHistory.map(record => record.type)).toEqual([
            'segmentation', 'detection', 'segmentation', 'detection',
        ]);
        expect(bothHidden.imageAIStates.get('image').inferenceHistory).toEqual([]);
    });
});
