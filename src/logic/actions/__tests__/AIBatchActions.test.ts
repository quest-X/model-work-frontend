import {combineReducers, createStore} from 'redux';
import {store} from '../../../index';
import {labelsReducer} from '../../../store/labels/reducer';
import {aiReducer} from '../../../store/ai/reducer';
import {generalReducer} from '../../../store/general/reducer';
import {videoReducer} from '../../../store/video/reducer';
import {updateImageData, updateActiveImageIndex} from '../../../store/labels/actionCreators';
import {updateFullImageInferenceStatus} from '../../../store/ai/actionCreators';
import {updateSmartAnnotationActiveStatus} from '../../../store/general/actionCreators';
import {addVideoData, updateVideoMode} from '../../../store/video/actionCreators';
import {LabelStatus} from '../../../data/enums/LabelStatus';
import {LanguageConfig} from '../../../data/LanguageConfig';
import {NotificationUtil} from '../../../utils/NotificationUtil';
import {LabelType} from '../../../data/enums/LabelType';
import {ImageData, LabelRect} from '../../../store/labels/types';
import {VideoData} from '../../../store/video/types';
import {DetectionAPIDetector, DetectionResult} from '../../../ai/DetectionAPIDetector';
import {SegmentationAPIDetector, SegmentationResult} from '../../../ai/SegmentationAPIDetector';
import {DetectSessionAPIService} from '../../../ai/DetectSessionAPIService';
import {FrameExtractorService} from '../../../services/FrameExtractorService';
import {TaskTracker} from '../../../services/TaskTracker';
import {EditorModel} from '../../../staticModels/EditorModel';
import {EditorActions} from '../EditorActions';
import {AIDetectionActions} from '../AIDetectionActions';
import {AISegmentationActions} from '../AISegmentationActions';

jest.mock('../../../index', () => ({store: {dispatch: jest.fn(), getState: jest.fn()}}));
jest.mock('../EditorActions', () => ({EditorActions: {fullRender: jest.fn()}}));
jest.mock('../../../services/FrameExtractorService', () => ({FrameExtractorService: {fetchFrameRange: jest.fn()}}));
jest.mock('../../../services/TaskTracker', () => ({TaskTracker: {startTask: jest.fn()}}));
jest.mock('../../../ai/ActiveModel', () => ({ActiveModel: {getSegmentation: () => null}, formatModelDisplay: () => 'SAM'}));

const reducer = combineReducers({labels: labelsReducer, ai: aiReducer, general: generalReducer, video: videoReducer});
const createTestStore = () => createStore(reducer);
let testStore: ReturnType<typeof createTestStore>;
const mockedStore = store as unknown as {dispatch: jest.Mock; getState: jest.Mock};
const originalCreateImageBitmap = global.createImageBitmap;
const task = {id: 'batch-test', update: jest.fn(), complete: jest.fn(), fail: jest.fn(), cancel: jest.fn()};
const detection: DetectionResult = {info: {id: 1, name: 'target', confidence: 0.8}, bbox: [1, 2, 11, 22]};
const segmentation: SegmentationResult = {info: detection.info, bbox: detection.bbox, mask: [[1, 2], [11, 2], [11, 22]], extra: {tag: 'script-result'}};
const rect = (id: string, ai: boolean): LabelRect => ({id, labelId: null, rect: {x: 0, y: 0, width: 5, height: 5}, isCreatedByAI: ai, isVisible: true, status: LabelStatus.ACCEPTED, suggestedLabel: null});
const makeImages = (count: number): ImageData[] => Array.from({length: count}, (_, index) => ({
    id: `image-${index}`, fileData: new File([`image-${index}`], `frame_${index}.jpg`), loadStatus: true,
    labelRects: [], labelPolygons: [], labelPoints: [], labelLines: [], labelNameIds: [], isVisitedByRoboflowAPI: false,
}));
const useImages = (images: ImageData[]) => {
    testStore.dispatch(updateImageData(images));
    testStore.dispatch(updateActiveImageIndex(-1));
    testStore.dispatch(updateFullImageInferenceStatus(true));
};
const useVideo = (images: ImageData[], overrides: Partial<VideoData> = {}) => {
    useImages(images);
    testStore.dispatch(addVideoData({
        id: 'video', fileData: new File(['video'], 'video.mp4'), loadStatus: true, duration: images.length / 25,
        fps: 25, totalFrames: images.length, videoSize: {width: 2560, height: 1440}, currentFrame: 0,
        currentTime: 0, isPlaying: false, frames: new Map(), ...overrides,
    }));
    testStore.dispatch(updateVideoMode(true));
};

