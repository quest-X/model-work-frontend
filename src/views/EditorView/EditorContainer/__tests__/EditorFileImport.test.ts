import {createDroppedMediaQueueItems, groupDroppedImages} from '../EditorFileImport';
import {FrameExtractorService} from '../../../../services/FrameExtractorService';
import {QueueItemStatus, QueueItemType} from '../../../../store/queue/types';
import {EditorModel} from '../../../../staticModels/EditorModel';
import {store} from '../../../../index';

jest.mock('../../../../services/FrameExtractorService', () => ({
    FrameExtractorService: {openSession: jest.fn(), fetchFrameRange: jest.fn()},
}));

const metadata = {fps: 25, duration: 4, totalFrames: 100, width: 1920, height: 1080};

it('keeps directory grouping and per-video session ownership during imports', async () => {
    const image = new File(['image'], 'a.jpg', {type: 'image/jpeg'});
    Object.defineProperty(image, 'webkitRelativePath', {value: 'project/line-a/a.jpg'});
    const loose = new File(['image'], 'b.jpg', {type: 'image/jpeg'});
    expect([...groupDroppedImages([image, loose])]).toEqual([['line-a', [image]], ['images', [loose]]]);
    const videos = ['a.mp4', 'b.mp4'].map(name => new File(['video'], name, {type: 'video/mp4'}));
    const progress = jest.fn();
    jest.mocked(FrameExtractorService.openSession)
        .mockResolvedValueOnce({...metadata, sessionId: 'session-a'})
        .mockResolvedValueOnce({...metadata, sessionId: 'session-b'});
    jest.mocked(FrameExtractorService.fetchFrameRange).mockResolvedValue([]);
    const items = await createDroppedMediaQueueItems(videos, progress);
    expect(items.map(item => [item.name, item.type, item.status, item.videoSessionId, item.extractionMetadata]))
        .toEqual(videos.map((file, index) => [file.name, QueueItemType.VIDEO, QueueItemStatus.PENDING,
            index === 0 ? 'session-a' : 'session-b', metadata]));
    expect(EditorModel.videoSessionId).toBe('session-b');
    expect(progress).toHaveBeenLastCalledWith(null);
    expect(FrameExtractorService.fetchFrameRange).toHaveBeenNthCalledWith(1, 'session-a', 0, 1);
    expect(FrameExtractorService.fetchFrameRange).toHaveBeenNthCalledWith(2, 'session-b', 0, 1);
});

it('retains a raw video item and the actionable error when extraction fails', async () => {
    jest.useFakeTimers();
    const createElement = document.createElement.bind(document);
    const create = jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = createElement(tag);
        if (tag === 'video') Object.defineProperty(element, 'src', {set() {
            element.dispatchEvent(new Event('error'));
        }});
        return element;
    });
    const createUrl = URL.createObjectURL;
    const revokeUrl = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:raw-video');
    URL.revokeObjectURL = jest.fn();
    const dispatch = jest.spyOn(store, 'dispatch');
    try {
        jest.mocked(FrameExtractorService.openSession).mockRejectedValueOnce({response: {data: {detail: 'Disk full'}}});
        const file = new File(['video'], 'fallback.mp4', {type: 'video/mp4'});
        const items = await createDroppedMediaQueueItems([file], jest.fn());
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({file, type: QueueItemType.VIDEO, status: QueueItemStatus.PENDING});
        expect(items[0].videoSessionId).toBeUndefined();
        expect(JSON.stringify(dispatch.mock.calls)).toContain('Disk full');
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:raw-video');
    } finally {
        create.mockRestore();
        dispatch.mockRestore();
        URL.createObjectURL = createUrl;
        URL.revokeObjectURL = revokeUrl;
        jest.clearAllTimers();
        jest.useRealTimers();
    }
});
