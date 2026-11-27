import {VideoThumbnailService} from '../VideoThumbnailService';
import {EditorModel} from '../../staticModels/EditorModel';

let videos: HTMLVideoElement[];
let drawImage: jest.Mock;
const source = new File(['video'], 'original.mp4', {type: 'video/mp4'});

beforeEach(() => {
    videos = [];
    drawImage = jest.fn();
    const create = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = create(tag);
        if (tag === 'video') {
            const video = element as HTMLVideoElement;
            Object.defineProperties(video, {duration: {value: 10}, readyState: {value: 2},
                videoWidth: {value: 3840}, videoHeight: {value: 2160}});
            videos.push(video);
        }
        return element;
    });
    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({drawImage} as unknown as CanvasRenderingContext2D);
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['thumbnail'], {type: 'image/jpeg'})));
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: jest.fn(() => 'blob:source')});
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: jest.fn()});
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); EditorModel.videoElement = null; });

it('captures the requested frame at thumbnail size without seeking the editor video', async () => {
    const editorVideo = document.createElement('video');
    editorVideo.currentTime = 7;
    EditorModel.videoElement = editorVideo;
    videos = [];
    const result = VideoThumbnailService.capture(source, 2, new AbortController().signal);
    await Promise.resolve();
    expect(videos).toHaveLength(1);
    videos[0].dispatchEvent(new Event('loadedmetadata'));
    expect((await result).type).toBe('image/jpeg');
    expect(videos[0].currentTime).toBe(2);
    expect(drawImage).toHaveBeenCalledWith(videos[0], 0, 0, 200, 113);
    expect(editorVideo.currentTime).toBe(7);
    expect(videos[0].hasAttribute('src')).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:source');
});

it('waits for decoding before drawing and supports frame zero', async () => {
    const result = VideoThumbnailService.capture(source, 0, new AbortController().signal);
    await Promise.resolve();
    const video = videos[0];
    let seeking = true;
    Object.defineProperty(video, 'seeking', {get: () => seeking});
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(drawImage).not.toHaveBeenCalled();
    seeking = false;
    video.dispatchEvent(new Event('loadeddata'));
    await result;
    expect(drawImage).toHaveBeenCalledTimes(1);
});

it('reuses one decoder and source URL for a batch of sixteen visible frames', async () => {
    const requests = Array.from({length: 16}, (_, index) =>
        VideoThumbnailService.capture(source, index / 30, new AbortController().signal));
    await Promise.resolve();
    videos[0].dispatchEvent(new Event('loadedmetadata'));
    await Promise.all(requests);
    expect(videos).toHaveLength(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledTimes(16);
    expect(videos[0].currentTime).toBe(15 / 30);
});

it('releases the previous decoder when queued requests switch source files', async () => {
    const nextSource = new File(['next'], 'next.mp4', {type: 'video/mp4'});
    const first = VideoThumbnailService.capture(source, 1, new AbortController().signal);
    const second = VideoThumbnailService.capture(nextSource, 2, new AbortController().signal);
    await Promise.resolve();
    videos[0].dispatchEvent(new Event('loadedmetadata'));
    await first;
    expect(videos).toHaveLength(2);
    expect(videos[0].hasAttribute('src')).toBe(false);
    videos[1].dispatchEvent(new Event('loadedmetadata'));
    await second;
    expect(URL.createObjectURL).toHaveBeenNthCalledWith(1, source);
    expect(URL.createObjectURL).toHaveBeenNthCalledWith(2, nextSource);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});

it('ignores initial loadeddata and stale events from frame zero while seeking another frame', async () => {
    const result = VideoThumbnailService.capture(source, 3, new AbortController().signal);
    await Promise.resolve();
    const video = videos[0];
    let time = 0;
    let seeking = true;
    Object.defineProperties(video, {currentTime: {get: () => time, set: value => { time = value; }},
        seeking: {get: () => seeking}});
    video.dispatchEvent(new Event('loadeddata'));
    expect(drawImage).not.toHaveBeenCalled();
    video.dispatchEvent(new Event('loadedmetadata'));
    time = 0;
    seeking = false;
    video.dispatchEvent(new Event('loadeddata'));
    expect(drawImage).not.toHaveBeenCalled();
    time = 3;
    video.dispatchEvent(new Event('seeked'));
    await result;
    expect(drawImage).toHaveBeenCalledTimes(1);
});

it('serializes decoding and continues after a cancelled request', async () => {
    const controller = new AbortController();
    const first = VideoThumbnailService.capture(source, 1, controller.signal);
    const rejected = expect(first).rejects.toMatchObject({name: 'AbortError'});
    const second = VideoThumbnailService.capture(source, 2, new AbortController().signal);
    await Promise.resolve();
    expect(videos).toHaveLength(1);
    controller.abort();
    await rejected;
    await Promise.resolve();
    expect(videos).toHaveLength(2);
    videos[1].dispatchEvent(new Event('loadedmetadata'));
    await second;
    expect(drawImage).toHaveBeenCalledTimes(1);
});

it('skips an aborted queued request without creating a decoder', async () => {
    const first = VideoThumbnailService.capture(source, 1, new AbortController().signal);
    const controller = new AbortController();
    const second = VideoThumbnailService.capture(source, 2, controller.signal);
    const rejected = expect(second).rejects.toMatchObject({name: 'AbortError'});
    controller.abort();
    await Promise.resolve();
    videos[0].dispatchEvent(new Event('loadedmetadata'));
    await first;
    await rejected;
    expect(videos).toHaveLength(1);
});

it('times out and releases decoder resources instead of blocking the queue forever', async () => {
    jest.useFakeTimers();
    const result = VideoThumbnailService.capture(source, 1, new AbortController().signal);
    const rejected = expect(result).rejects.toThrow('timed out');
    await Promise.resolve();
    jest.advanceTimersByTime(10000);
    await rejected;
    expect(videos[0].hasAttribute('src')).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:source');
    const next = VideoThumbnailService.capture(source, 2, new AbortController().signal);
    await Promise.resolve();
    videos[1].dispatchEvent(new Event('loadedmetadata'));
    await next;
});

it('reports decode and canvas failures', async () => {
    const failedVideo = VideoThumbnailService.capture(source, 1, new AbortController().signal);
    const rejectedVideo = expect(failedVideo).rejects.toThrow('decode failed');
    await Promise.resolve();
    videos[0].dispatchEvent(new Event('error'));
    await rejectedVideo;
    jest.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => callback(null));
    const failedCanvas = VideoThumbnailService.capture(source, 1, new AbortController().signal);
    const rejectedCanvas = expect(failedCanvas).rejects.toThrow('encoding failed');
    await Promise.resolve();
    videos[1].dispatchEvent(new Event('loadedmetadata'));
    await rejectedCanvas;
});