beforeEach(() => {
    jest.clearAllMocks();
    testStore = createTestStore();
    mockedStore.getState.mockImplementation(() => testStore.getState());
    mockedStore.dispatch.mockImplementation(testStore.dispatch);
    (TaskTracker.startTask as jest.Mock).mockReturnValue(task);
    jest.spyOn(DetectionAPIDetector, 'isEnabled').mockReturnValue(true);
    jest.spyOn(SegmentationAPIDetector, 'isEnabled').mockReturnValue(true);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    EditorModel.videoSessionId = '';
    EditorModel.videoElement = null;
    EditorModel.playbackImageData = null;
});

afterEach(() => {
    AIDetectionActions.flushPendingImageUpdates();
    jest.restoreAllMocks();
    global.createImageBitmap = originalCreateImageBitmap;
});

it('detects chunks of eight, skips prior AI results and keeps manual labels on a partial batch failure', async () => {
    const images = makeImages(10);
    images[0].labelRects = [rect('prior-ai', true)];
    images[1].labelRects = [rect('manual', false)];
    useImages(images);
    const batch = jest.spyOn(DetectionAPIDetector, 'predictBatchFromBlobs')
        .mockImplementationOnce(async blobs => blobs.map(() => [detection]))
        .mockRejectedValueOnce(new Error('Last chunk failed'));
    const single = jest.spyOn(DetectionAPIDetector, 'predictFromBlob');

    await AIDetectionActions.detectBatch(images);

    expect(batch.mock.calls.map(([blobs]) => blobs.length)).toEqual([8, 1]);
    expect(single).not.toHaveBeenCalled();
    const state = testStore.getState();
    expect(state.labels.imagesData[0].labelRects).toEqual([rect('prior-ai', true)]);
    expect(state.labels.imagesData[1].labelRects).toHaveLength(2);
    expect(state.labels.imagesData[1].labelRects[0].id).toBe('manual');
    expect(state.ai.imageAIStates.get('image-9')?.inferenceHistory[0]).toMatchObject({success: false, type: 'detection'});
    expect(task.complete).toHaveBeenCalledTimes(1);
    expect(task.fail).not.toHaveBeenCalled();
    expect(state.ai.isFullImageInferenceInProgress).toBe(false);
});

it('marks an entirely failed detection batch as failed', async () => {
    const images = makeImages(2);
    useImages(images);
    jest.spyOn(DetectionAPIDetector, 'predictBatchFromBlobs').mockRejectedValue(new Error('Offline'));
    await AIDetectionActions.detectBatch(images);
    expect(task.fail).toHaveBeenCalledWith(expect.objectContaining({message: 'Batch detection failed for every image'}));
    expect(task.complete).not.toHaveBeenCalled();
    expect(testStore.getState().labels.imagesData.every(image => image.labelRects.length === 0)).toBe(true);
});

it('stops scheduling detection chunks on cancel and keeps results from the in-flight chunk', async () => {
    const images = makeImages(9);
    useImages(images);
    const batch = jest.spyOn(DetectionAPIDetector, 'predictBatchFromBlobs').mockImplementation(async blobs => {
        const options = (TaskTracker.startTask as jest.MockedFunction<typeof TaskTracker.startTask>).mock.calls[0][0];
        options.onCancel?.();
        return blobs.map(() => [detection]);
    });
    await AIDetectionActions.detectBatch(images);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(task.cancel).toHaveBeenCalledTimes(1);
    expect(task.complete).not.toHaveBeenCalled();
    expect(testStore.getState().labels.imagesData.map(image => image.labelRects.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0]);
});

it('falls back only for remaining real frame indices and coalesces repeated streamed writes into playback', async () => {
    const images = makeImages(5);
    images[0].labelRects = [rect('manual', false)];
    images[2].labelRects = [rect('prior-ai', true)];
    useVideo(images, {sessionId: 'video-session'});
    testStore.dispatch(updateSmartAnnotationActiveStatus(true));
    const stream = jest.spyOn(DetectSessionAPIService, 'streamDetectSession').mockImplementation((_params, callbacks) => {
        const controller = new AbortController();
        queueMicrotask(() => {
            callbacks.onFrame({frame_idx: 0, detections: [detection]});
            callbacks.onFrame({frame_idx: 0, detections: [detection]});
            callbacks.onError(new Error('Stream interrupted'));
        });
        return controller;
    });
    (FrameExtractorService.fetchFrameRange as jest.Mock).mockResolvedValue([images[4].fileData]);
    const predict = jest.spyOn(DetectionAPIDetector, 'predictFromBlob').mockResolvedValue([detection]);
    await AIDetectionActions.detectBatch([images[0], images[2], images[4]]);

    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0]).toMatchObject({sessionId: 'video-session', start: 0, end: 1});
    expect(FrameExtractorService.fetchFrameRange).toHaveBeenCalledTimes(1);
    expect(FrameExtractorService.fetchFrameRange).toHaveBeenCalledWith('video-session', 4, 1);
    expect(predict).toHaveBeenCalledWith(images[4].fileData, 'frame_4.jpg');
    expect(testStore.getState().labels.imagesData.map(image => image.labelRects.length)).toEqual([3, 0, 1, 0, 1]);
    expect(EditorModel.playbackImageData.labelRects).toHaveLength(3);
    expect(testStore.getState().labels.activeLabelViewType).toBe(LabelType.RECT);
    expect(testStore.getState().labels.activeLabelType).toBe(LabelType.ALL);
    expect(task.complete).toHaveBeenCalledTimes(1);
});

