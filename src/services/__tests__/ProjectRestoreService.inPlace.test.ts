import {applyMiddleware, createStore} from 'redux';
import {waitFor} from '@testing-library/react';
import {rootReducer} from '../../store';
import {store} from '../../index';
import {ProjectRestoreService} from '../ProjectRestoreService';
import {IndexedDBManager, StoredProjectData} from '../../utils/IndexedDBManager';
import {ImageRepository} from '../../logic/imageRepository/ImageRepository';
import {undoMiddleware} from '../../logic/undo/undoMiddleware';
import {RestoreFlag, UndoStack} from '../../logic/undo/UndoStack';
import {addQueueItem, setActiveQueueItem} from '../../store/queue/actionCreators';
import {addVideoData, updateVideoMode} from '../../store/video/actionCreators';
import {updateFullImageInferenceStatus, updateSegmentationResults} from '../../store/ai/actionCreators';
import {updateImageData, updateImageDataById, updateLabelNames} from '../../store/labels/actionCreators';
import {QueueItemStatus, QueueItemType} from '../../store/queue/types';
import {ImageDataUtil} from '../../utils/ImageDataUtil';
import {EditorModel} from '../../staticModels/EditorModel';
import {FrameExtractorService} from '../FrameExtractorService';

jest.mock('../../index', () => ({store: {getState: jest.fn(), dispatch: jest.fn()}}));
jest.mock('../FrameExtractorService', () => ({FrameExtractorService: {openSession: jest.fn()}}));

const targetProject = (): StoredProjectData => ({
    id: 'workspace:target', workspaceId: 'target', projectName: 'New task',
    images: [{id: 'new-image', fileName: 'new.jpg', fileType: 'image/jpeg',
        fileData: new Uint8Array([1, 2]).buffer, loadStatus: false,
        labelRects: [], labelLines: [], labelPoints: [], labelPolygons: [], labelNameIds: []}],
    labelNames: [], currentImageIndex: 0, lastModified: 10, version: '3.0.0-recovery',
    queueItems: [{id: 'new-file', name: 'new.jpg', type: QueueItemType.IMAGE,
        file: new File(['new'], 'new.jpg'), status: QueueItemStatus.COMPLETED, uploadedAt: 1}],
    activeQueueItemId: 'new-file',
});

const fixture = () => {
    const testStore = createStore(rootReducer, applyMiddleware(undoMiddleware));
    jest.mocked(store.getState).mockImplementation(() => testStore.getState());
    jest.mocked(store.dispatch).mockImplementation(testStore.dispatch);
    const oldImage = ImageDataUtil.createImageDataFromFileData(new File(['old'], 'old.jpg'));
    testStore.dispatch(updateImageData([oldImage]));
    testStore.dispatch(updateLabelNames([{id: 'old-label', name: 'Old label'}]));
    testStore.dispatch(addQueueItem({id: 'old-file', name: 'old', type: QueueItemType.IMAGE,
        status: QueueItemStatus.COMPLETED, uploadedAt: 1}));
    testStore.dispatch(setActiveQueueItem('old-file'));
    testStore.dispatch(updateSegmentationResults([{} as never], oldImage.id));
    testStore.dispatch(addVideoData({id: 'old-video', fileData: new File(['old'], 'old.mp4'),
        fps: 30, duration: 1, totalFrames: 30, videoSize: {width: 10, height: 10}, loadStatus: true,
        currentFrame: 0, currentTime: 0, isPlaying: false, frames: new Map()}));
    testStore.dispatch(updateVideoMode(true));
    ImageRepository.setActiveFileId('old-file');
    ImageRepository.saveFileCache('old-file', [oldImage]);
    return {testStore, oldImage};
};

beforeEach(() => {
    jest.clearAllMocks();
    RestoreFlag.set(false);
    UndoStack.clear();
    ImageRepository.clearAllCache();
    EditorModel.pendingPrompts = [];
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(IndexedDBManager, 'loadProject').mockResolvedValue(targetProject());
});
afterEach(() => {
    jest.restoreAllMocks();
    ImageRepository.clearAllCache();
    UndoStack.clear();
});

