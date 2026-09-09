import configureStore from '../../../configureStore';
import {store} from '../../../index';
import {ImageDataUtil} from '../../../utils/ImageDataUtil';
import {LabelUtil} from '../../../utils/LabelUtil';
import {updateImageData, updateActiveImageIndex} from '../../../store/labels/actionCreators';
import {updateVideoMode} from '../../../store/video/actionCreators';
import {Action} from '../../../store/Actions';
import {NotificationType} from '../../../data/enums/NotificationType';
import {EditorModel} from '../../../staticModels/EditorModel';
import {SegmentationAPIDetector, SegmentationResult} from '../../../ai/SegmentationAPIDetector';
import {AISegmentationActions} from '../AISegmentationActions';
import {SmartAnnotationActions} from '../SmartAnnotationActions';

jest.mock('../../../index', () => ({store: {dispatch: jest.fn(), getState: jest.fn()}}));
jest.mock('../AISegmentationActions', () => ({AISegmentationActions: {applySingleResult: jest.fn()}}));
jest.mock('../../../ai/ActiveModel', () => ({ActiveModel: {getSegmentation: () => 'sam2'}, formatModelDisplay: () => 'SAM2'}));

const promptWindow = window as Window & {__openSightPromptInferring?: boolean};
let testStore: ReturnType<typeof configureStore>;

function usePromptImage(bytes = 'image') {
    const image = ImageDataUtil.createImageDataFromFileData(new File([bytes], 'frame_0.jpg'));
    image.labelRects = [
        {...LabelUtil.createLabelRect(null, {x: 1, y: 2, width: 10, height: 20}), id: 'manual'},
        {...LabelUtil.createLabelRect(null, {x: 1, y: 2, width: 10, height: 20}), id: 'prompt', isPrompt: true},
    ];
    testStore.dispatch(updateImageData([image]));
    testStore.dispatch(updateActiveImageIndex(0));
    return image;
}

beforeEach(() => {
    jest.clearAllMocks();
    testStore = configureStore();
    jest.mocked(store.getState).mockImplementation(testStore.getState);
    jest.mocked(store.dispatch).mockImplementation(testStore.dispatch);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    promptWindow.__openSightPromptInferring = false;
    EditorModel.videoSessionId = null;
});

afterEach(() => {
    jest.restoreAllMocks();
    delete promptWindow.__openSightPromptInferring;
    EditorModel.videoSessionId = null;
});

it('releases the inference flag when a real zero-byte frame has no video session', async () => {
    usePromptImage('');
    testStore.dispatch(updateVideoMode(true));
    const predict = jest.spyOn(SegmentationAPIDetector, 'predictFromBlob');
    const pending = SmartAnnotationActions.runAllPrompts();
    expect(promptWindow.__openSightPromptInferring).toBe(true);
    await pending;
    expect(promptWindow.__openSightPromptInferring).toBe(false);
    expect(predict).not.toHaveBeenCalled();
    expect(AISegmentationActions.applySingleResult).not.toHaveBeenCalled();
    expect(testStore.getState().labels.imagesData[0].labelRects.map(rect => rect.id)).toEqual(['manual', 'prompt']);
    expect(testStore.getState().notifications.queue).toEqual([
        expect.objectContaining({type: NotificationType.ERROR, description: 'Could not obtain image bytes for the active frame'}),
    ]);
});

it('holds the flag during inference, preserves all progress steps and clears only prompts on success', async () => {
    const image = usePromptImage();
    let finish: (results: SegmentationResult[]) => void;
    let started: () => void;
    const requested = new Promise<void>(resolve => { started = resolve; });
    jest.spyOn(SegmentationAPIDetector, 'predictFromBlob').mockImplementation(() => new Promise(resolve => {
        finish = resolve;
        started();
    }));
    const pending = SmartAnnotationActions.runAllPrompts();
    await requested;
    expect(promptWindow.__openSightPromptInferring).toBe(true);
    expect(testStore.getState().notifications.queue[0]).toMatchObject({isInferenceProgress: true, currentStep: 2});
    finish([]);
    await pending;
    expect(promptWindow.__openSightPromptInferring).toBe(false);
    expect(AISegmentationActions.applySingleResult).toHaveBeenCalledWith(expect.objectContaining({id: image.id,
        labelRects: [expect.objectContaining({id: 'manual'})]}), [], 'smart');
    expect(testStore.getState().notifications.queue).toEqual([]);
    const actions = jest.mocked(store.dispatch).mock.calls.map(([action]) => action);
    expect(actions.filter(action => action.type === Action.UPDATE_NOTIFICATION_BY_ID)
        .map(action => action.payload.notification.currentStep)).toEqual([1, 2, 3]);
    expect(actions.filter(action => action.type === Action.DELETE_NOTIFICATION_BY_ID)).toHaveLength(1);
});

it('releases the flag and progress notification after a thrown request while retaining retry prompts', async () => {
    usePromptImage();
    jest.spyOn(SegmentationAPIDetector, 'predictFromBlob').mockRejectedValue(new Error('SAM unavailable'));
    await SmartAnnotationActions.runAllPrompts();
    expect(promptWindow.__openSightPromptInferring).toBe(false);
    expect(AISegmentationActions.applySingleResult).not.toHaveBeenCalled();
    expect(testStore.getState().labels.imagesData[0].labelRects.map(rect => rect.id)).toEqual(['manual', 'prompt']);
    expect(testStore.getState().notifications.queue).toEqual([
        expect.objectContaining({type: NotificationType.ERROR, description: 'SAM unavailable'}),
    ]);
});

it('does not clear another active inference flag when this call has no prompts to run', async () => {
    const image = usePromptImage();
    testStore.dispatch(updateImageData([{...image, labelRects: []}]));
    promptWindow.__openSightPromptInferring = true;
    await SmartAnnotationActions.runAllPrompts();
    expect(promptWindow.__openSightPromptInferring).toBe(true);
    expect(store.dispatch).not.toHaveBeenCalled();
});