it.each([
    ['detection', 1280, 720, 4], ['detection', 1920, 1080, 2], ['detection', 2560, 1440, 1],
    ['segmentation', 1280, 720, 4], ['segmentation', 1920, 1080, 2], ['segmentation', 2560, 1440, 1],
] as const)('%s respects the %s×%s frame concurrency limit of %s', async (engine, width, height, limit) => {
    const images = makeImages(4);
    useVideo(images, {preExtractedFrames: images.map(image => image.fileData), videoSize: {width, height}});
    let active = 0;
    let maximum = 0;
    const delay = async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise(resolve => setTimeout(resolve, 1));
        active--;
    };
    if (engine === 'detection') {
        jest.spyOn(DetectionAPIDetector, 'predictFromBlob').mockImplementation(async () => { await delay(); return [detection]; });
        await AIDetectionActions.detectBatch(images);
    } else {
        jest.spyOn(SegmentationAPIDetector, 'predictFromBlob').mockImplementation(async () => { await delay(); return [segmentation]; });
        await AISegmentationActions.segmentBatch(images);
        expect(testStore.getState().labels.imagesData[0].labelPolygons[0].extra).toEqual({tag: 'script-result'});
    }
    expect(maximum).toBe(limit);
    expect(task.complete).toHaveBeenCalledTimes(1);
    expect(task.update).toHaveBeenCalled();
    expect(EditorActions.fullRender).toHaveBeenCalled();
});

it('fetches sparse segmentation frames by their actual index and skips prior AI polygons', async () => {
    const images = makeImages(5);
    useVideo(images, {sessionId: 'seg-session'});
    AISegmentationActions.applySingleResult(images[2], [segmentation]);
    (FrameExtractorService.fetchFrameRange as jest.Mock).mockImplementation(async (_session, frameIdx) => [images[frameIdx].fileData]);
    const predict = jest.spyOn(SegmentationAPIDetector, 'predictFromBlob').mockResolvedValue([segmentation]);
    await AISegmentationActions.segmentBatch([images[2], images[4]]);
    expect(FrameExtractorService.fetchFrameRange).toHaveBeenCalledTimes(1);
    expect(FrameExtractorService.fetchFrameRange).toHaveBeenCalledWith('seg-session', 4, 1);
    expect(predict).toHaveBeenCalledWith(images[4].fileData, 'frame_4.jpg');
    expect(testStore.getState().labels.imagesData[2].labelPolygons).toHaveLength(1);
    expect(testStore.getState().labels.imagesData[4].labelPolygons).toHaveLength(1);
});

it('keeps segmentation cancellation terminal and schedules no later images', async () => {
    const images = makeImages(6);
    useImages(images);
    const predict = jest.spyOn(SegmentationAPIDetector, 'predictFromBlob').mockImplementation(async () => {
        const options = (TaskTracker.startTask as jest.MockedFunction<typeof TaskTracker.startTask>).mock.calls[0][0];
        options.onCancel?.();
        return [segmentation];
    });
    await AISegmentationActions.segmentBatch(images);
    expect(predict).toHaveBeenCalledTimes(1);
    expect(task.cancel).toHaveBeenCalledTimes(1);
    expect(task.complete).not.toHaveBeenCalled();
    expect(testStore.getState().labels.imagesData.map(image => image.labelPolygons.length)).toEqual([1, 0, 0, 0, 0, 0]);
});


