import {store} from '../../../index';
import {createStore} from 'redux';
import {rootReducer} from '../../../store';
import {addQueueItem, setActiveQueueItem} from '../../../store/queue/actionCreators';
import {addVideoData, updateVideoMode} from '../../../store/video/actionCreators';
import {updateImageData, updateImageDataById} from '../../../store/labels/actionCreators';
import {LabelUtil} from '../../../utils/LabelUtil';
import {QueueActions} from '../QueueActions';
import {EditorModel} from '../../../staticModels/EditorModel';
import {Action} from '../../../store/Actions';
import {
    QueueItem,
    QueueItemStatus,
    QueueItemType,
} from '../../../store/queue/types';
import {VideoData, VideoState} from '../../../store/video/types';
import {FrameExtractorService} from '../../../services/FrameExtractorService';
import {ImageRepository} from '../../imageRepository/ImageRepository';
import {TaskTracker} from '../../../services/TaskTracker';
import {ImageDataUtil} from '../../../utils/ImageDataUtil';

jest.mock('../../../index', () => ({
    store: {
        dispatch: jest.fn(),
        getState: jest.fn(),
    },
}));

jest.mock('../../imageRepository/ImageRepository', () => ({
    ImageRepository: {
        clearCurrentDisplay: jest.fn(),
        getActiveFileId: jest.fn().mockReturnValue(null),
        restoreFileCache: jest.fn().mockReturnValue([]),
        getFileCacheSnapshot: jest.fn().mockReturnValue([]),
        saveFileCache: jest.fn(),
        setActiveFileId: jest.fn(),
    },
}));

jest.mock('../../../services/TaskTracker', () => ({
    TaskTracker: {
        startTask: jest.fn().mockReturnValue({
            id: 'queue-load',
            update: jest.fn(),
            complete: jest.fn(),
            fail: jest.fn(),
            cancel: jest.fn(),
        }),
    },
}));

jest.mock('../../../services/FrameExtractorService', () => ({
    FrameExtractorService: {
        openSession: jest.fn(),
    },
}));

const mockedStore = store as unknown as {
    dispatch: jest.Mock;
    getState: jest.Mock;
};

const metadata = {
    fps: 25,
    duration: 0.08,
    totalFrames: 2,
    width: 1920,
    height: 1080,
};

const makeQueueItem = (overrides: Partial<QueueItem> = {}): QueueItem => ({
    id: 'video-a',
    name: 'video-a.mp4',
    type: QueueItemType.VIDEO,
    file: new File(['video-a'], 'video-a.mp4', {type: 'video/mp4'}),
    extractionMetadata: metadata,
    status: QueueItemStatus.COMPLETED,
    uploadedAt: 1,
    ...overrides,
});

const makeVideoData = (id: string, sessionId?: string): VideoData => ({
    id,
    fileData: new File([id], `${id}.mp4`, {type: 'video/mp4'}),
    loadStatus: true,
    duration: metadata.duration,
    fps: metadata.fps,
    totalFrames: metadata.totalFrames,
    videoSize: {width: metadata.width, height: metadata.height},
    currentFrame: 0,
    currentTime: 0,
    isPlaying: false,
    frames: new Map(),
    sessionId,
});

const useItemsState = (items: QueueItem[], video: VideoState): void => {
    mockedStore.getState.mockReturnValue({
        general: {language: 'en'},
        queue: {items, activeQueueItemId: null},
        video,
    });
};

const useState = (item: QueueItem, video: VideoState): void => {
    useItemsState([item], video);
};

const deferred = <T,>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
} => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
};

const makeSessionResult = (sessionId: string) => ({
    ...metadata,
    sessionId,
});

const makeTaskHandle = (id: string) => ({
    id,
    update: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
    cancel: jest.fn(),
});

type TestAction = {
    type: string;
    payload: {
        activeVideoIndex?: number;
        itemId?: string;
        updates?: Partial<QueueItem>;
        videoData?: VideoData;
    };
};

const dispatched = (type: string): TestAction[] => mockedStore.dispatch.mock.calls
    .map(([action]) => action)
    .filter(action => action.type === type);

