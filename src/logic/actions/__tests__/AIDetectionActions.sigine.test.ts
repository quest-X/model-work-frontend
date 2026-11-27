import {EditorModel} from '../../../staticModels/EditorModel';
import configureStore from '../../../configureStore';
import {store} from '../../../index';
import {AIDetectionActions} from '../AIDetectionActions';
import {DetectionAPIDetector} from '../../../ai/DetectionAPIDetector';
import {ImageDataUtil} from '../../../utils/ImageDataUtil';
import {updateImageData} from '../../../store/labels/actionCreators';
import axios from 'axios';

jest.mock('../../../index', () => ({store: {getState: jest.fn(), dispatch: jest.fn()}}));
jest.mock('../EditorActions', () => ({EditorActions: {fullRender: jest.fn()}}));

it.each([true, false])('shows the Sigine error detail with a server-error fallback (detail=%s)', async hasDetail => {
    const testStore = configureStore();
    (store.getState as jest.Mock).mockImplementation(testStore.getState);
    const frame = ImageDataUtil.createImageDataFromFileData(new File(['image'], 'test.png', {type: 'image/png'}));
    const detail = 'Sigine 模型调用失败（HTTP 403）。请检查模型访问范围与授权。';
    localStorage.setItem('opensight.sigineInfraSelection', JSON.stringify({source_id: 'fixture', model: 'vision'}));
    jest.spyOn(axios, 'post').mockRejectedValue({isAxiosError: true, response: {
        status: 502, statusText: 'Bad Gateway', data: hasDetail ? {detail} : {detail: []},
    }});
    try {
        await expect(DetectionAPIDetector.recognizeSigine(frame)).rejects.toThrow(
            hasDetail ? detail : 'Server error: 502 Bad Gateway');
    } finally {
        localStorage.removeItem('opensight.sigineInfraSelection');
        jest.restoreAllMocks();
    }
});

it('attaches the provider/model to boxes without inventing a confidence', async () => {
    const frame = ImageDataUtil.createImageDataFromFileData(new File(['image'], 'test.png', {type: 'image/png'}));
    localStorage.setItem('opensight.sigineInfraSelection', JSON.stringify({
        source_id: 'fixture', model: 'deepseek-v4.1-flash-1017',
    }));
    jest.spyOn(axios, 'post').mockResolvedValue({data: {
        boxes: [{label: 'cat', bbox: [10, 20, 80, 100]}],
    }});
    try {
        const [result] = await DetectionAPIDetector.recognizeSigine(frame);
        expect(result.info).toMatchObject({
            modelSource: 'DeepSeek', modelName: 'deepseek-v4.1-flash-1017', confidence: undefined,
        });
    } finally {
        localStorage.removeItem('opensight.sigineInfraSelection');
        jest.restoreAllMocks();
    }
});

it('appends Sigine boxes to the requested frame and preserves existing boxes and other frames', async () => {
    const testStore = configureStore();
    (store.getState as jest.Mock).mockImplementation(testStore.getState);
    (store.dispatch as unknown as jest.Mock).mockImplementation(testStore.dispatch);
    const first = ImageDataUtil.createImageDataFromFileData(new File(['image'], 'test.png', {type: 'image/png'}));
    const other = ImageDataUtil.createImageDataFromFileData(new File(['image'], 'other.png', {type: 'image/png'}));
    const previous = {id: 'old', rect: {x: 1, y: 2, width: 3, height: 4}, isCreatedByAI: true};
    first.labelRects = [previous as typeof first.labelRects[number]];
    testStore.dispatch(updateImageData([first, other]));
    jest.spyOn(DetectionAPIDetector, 'recognizeSigine').mockResolvedValue([
        {info: {id: 0, name: 'cat', confidence: undefined}, bbox: [10, 20, 80, 100]},
    ]);
    await AIDetectionActions.recognizeSigine([first], () => false);
    const images = testStore.getState().labels.imagesData;
    expect(images[0].labelRects).toHaveLength(2);
    expect(images[0].labelRects[0]).toEqual(previous);
    expect(images[0].labelRects[1].rect).toEqual({x: 10, y: 20, width: 70, height: 80});
    expect(images[1]).toEqual(other);
    jest.restoreAllMocks();
});

it.each([false, true])('does not seek a dormant video on image recognition (failed=%s)', async failed => {
    const testStore = configureStore();
    (store.getState as jest.Mock).mockImplementation(testStore.getState);
    (store.dispatch as unknown as jest.Mock).mockImplementation(testStore.dispatch);
    const frame = ImageDataUtil.createImageDataFromFileData(new File(['frame'], 'frame_000824.jpg', {type: 'image/jpeg'}));
    testStore.dispatch(updateImageData([frame]));
    const video = document.createElement('video');
    const seek = jest.fn();
    Object.defineProperty(video, 'currentTime', {get: () => 0, set: seek});
    EditorModel.videoElement = video;
    jest.spyOn(DetectionAPIDetector, 'recognizeSigine').mockImplementation(async () => {
        if (failed) throw new Error('Synthetic upstream error');
        return [];
    });
    try {
        await AIDetectionActions.recognizeSigine([frame], () => false);
        expect(seek).not.toHaveBeenCalled();
    } finally {
        EditorModel.videoElement = null;
        jest.restoreAllMocks();
    }
});