it.each(['detection', 'segmentation'] as const)('retries failed browser frame capture and releases its canvas after %s inference', async engine => {
    const images = makeImages(3);
    useVideo(images);
    const video = document.createElement('video');
    Object.defineProperties(video, {
        videoWidth: {value: 640}, videoHeight: {value: 360}, readyState: {value: 4},
        currentTime: {get: () => 0.08, set: () => video.dispatchEvent(new Event('seeked'))},
    });
    EditorModel.videoElement = video;
    const drawImage: CanvasRenderingContext2D['drawImage'] = jest.fn();
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({drawImage} as CanvasRenderingContext2D);
    const blob = new Blob(['captured'], {type: 'image/jpeg'});
    const encode = jest.spyOn(HTMLCanvasElement.prototype, 'toBlob')
        .mockImplementation(callback => callback(blob))
        .mockImplementationOnce(callback => callback(null));
    const close = jest.fn();
    global.createImageBitmap = jest.fn().mockResolvedValue({close});
    const predict = engine === 'detection'
        ? jest.spyOn(DetectionAPIDetector, 'predictFromBlob').mockResolvedValue([detection])
        : jest.spyOn(SegmentationAPIDetector, 'predictFromBlob').mockResolvedValue([segmentation]);

    if (engine === 'detection') await AIDetectionActions.detectBatch([images[2]]);
    else await AISegmentationActions.segmentBatch([images[2]]);

    expect(encode).toHaveBeenCalledTimes(2);
    expect(predict).toHaveBeenCalledWith(blob, 'frame_2.jpg');
    expect(close).toHaveBeenCalledTimes(1);
    expect(encode.mock.instances[0]).toMatchObject({width: 0, height: 0});
    const labels = testStore.getState().labels.imagesData[2];
    expect(engine === 'detection' ? labels.labelRects : labels.labelPolygons).toHaveLength(1);
});

it('marks entirely failed segmentation as failed without creating polygons', async () => {
    const images = makeImages(2);
    useImages(images);
    jest.spyOn(SegmentationAPIDetector, 'predictFromBlob').mockRejectedValue(new Error('Model unavailable'));
    await AISegmentationActions.segmentBatch(images);
    expect(task.fail).toHaveBeenCalledWith(expect.objectContaining({message: 'Batch segmentation failed for every image'}));
    expect(task.complete).not.toHaveBeenCalled();
    expect(testStore.getState().ai.isFullImageInferenceInProgress).toBe(false);
    expect(testStore.getState().ai.imageAIStates.get('image-1')?.inferenceHistory[0]).toMatchObject({success: false, type: 'segmentation'});
    expect(testStore.getState().labels.imagesData.every(image => image.labelPolygons.length === 0)).toBe(true);
});


it.each(['empty', 'cancel'] as const)('does not report success when browser segmentation capture ends with %s', async outcome => {
    const images = makeImages(3);
    useVideo(images);
    const video = document.createElement('video');
    Object.defineProperties(video, {
        videoWidth: {value: 640}, videoHeight: {value: 360}, readyState: {value: 4},
        currentTime: {get: () => 0.08, set: () => video.dispatchEvent(new Event('seeked'))},
    });
    EditorModel.videoElement = video;
    const drawImage: CanvasRenderingContext2D['drawImage'] = jest.fn();
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({drawImage} as CanvasRenderingContext2D);
    const blob = new Blob(['captured'], {type: 'image/jpeg'});
    const encode = jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => {
        if (outcome === 'cancel') testStore.dispatch(updateFullImageInferenceStatus(false));
        callback(outcome === 'empty' ? null : blob);
    });
    const close = jest.fn();
    global.createImageBitmap = jest.fn().mockResolvedValue({close});
    const predict = jest.spyOn(SegmentationAPIDetector, 'predictFromBlob');
    const successNotification = jest.spyOn(NotificationUtil, 'createSuccessNotification');
    const messageNotification = jest.spyOn(NotificationUtil, 'createMessageNotification');

    await AISegmentationActions.segmentBatch([images[2]]);

    expect(predict).not.toHaveBeenCalled();
    expect(task.complete).not.toHaveBeenCalled();
    expect(successNotification).not.toHaveBeenCalled();
    if (outcome === 'empty') {
        expect(encode).toHaveBeenCalledTimes(4);
        expect(task.fail).toHaveBeenCalledTimes(1);
        expect(close).not.toHaveBeenCalled();
    } else {
        expect(encode).toHaveBeenCalledTimes(1);
        expect(task.cancel).toHaveBeenCalledTimes(1);
        expect(messageNotification).toHaveBeenCalledWith(expect.objectContaining({
            header: LanguageConfig[testStore.getState().general.language].taskManager.statusCancelled,
        }));
        expect(close).toHaveBeenCalledTimes(1);
    }
    expect(encode.mock.instances[0]).toMatchObject({width: 0, height: 0});
    expect(testStore.getState().ai.isFullImageInferenceInProgress).toBe(false);
    expect(testStore.getState().labels.imagesData[2].labelPolygons).toEqual([]);
});