it('keeps the old canvas until ready, then replaces project data and isolates undo without resetting app settings', async () => {
    const {testStore} = fixture();
    const before = testStore.getState();
    let ready: () => void;
    const opening = ProjectRestoreService.restoreProject(undefined, {replaceCurrent: true,
        beforeCommit: () => new Promise<void>(resolve => { ready = resolve; })});
    await waitFor(() => expect(ready).toEqual(expect.any(Function)));
    expect(testStore.getState()).toBe(before);
    expect(ImageRepository.hasFileCache('old-file')).toBe(true);
    ready();
    await expect(opening).resolves.toBe(true);

    const after = testStore.getState();
    expect(after.queue.items.map(item => item.id)).toEqual(['new-file']);
    expect(after.queue.activeQueueItemId).toBe('new-file');
    expect(after.labels.imagesData.map(image => image.id)).toEqual(['new-image']);
    expect(after.labels.labels).toEqual([]);
    expect(after.video.videos).toEqual([]);
    expect(after.video.isVideoMode).toBe(false);
    expect(after.ai.segmentationResults).toEqual([]);
    expect(after.ai.imageSegmentationResults.size).toBe(0);
    expect(after.ai.imageAIStates).toBe(before.ai.imageAIStates);
    expect(after.general.windowSize).toBe(before.general.windowSize);
    expect(after.general.language).toBe(before.general.language);
    expect(after.aimodels).toBe(before.aimodels);
    expect(ImageRepository.hasFileCache('old-file')).toBe(false);
    expect(ImageRepository.getActiveFileId()).toBe('new-file');
    expect(UndoStack.canUndo()).toBe(false);
    testStore.dispatch(updateImageDataById('new-image', {...after.labels.imagesData[0], isSelected: true}));
    expect(UndoStack.pop().imagesData.map(image => image.id)).toEqual(['new-image']);
});

it('replaces the video timeline and restores the saved frame without appending the old video', async () => {
    const {testStore} = fixture();
    const metadata = {fps: 30, duration: 0.1, totalFrames: 3, width: 1920, height: 1080};
    const sourceFile = new File(['video'], 'new.mp4', {type: 'video/mp4'});
    const target = {...targetProject(), images: [], currentImageIndex: 2, isVideoProject: true,
        extractionMetadata: metadata,
        videoRecovery: {mode: 'on-demand' as const, sourceQueueItemId: 'new-file', sourceFile, metadata}};
    target.queueItems[0] = {...target.queueItems[0], name: 'new.mp4', type: QueueItemType.VIDEO,
        file: sourceFile, extractionMetadata: metadata};
    jest.mocked(IndexedDBManager.loadProject).mockResolvedValue(target);
    jest.mocked(FrameExtractorService.openSession).mockResolvedValue({...metadata, frames: [],
        sessionId: 'fresh-session'} as never);
    await expect(ProjectRestoreService.restoreProject(undefined, {replaceCurrent: true})).resolves.toBe(true);
    const state = testStore.getState();
    expect(state.video.videos.map(video => video.id)).toEqual(['new-file']);
    expect(state.video.activeVideo.currentFrame).toBe(2);
    expect(state.labels.activeImageIndex).toBe(2);
    expect(state.labels.imagesData).toHaveLength(3);
    expect(EditorModel.videoSessionId).toBe('fresh-session');
});

it('preserves the old project, cache and undo when the writer handoff fails', async () => {
    const {testStore} = fixture();
    const before = testStore.getState();
    const undoSize = UndoStack.size();
    await expect(ProjectRestoreService.restoreProject(undefined, {replaceCurrent: true,
        beforeCommit: async () => { throw new Error('Snapshot changed'); }})).rejects.toThrow('Snapshot changed');
    expect(testStore.getState()).toBe(before);
    expect(ImageRepository.hasFileCache('old-file')).toBe(true);
    expect(UndoStack.size()).toBe(undoSize);
    expect(RestoreFlag.get()).toBe(false);
});

it('keeps active annotation writes in their original project', async () => {
    const {testStore} = fixture();
    testStore.dispatch(updateFullImageInferenceStatus(true));
    const before = testStore.getState();
    await expect(ProjectRestoreService.restoreProject(undefined, {replaceCurrent: true})).rejects.toThrow('当前任务仍在');
    expect(IndexedDBManager.loadProject).not.toHaveBeenCalled();
    expect(testStore.getState()).toBe(before);
});
