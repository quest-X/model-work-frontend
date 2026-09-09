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

describe('image thumbnail failures', () => {
    const failureModes = ['read error', 'read abort', 'read throw', 'decode error', 'decode abort',
        'source throw', 'canvas throw', 'encode throw', 'missing canvas context'] as const;

    const cases = failureModes.map(failure => ({failure, grouped: false}));
    cases.push({failure: 'decode error', grouped: true});

    it.each(cases)('keeps files and imports the next directory after $failure (folder: $grouped)', async ({failure, grouped}) => {
        const damaged = new File(['broken image'], 'damaged.png', {type: 'image/png'});
        const valid = new File(['valid image'], 'valid.png', {type: 'image/png'});
        Object.defineProperty(damaged, 'webkitRelativePath', {value: 'bad/damaged.png'});
        Object.defineProperty(valid, 'webkitRelativePath', {value: 'good/valid.png'});
        const sibling = new File(['valid image'], 'sibling.png', {type: 'image/png'});
        Object.defineProperty(sibling, 'webkitRelativePath', {value: 'bad/sibling.png'});
        const readers: FileReader[] = [];
        const images: HTMLImageElement[] = [];
        const readAsDataURL = FileReader.prototype.readAsDataURL;
        const read = jest.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader, file) {
            readers.push(this);
            if (file === damaged) {
                if (failure === 'read throw') throw new Error('Cannot read file');
                if (failure === 'read error') {
                    this.dispatchEvent(new ProgressEvent('error'));
                    return;
                }
            }
            readAsDataURL.call(this, file);
            if (file === damaged && failure === 'read abort') this.abort();
        });
        const imageConstructor = jest.spyOn(window, 'Image').mockImplementation(() => {
            const image = document.createElement('img');
            images.push(image);
            Object.defineProperties(image, {
                width: {value: 200},
                height: {value: 50},
                src: {set(value: string) {
                    image.setAttribute('src', value);
                    const broken = value.includes(btoa('broken image'));
                    if (broken && failure === 'source throw') throw new Error('Cannot set image source');
                    const event = broken && failure === 'decode error' ? 'error'
                        : broken && failure === 'decode abort' ? 'abort' : 'load';
                    image.dispatchEvent(new Event(event));
                }},
            });
            return image;
        });
        const drawImage: CanvasRenderingContext2D['drawImage'] = jest.fn();
        if (failure === 'canvas throw') jest.mocked(drawImage).mockImplementationOnce(() => {throw new Error('Cannot draw');});
        const context = jest.spyOn(HTMLCanvasElement.prototype, 'getContext')
            .mockReturnValue({drawImage} as CanvasRenderingContext2D);
        if (failure === 'missing canvas context') context.mockReturnValueOnce(null);
        const encode = jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;thumbnail');
        if (failure === 'encode throw') encode.mockImplementationOnce(() => {throw new Error('Cannot encode');});
        try {
            const items = await createDroppedMediaQueueItems(grouped ? [damaged, sibling, valid] : [damaged, valid], jest.fn());
            expect(items).toHaveLength(2);
            expect(items[0]).toMatchObject(grouped
                ? {files: [damaged, sibling], name: 'bad', type: QueueItemType.FOLDER, status: QueueItemStatus.PENDING}
                : {file: damaged, type: QueueItemType.IMAGE, status: QueueItemStatus.PENDING});
            expect(items[0].thumbnail).toBeUndefined();
            expect(items[1]).toMatchObject({file: valid, thumbnail: 'data:image/png;thumbnail'});
            expect(drawImage).toHaveBeenLastCalledWith(expect.any(HTMLImageElement), 0, 0, 100, 25);
            for (const reader of readers) {
                expect([reader.onload, reader.onerror, reader.onabort]).toEqual([null, null, null]);
            }
            for (const image of images) {
                expect([image.onload, image.onerror, image.onabort]).toEqual([null, null, null]);
                expect(image.getAttribute('src')).toBeNull();
            }
        } finally {
            read.mockRestore();
            imageConstructor.mockRestore();
            context.mockRestore();
            encode.mockRestore();
        }
    }, 1000);
});