describe('QueueActions video session ownership', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedStore.dispatch.mockImplementation(() => undefined);
        (ImageRepository.getActiveFileId as jest.Mock).mockReturnValue(null);
        (ImageRepository.restoreFileCache as jest.Mock).mockReturnValue([]);
        jest.mocked(ImageRepository.getFileCacheSnapshot).mockReturnValue([]);
        (FrameExtractorService.openSession as jest.Mock).mockRejectedValue(new Error('engine offline'));
        global.fetch = jest.fn().mockResolvedValue({ok: true, status: 200});
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        EditorModel.videoSessionId = '';
        EditorModel.videoFrameFiles = [];
        EditorModel.preloadedImageCache = new Map();
        EditorModel.videoFrameImage = null;
        EditorModel.playbackImageData = null;
    });

    it.each<Partial<QueueItem>>([
        {type: QueueItemType.IMAGE, file: undefined},
        {type: QueueItemType.FOLDER, files: undefined},
        {type: QueueItemType.VIDEO, file: undefined},
        {type: QueueItemType.VIDEO, file: new File([], 'missing.mp4'), videoSessionId: 'expired'},
        {type: QueueItemType.CAMERA, cameraResourceId: undefined},
        {type: QueueItemType.VIDEO, file: undefined,
            extractedFrames: Object.assign(new Array<File>(2), {1: new File(['pixels'], 'frame_1.jpg')})},
        {type: QueueItemType.VIDEO, file: undefined, extractionMetadata: undefined,
            extractedFrames: [new File(['pixels'], 'frame_0.jpg'), new File(['pixels'], 'frame_1.jpg')]},
        {type: QueueItemType.VIDEO, file: undefined, extractionMetadata: undefined, videoSessionId: 'expired'},
    ])('keeps the current editor intact when target $type has no usable source', async overrides => {
        const item = makeQueueItem(overrides);
        const previousVideo = makeVideoData('video-old', 'old-session');
        useState(item, {isVideoMode: true, activeVideo: previousVideo,
            videos: [previousVideo], activeVideoIndex: 0});
        const current = [ImageDataUtil.createImageDataFromFileData(new File(['pixels'], 'current.jpg'))];
        jest.mocked(ImageRepository.getActiveFileId).mockReturnValue(previousVideo.id);
        jest.mocked(ImageRepository.restoreFileCache).mockReturnValue(null);
        jest.mocked(ImageRepository.getFileCacheSnapshot).mockReturnValue(null);
        global.fetch = jest.fn().mockResolvedValue({ok: false, status: 404});
        EditorModel.videoSessionId = 'old-session';
        EditorModel.videoFrameFiles = [current[0].fileData];
        const task = makeTaskHandle('missing-source');
        jest.mocked(TaskTracker.startTask).mockReturnValueOnce(task);

        await QueueActions.switchToQueueItem(item, current);

        expect(ImageRepository.clearCurrentDisplay).not.toHaveBeenCalled();
        expect(ImageRepository.setActiveFileId).not.toHaveBeenCalled();
        expect(ImageRepository.restoreFileCache).not.toHaveBeenCalled();
        expect(dispatched(Action.UPDATE_IMAGES_DATA)).toHaveLength(0);
        expect(dispatched(Action.SET_ACTIVE_QUEUE_ITEM)).toHaveLength(0);
        expect(dispatched(Action.ADD_VIDEO_DATA)).toHaveLength(0);
        expect(EditorModel.videoSessionId).toBe('old-session');
        expect(EditorModel.videoFrameFiles).toEqual([current[0].fileData]);
        expect(task.fail).toHaveBeenCalledWith(expect.objectContaining({message: expect.any(String)}));
        expect(task.complete).not.toHaveBeenCalled();
        expect(dispatched(Action.UPDATE_QUEUE_ITEM)).toEqual([expect.objectContaining({payload: {
            itemId: item.id, updates: {status: QueueItemStatus.ERROR, error: expect.any(String)},
        }})]);
    });

    it('allows an explicitly empty folder without treating it as a missing source', async () => {
        const item = makeQueueItem({type: QueueItemType.FOLDER, file: undefined, files: []});
        useState(item, {isVideoMode: false, activeVideo: null, videos: [], activeVideoIndex: -1});
        jest.mocked(ImageRepository.getFileCacheSnapshot).mockReturnValue(null);
        jest.mocked(ImageRepository.restoreFileCache).mockReturnValue(null);
        await QueueActions.switchToQueueItem(item, []);
        expect(dispatched(Action.UPDATE_QUEUE_ITEM).at(-1)?.payload.updates?.status)
            .toBe(QueueItemStatus.COMPLETED);
    });

    it.each([QueueItemType.IMAGE, QueueItemType.FOLDER])('loads cached $type annotations without the original source', async type => {
        const item = makeQueueItem({type, file: undefined, files: undefined});
        useState(item, {isVideoMode: false, activeVideo: null, videos: [], activeVideoIndex: -1});
        const cached = [ImageDataUtil.createImageDataFromFileData(new File(['pixels'], 'cached.jpg'))];
        jest.mocked(ImageRepository.getFileCacheSnapshot).mockReturnValue(cached);
        jest.mocked(ImageRepository.restoreFileCache).mockReturnValue(cached);

        await QueueActions.switchToQueueItem(item, []);

        expect(ImageRepository.clearCurrentDisplay).toHaveBeenCalledTimes(1);
        expect(ImageRepository.restoreFileCache).toHaveBeenCalledWith(item.id);
        expect(jest.mocked(ImageRepository.restoreFileCache).mock.invocationCallOrder[0])
            .toBeGreaterThan(jest.mocked(ImageRepository.clearCurrentDisplay).mock.invocationCallOrder[0]);
        expect(mockedStore.dispatch).toHaveBeenCalledWith({type: Action.UPDATE_IMAGES_DATA,
            payload: {imageData: cached}});
        expect(dispatched(Action.UPDATE_QUEUE_ITEM).at(-1)?.payload.updates?.status)
            .toBe(QueueItemStatus.COMPLETED);
    });

    it.each([new File([], 'server.mp4', {type: 'video/mp4'}), undefined])('keeps validated sessions usable with a placeholder source %s', async file => {
        const item = makeQueueItem({file, videoSessionId: 'valid-session'});
        useState(item, {isVideoMode: false, activeVideo: null, videos: [], activeVideoIndex: -1});
        jest.mocked(ImageRepository.getFileCacheSnapshot).mockReturnValue(null);
        jest.mocked(ImageRepository.restoreFileCache).mockReturnValue(null);

        await QueueActions.switchToQueueItem(item, []);

        const activated = dispatched(Action.ADD_VIDEO_DATA)[0]?.payload.videoData;
        expect(activated?.sessionId).toBe('valid-session');
        expect(activated?.fileData).toBeInstanceOf(File);
        expect(activated?.fileData.size).toBe(0);
        if (file) expect(activated?.fileData).toBe(file);
        expect(FrameExtractorService.openSession).not.toHaveBeenCalled();
    });

    it.each([undefined, new File([], 'placeholder.mp4')])('reactivates a loaded raw video when its queue source is %s', async file => {
        const item = makeQueueItem({file, extractionMetadata: undefined});
        const existing = makeVideoData(item.id);
        useState(item, {isVideoMode: true, activeVideo: existing, videos: [existing], activeVideoIndex: 0});
        await QueueActions.switchToQueueItem(item, []);
        expect(dispatched(Action.ADD_VIDEO_DATA)).toHaveLength(0);
        expect(dispatched(Action.UPDATE_ACTIVE_VIDEO_INDEX)).toEqual([{
            type: Action.UPDATE_ACTIVE_VIDEO_INDEX, payload: {activeVideoIndex: 0},
        }]);
        expect(dispatched(Action.UPDATE_QUEUE_ITEM).at(-1)?.payload.updates?.status)
            .toBe(QueueItemStatus.COMPLETED);
    });

    it('reuses loaded video metadata and complete frames when the queue descriptor omits them', async () => {
        const item = makeQueueItem({file: undefined, extractionMetadata: undefined});
        const frames = [0, 1].map(index => new File(['pixels'], `frame_${index}.jpg`));
        const existing = {...makeVideoData(item.id), fileData: new File([], item.name), preExtractedFrames: frames};
        useState(item, {isVideoMode: true, activeVideo: existing, videos: [existing], activeVideoIndex: 0});
        jest.mocked(ImageRepository.getFileCacheSnapshot).mockReturnValue(null);
        jest.mocked(ImageRepository.restoreFileCache).mockReturnValue(null);

        await QueueActions.switchToQueueItem(item, []);

        expect(EditorModel.videoFrameFiles).toEqual(frames);
        expect(dispatched(Action.UPDATE_ACTIVE_VIDEO_INDEX)).toHaveLength(1);
        expect(dispatched(Action.UPDATE_QUEUE_ITEM).at(-1)?.payload.updates?.status)
            .toBe(QueueItemStatus.COMPLETED);
        expect(FrameExtractorService.openSession).not.toHaveBeenCalled();
    });

    it('keeps complete local frame caches usable without an original video or runtime session', async () => {
        const item = makeQueueItem({file: undefined});
        useState(item, {isVideoMode: false, activeVideo: null, videos: [], activeVideoIndex: -1});
        const cached = [0, 1].map(index => ImageDataUtil.createImageDataFromFileData(
            new File(['pixels'], `frame_${index}.jpg`, {type: 'image/jpeg'}),
        ));
        jest.mocked(ImageRepository.getFileCacheSnapshot).mockReturnValue(cached);
        jest.mocked(ImageRepository.restoreFileCache).mockReturnValue(cached);

        await QueueActions.switchToQueueItem(item, []);

        const activated = dispatched(Action.ADD_VIDEO_DATA)[0]?.payload.videoData;
        expect(activated?.fileData).toBeInstanceOf(File);
        expect(activated?.preExtractedFrames).toEqual(cached.map(image => image.fileData));
        expect(activated?.sessionId).toBeUndefined();
        expect(FrameExtractorService.openSession).not.toHaveBeenCalled();
    });

    it('saves edits made while a new video session is preparing instead of the invocation snapshot', async () => {
        const item = makeQueueItem();
        const previous = makeQueueItem({id: 'video-old'});
        const current = ImageDataUtil.createImageDataFromFileData(new File(['pixels'], 'current.jpg'));
        const liveStore = createStore(rootReducer);
        liveStore.dispatch(addQueueItem(previous));
        liveStore.dispatch(addQueueItem(item));
        liveStore.dispatch(setActiveQueueItem(previous.id));
        liveStore.dispatch(addVideoData(makeVideoData(previous.id, 'old-session')));
        liveStore.dispatch(updateVideoMode(true));
        liveStore.dispatch(updateImageData([current]));
        mockedStore.getState.mockImplementation(liveStore.getState);
        mockedStore.dispatch.mockImplementation(liveStore.dispatch);
        jest.mocked(ImageRepository.getActiveFileId).mockReturnValue(previous.id);
        const opening = deferred<ReturnType<typeof makeSessionResult>>();
        jest.mocked(FrameExtractorService.openSession).mockReturnValueOnce(opening.promise);
        const switching = QueueActions.switchToQueueItem(item, [current]);
        await Promise.resolve();
        expect(ImageRepository.clearCurrentDisplay).not.toHaveBeenCalled();
        const edited = {...current, labelRects: [LabelUtil.createLabelRect(null,
            {x: 1, y: 2, width: 3, height: 4})]};
        liveStore.dispatch(updateImageDataById(current.id, edited));
        opening.resolve(makeSessionResult('new-session'));
        await switching;
        expect(ImageRepository.saveFileCache).toHaveBeenCalledWith(previous.id, [edited]);
        expect(liveStore.getState().queue.activeQueueItemId).toBe(item.id);
    });

    it('uses the target queue item session instead of another video global', async () => {
        const targetFrame = new File(['frame-a'], 'frame_000000.jpg', {type: 'image/jpeg'});
        const item = makeQueueItem({
            videoSessionId: 'session-a',
            extractedFrames: [targetFrame],
        });
        const otherVideo = makeVideoData('video-b', 'session-b');
        useState(item, {
            isVideoMode: true,
            activeVideo: otherVideo,
            videos: [otherVideo],
            activeVideoIndex: 0,
        });
        EditorModel.videoSessionId = 'session-b';
        EditorModel.videoFrameFiles = [new File(['foreign'], 'foreign.jpg')];

        await QueueActions.switchToQueueItem(item, []);

        expect(dispatched(Action.ADD_VIDEO_DATA)[0].payload.videoData?.sessionId)
            .toBe('session-a');
        expect(EditorModel.videoSessionId).toBe('session-a');
        expect(EditorModel.videoFrameFiles).toEqual([targetFrame]);
        expect(EditorModel.preloadedImageCache.size).toBe(0);
    });

    it('captures and persists the legacy global only on the initial open', async () => {
        const item = makeQueueItem({status: QueueItemStatus.PENDING});
        useState(item, {
            isVideoMode: false,
            activeVideo: null,
            videos: [],
            activeVideoIndex: -1,
        });
        EditorModel.videoSessionId = 'legacy-session';

        await QueueActions.switchToQueueItem(item, []);

        expect(dispatched(Action.UPDATE_QUEUE_ITEM)).toContainEqual({
            type: Action.UPDATE_QUEUE_ITEM,
            payload: {
                itemId: item.id,
                updates: {videoSessionId: 'legacy-session'},
            },
        });
        expect(dispatched(Action.ADD_VIDEO_DATA)[0].payload.videoData?.sessionId)
            .toBe('legacy-session');
    });

    it('does not inherit a known different video session', async () => {
        const item = makeQueueItem();
        const otherVideo = makeVideoData('video-b', 'session-b');
        useState(item, {
            isVideoMode: true,
            activeVideo: otherVideo,
            videos: [otherVideo],
            activeVideoIndex: 0,
        });
        EditorModel.videoSessionId = 'session-b';

        await QueueActions.switchToQueueItem(item, []);

        expect(dispatched(Action.ADD_VIDEO_DATA)[0].payload.videoData?.sessionId)
            .toBeUndefined();
        expect(EditorModel.videoSessionId).toBe('');
        expect(dispatched(Action.UPDATE_QUEUE_ITEM).some(action =>
            action.payload.updates?.videoSessionId
        )).toBe(false);
    });

    it('reactivates an existing VideoData instead of appending a duplicate', async () => {
        const item = makeQueueItem({videoSessionId: 'session-a'});
        const existingVideo = makeVideoData(item.id, 'session-a');
        useState(item, {
            isVideoMode: true,
            activeVideo: existingVideo,
            videos: [existingVideo],
            activeVideoIndex: 0,
        });

        await QueueActions.switchToQueueItem(item, []);

        expect(dispatched(Action.ADD_VIDEO_DATA)).toHaveLength(0);
        expect(dispatched(Action.UPDATE_ACTIVE_VIDEO_INDEX)).toEqual([{
            type: Action.UPDATE_ACTIVE_VIDEO_INDEX,
            payload: {activeVideoIndex: 0},
        }]);
    });

    it('reopens an inactive local video that has durable metadata but no runtime lease', async () => {
        const item = makeQueueItem({videoSessionId: undefined});
        useState(item, {
            isVideoMode: false,
            activeVideo: null,
            videos: [],
            activeVideoIndex: -1,
        });
        (FrameExtractorService.openSession as jest.Mock).mockResolvedValue({
            ...metadata,
            sessionId: 'reopened-session',
        });

        await QueueActions.switchToQueueItem(item, []);

        expect(FrameExtractorService.openSession).toHaveBeenCalledWith(item.file);
        expect(dispatched(Action.ADD_VIDEO_DATA)[0].payload.videoData?.sessionId)
            .toBe('reopened-session');
        expect(dispatched(Action.UPDATE_QUEUE_ITEM)).toContainEqual({
            type: Action.UPDATE_QUEUE_ITEM,
            payload: {
                itemId: item.id,
                updates: {
                    videoSessionId: 'reopened-session',
                    extractionMetadata: metadata,
                },
            },
        });
    });

    it('validates and replaces a stale persisted runtime lease before committing', async () => {
        const item = makeQueueItem({videoSessionId: 'stale-session'});
        const staleVideo = makeVideoData(item.id, 'stale-session');
        useState(item, {
            isVideoMode: true,
            activeVideo: staleVideo,
            videos: [staleVideo],
            activeVideoIndex: 0,
        });
        EditorModel.videoSessionId = 'stale-session';
        global.fetch = jest.fn().mockResolvedValue({ok: false, status: 404});
        const reopening = deferred<ReturnType<typeof makeSessionResult>>();
        (FrameExtractorService.openSession as jest.Mock).mockReturnValue(reopening.promise);

        const switching = QueueActions.switchToQueueItem(item, []);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/extraction-status/stale-session'),
            {method: 'GET'},
        );
        expect(FrameExtractorService.openSession).toHaveBeenCalledWith(item.file);
        expect(ImageRepository.clearCurrentDisplay).not.toHaveBeenCalled();
        expect(dispatched(Action.SET_ACTIVE_QUEUE_ITEM)).toHaveLength(0);
        expect(EditorModel.videoSessionId).toBe('stale-session');

        reopening.resolve(makeSessionResult('fresh-session'));
        await switching;

        expect(EditorModel.videoSessionId).toBe('fresh-session');
        expect(dispatched(Action.UPDATE_QUEUE_ITEM)).toContainEqual({
            type: Action.UPDATE_QUEUE_ITEM,
            payload: {
                itemId: item.id,
                updates: {
                    videoSessionId: 'fresh-session',
                    extractionMetadata: metadata,
                },
            },
        });
        expect(dispatched(Action.ADD_VIDEO_DATA)[0].payload.videoData?.sessionId)
            .toBe('fresh-session');
    });

    it('reopens an inactive server video from its durable dataset identity', async () => {
        const item = makeQueueItem({
            file: new File([], 'server-video.mp4', {type: 'video/mp4'}),
            videoSessionId: undefined,
            datasetId: 'dataset/video',
        });
        useState(item, {
            isVideoMode: false,
            activeVideo: null,
            videos: [],
            activeVideoIndex: -1,
        });
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
                sessionId: 'dataset-session',
                metadata,
            }),
        });

        await QueueActions.switchToQueueItem(item, []);

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/datasets/dataset%2Fvideo/video-session'),
            {method: 'POST'},
        );
        expect(dispatched(Action.ADD_VIDEO_DATA)[0].payload.videoData?.sessionId)
            .toBe('dataset-session');
    });

    it('keeps the previous editor visible while a video runtime is still opening', async () => {
        const item = makeQueueItem();
        const previousVideo = makeVideoData('video-old', 'old-session');
        useState(item, {
            isVideoMode: true,
            activeVideo: previousVideo,
            videos: [previousVideo],
            activeVideoIndex: 0,
        });
        (ImageRepository.getActiveFileId as jest.Mock).mockReturnValue('video-old');
        EditorModel.videoSessionId = 'old-session';
        const opening = deferred<ReturnType<typeof makeSessionResult>>();
        (FrameExtractorService.openSession as jest.Mock).mockReturnValue(opening.promise);

        const switching = QueueActions.switchToQueueItem(item, []);
        await Promise.resolve();

        expect(FrameExtractorService.openSession).toHaveBeenCalledWith(item.file);
        expect(ImageRepository.clearCurrentDisplay).not.toHaveBeenCalled();
        expect(ImageRepository.setActiveFileId).not.toHaveBeenCalled();
        expect(dispatched(Action.UPDATE_IMAGES_DATA)).toHaveLength(0);
        expect(dispatched(Action.SET_ACTIVE_QUEUE_ITEM)).toHaveLength(0);
        expect(dispatched(Action.UPDATE_QUEUE_ITEM).some(action =>
            action.payload.updates?.status === QueueItemStatus.PROCESSING
        )).toBe(false);
        expect(EditorModel.videoSessionId).toBe('old-session');

        opening.resolve(makeSessionResult('new-session'));
        await switching;

        expect(ImageRepository.clearCurrentDisplay).toHaveBeenCalledTimes(1);
        expect(ImageRepository.setActiveFileId).toHaveBeenCalledWith(item.id);
        expect(EditorModel.videoSessionId).toBe('new-session');
    });

    it('lets B win when A finishes opening after B', async () => {
        const itemA = makeQueueItem({id: 'video-a', name: 'video-a.mp4'});
        const itemB = makeQueueItem({
            id: 'video-b',
            name: 'video-b.mp4',
            file: new File(['video-b'], 'video-b.mp4', {type: 'video/mp4'}),
        });
        const previousVideo = makeVideoData('video-old', 'old-session');
        useItemsState([itemA, itemB], {
            isVideoMode: true,
            activeVideo: previousVideo,
            videos: [previousVideo],
            activeVideoIndex: 0,
        });
        EditorModel.videoSessionId = 'old-session';
        const openingA = deferred<ReturnType<typeof makeSessionResult>>();
        const openingB = deferred<ReturnType<typeof makeSessionResult>>();
        (FrameExtractorService.openSession as jest.Mock).mockImplementation((file: File) =>
            file.name === 'video-a.mp4' ? openingA.promise : openingB.promise
        );
        const taskA = makeTaskHandle('task-a');
        const taskB = makeTaskHandle('task-b');
        (TaskTracker.startTask as jest.Mock)
            .mockReturnValueOnce(taskA)
            .mockReturnValueOnce(taskB);

        const switchingA = QueueActions.switchToQueueItem(itemA, []);
        await Promise.resolve();
        const switchingB = QueueActions.switchToQueueItem(itemB, []);
        await Promise.resolve();

        expect(taskA.cancel).toHaveBeenCalledTimes(1);
        openingB.resolve(makeSessionResult('session-b'));
        await switchingB;

        expect(EditorModel.videoSessionId).toBe('session-b');
        expect(ImageRepository.setActiveFileId).toHaveBeenLastCalledWith(itemB.id);
        expect(taskB.complete).toHaveBeenCalledTimes(1);
        const dispatchCountAfterB = mockedStore.dispatch.mock.calls.length;
        const clearCountAfterB = (ImageRepository.clearCurrentDisplay as jest.Mock).mock.calls.length;

        openingA.resolve(makeSessionResult('session-a'));
        await switchingA;

        expect(mockedStore.dispatch).toHaveBeenCalledTimes(dispatchCountAfterB);
        expect(ImageRepository.clearCurrentDisplay).toHaveBeenCalledTimes(clearCountAfterB);
        expect(ImageRepository.setActiveFileId).toHaveBeenLastCalledWith(itemB.id);
        expect(EditorModel.videoSessionId).toBe('session-b');
        expect(taskA.complete).not.toHaveBeenCalled();
        expect(taskA.fail).not.toHaveBeenCalled();
        expect(dispatched(Action.UPDATE_QUEUE_ITEM).some(action =>
            action.payload.itemId === itemA.id
        )).toBe(false);
    });

    it('rejects a reopened dataset session from a different revision', async () => {
        const item = makeQueueItem({
            datasetId: 'dataset-video',
            datasetRevision: 7,
            videoSessionId: undefined,
        });
        const previousVideo = makeVideoData('video-old', 'old-session');
        useState(item, {
            isVideoMode: true,
            activeVideo: previousVideo,
            videos: [previousVideo],
            activeVideoIndex: 0,
        });
        EditorModel.videoSessionId = 'old-session';
        const task = makeTaskHandle('revision-task');
        (TaskTracker.startTask as jest.Mock).mockReturnValueOnce(task);
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
                sessionId: 'wrong-revision-session',
                metadata,
                dataset: {revision: 8},
            }),
        });

        await QueueActions.switchToQueueItem(item, []);

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/datasets/dataset-video/video-session?revision=7'),
            {method: 'POST'},
        );
        expect(ImageRepository.clearCurrentDisplay).not.toHaveBeenCalled();
        expect(ImageRepository.setActiveFileId).not.toHaveBeenCalled();
        expect(dispatched(Action.SET_ACTIVE_QUEUE_ITEM)).toHaveLength(0);
        expect(dispatched(Action.UPDATE_IMAGES_DATA)).toHaveLength(0);
        expect(EditorModel.videoSessionId).toBe('old-session');
        expect(dispatched(Action.UPDATE_QUEUE_ITEM)).toEqual([{
            type: Action.UPDATE_QUEUE_ITEM,
            payload: {
                itemId: item.id,
                updates: {
                    status: QueueItemStatus.ERROR,
                    error: '数据集版本不匹配：队列项 v7，服务器 v8',
                },
            },
        }]);
        expect(task.fail).toHaveBeenCalledWith(expect.objectContaining({
            message: '数据集版本不匹配：队列项 v7，服务器 v8',
        }));
        expect(task.complete).not.toHaveBeenCalled();
    });
});
