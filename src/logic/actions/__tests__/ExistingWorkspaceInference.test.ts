import configureStore from '../../../configureStore';
import {store} from '../../../index';
import {AIDetectionActions} from '../AIDetectionActions';
import {DetectionAPIDetector} from '../../../ai/DetectionAPIDetector';
import {ImageDataUtil} from '../../../utils/ImageDataUtil';
import {updateImageData} from '../../../store/labels/actionCreators';
import {UndoStack} from '../../undo/UndoStack';
import {LabelStatus} from '../../../data/enums/LabelStatus';
import {requestedImageIndices} from '../../../utils/InferenceTargets';

jest.mock('../../../index', () => ({store: {getState: jest.fn(), dispatch: jest.fn()}}));
jest.mock('../EditorActions', () => ({EditorActions: {fullRender: jest.fn()}}));

afterEach(() => {jest.restoreAllMocks(); sessionStorage.clear(); UndoStack.clear();});

function setup() {
    const testStore = configureStore();
    jest.mocked(store.getState).mockImplementation(testStore.getState);
    (store.dispatch as unknown as jest.Mock).mockImplementation(testStore.dispatch);
    const image = ImageDataUtil.createImageDataFromFileData(new File(['image'], 'target.png', {type: 'image/png'}));
    const other = ImageDataUtil.createImageDataFromFileData(new File(['image'], 'other.png', {type: 'image/png'}));
    testStore.dispatch(updateImageData([image, other]));
    UndoStack.clear();
    return {testStore, image, other};
}

it('puts model boxes into native editable labels with an undo snapshot and persistence evidence', async () => {
    const {testStore, image, other} = setup();
    const result = jest.fn();
    window.addEventListener('sigineInferenceComplete', result, {once: true});
    jest.spyOn(DetectionAPIDetector, 'recognizeSigine').mockResolvedValue([
        {info: {id: 0, name: 'cat', confidence: undefined,
            modelSource: 'DeepSeek', modelName: 'deepseek-v4.1-flash-1017'}, bbox: [10, 20, 80, 100]},
    ]);
    await AIDetectionActions.recognizeSigine([image], () => false);
    const frame = testStore.getState().labels.imagesData[0];
    expect(frame.labelRects[0]).toMatchObject({rect: {x: 10, y: 20, width: 70, height: 80},
        isCreatedByAI: true, isVisible: true, status: LabelStatus.ACCEPTED,
        annotationSource: 'DeepSeek', annotationModel: 'deepseek-v4.1-flash-1017'});
    expect(testStore.getState().labels.imagesData[1]).toEqual(other);
    expect(UndoStack.pop().imagesData[0].labelRects).toEqual([]);
    expect(result.mock.calls[0][0].detail).toMatchObject({status: 'collected', images_processed: 1,
        image_ids: [image.id], boxes_added: 1, annotations: [{id: image.id}]});
});

it('keeps manual changes made while the model was running and reports the stale result', async () => {
    const {testStore, image, other} = setup();
    const result = jest.fn();
    window.addEventListener('sigineInferenceComplete', result, {once: true});
    const manual = {id: 'manual', labelId: null, rect: {x: 1, y: 2, width: 3, height: 4},
        isCreatedByAI: false, isVisible: true, status: LabelStatus.ACCEPTED, suggestedLabel: 'dog'};
    jest.spyOn(DetectionAPIDetector, 'recognizeSigine').mockImplementation(async () => {
        testStore.dispatch(updateImageData([{...image, labelRects: [manual]}, other]));
        return [{info: {id: 0, name: 'cat', confidence: undefined}, bbox: [10, 20, 80, 100]}];
    });
    await AIDetectionActions.recognizeSigine([image], () => false);
    expect(testStore.getState().labels.imagesData[0].labelRects).toEqual([manual]);
    expect(result.mock.calls[0][0].detail).toMatchObject({status: 'incomplete', boxes_added: 0});
});

it('reads the latest frame when a preceding inference updated the original target object', async () => {
    const {testStore, image, other} = setup();
    const manual = {id: 'manual', labelId: null, rect: {x: 1, y: 2, width: 3, height: 4},
        isCreatedByAI: false, isVisible: true, status: LabelStatus.ACCEPTED, suggestedLabel: 'dog'};
    testStore.dispatch(updateImageData([{...image, labelRects: [manual]}, other]));
    jest.spyOn(DetectionAPIDetector, 'recognizeSigine').mockResolvedValue([
        {info: {id: 0, name: 'cat', confidence: undefined}, bbox: [10, 20, 80, 100]},
    ]);
    await AIDetectionActions.recognizeSigine([image], () => false);
    expect(testStore.getState().labels.imagesData[0].labelRects).toHaveLength(2);
    expect(testStore.getState().labels.imagesData[0].labelRects[0]).toEqual(manual);
});

it('validates the exact image/frame indices before selecting inference targets', () => {
    expect(requestedImageIndices(3)).toBeNull();
    sessionStorage.setItem('opensight.annotation.imageIndices', '[2,0]');
    expect(requestedImageIndices(3)).toEqual([2, 0]);
    for (const raw of ['[]', '[3]', '[-1]', '[0,0]', '[false]', '"all"']) {
        sessionStorage.setItem('opensight.annotation.imageIndices', raw);
        expect(() => requestedImageIndices(3)).toThrow();
    }
});
