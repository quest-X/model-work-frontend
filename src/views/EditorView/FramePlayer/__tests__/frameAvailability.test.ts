import React from 'react';
import {act, render} from '@testing-library/react';
import FramePlayer, {getFrameAvailability} from '../FramePlayer';
import {EditorModel} from '../../../../staticModels/EditorModel';
import {FrameExtractorService, SessionExpiredError} from '../../../../services/FrameExtractorService';
import {Language} from '../../../../data/LanguageConfig';

it('reports the first cache gap and required buffer without exceeding the end of the video', () => {
    const image = new Image();
    const cache = new Map([[2, image], [3, image], [5, image]]);
    expect(getFrameAvailability(cache, 2, 10, 8, 4)).toEqual({target: 4, backgroundLoad: {ahead: 2, min: 4}});
    cache.set(4, image);
    expect(getFrameAvailability(cache, 2, 6, 8, 4)).toEqual({target: -1, backgroundLoad: null});
    expect(getFrameAvailability(cache, 5, 6, 8, 4)).toEqual({target: -1, backgroundLoad: null});
    expect(getFrameAvailability(cache, -1, 6, 8, 4)).toEqual({target: 0, backgroundLoad: {ahead: 0, min: 4}});
});

const nextTurn = jest.requireActual<typeof import('timers')>('timers').setImmediate;
const flushPromises = () => new Promise<void>(resolve => nextTurn(resolve));
const frames = [];
const playerProps = {
    language: Language.ENGLISH, frames, sessionId: 'session', fps: 1, duration: 150,
    totalFrames: 150, videoSize: {width: 10, height: 10}, currentTime: 20, currentFrame: 20,
};

describe('FramePlayer failed buffer requests', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        // Match the browser's shared monotonic clock for performance.now and rAF.
        const clockStart = Date.now();
        jest.spyOn(performance, 'now').mockImplementation(() => Date.now() - clockStart);
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback =>
            window.setTimeout(() => callback(performance.now()), 16));
        jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => window.clearTimeout(id));
        EditorModel.videoFrameFiles = [];
        EditorModel.canvas = null;
        EditorModel.videoFrameImage = null;
        EditorModel.preloadedImageCache = new Map(Array.from({length: 20}, (_, i) => [i, new Image()]));
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const context: Pick<CanvasRenderingContext2D, 'clearRect' | 'drawImage'> = {
            clearRect: jest.fn(), drawImage: jest.fn(),
        };
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
        Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: jest.fn(() => 'blob:frame')});
        Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: jest.fn()});
        jest.spyOn(window, 'Image').mockImplementation(() => {
            const image = document.createElement('img');
            Object.defineProperty(image, 'src', {set(value: string) {
                image.setAttribute('src', value);
                Promise.resolve().then(() => image.dispatchEvent(new Event('load')));
            }});
            return image;
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
        EditorModel.videoFrameFiles = [];
        EditorModel.preloadedImageCache.clear();
    });

    it.each([false, true])('backs off failed urgent loads and recovers (playing=%s)', async isPlaying => {
        let calls = 0;
        let healthy = false;
        const fetch = jest.spyOn(FrameExtractorService, 'fetchFrameRange').mockImplementation(async () => {
            calls++;
            if (healthy) return Array.from({length: 100}, (_, i) => new File(['frame'], `frame_${i}.jpg`));
            // Bound the broken implementation too, so this regression cannot hang Jest.
            if (calls > 3) return new Promise(() => undefined);
            throw new Error('HTTP 503');
        });
        const view = render(React.createElement(FramePlayer, {...playerProps, isPlaying}));
        await act(flushPromises);
        await act(async () => { jest.advanceTimersByTime(100); await flushPromises(); });
        await act(async () => { jest.advanceTimersByTime(300); await flushPromises(); });
        expect(fetch).toHaveBeenCalled();
        expect(fetch.mock.calls.length).toBeLessThanOrEqual(2);
        healthy = true;
        await act(async () => { jest.advanceTimersByTime(1000); await flushPromises(); });
        expect(EditorModel.videoFrameFiles[20]?.size).toBeGreaterThan(0);
        expect(EditorModel.videoFrameImage?.getAttribute('src')).toBe('blob:frame');
        view.unmount();
        const stoppedAt = fetch.mock.calls.length;
        await act(async () => { jest.advanceTimersByTime(5000); await flushPromises(); });
        expect(fetch).toHaveBeenCalledTimes(stoppedAt);
    });

    it('fetches real bytes for an on-demand zero-byte placeholder', async () => {
        let checks = 0;
        const placeholder = new File([], 'frame_20.jpg');
        // Bound the original microtask retry loop; the assertions still require an actual fetch.
        Object.defineProperty(placeholder, 'size', {get: () => ++checks > 8 ? 1 : 0});
        EditorModel.videoFrameFiles[20] = placeholder;
        const fetch = jest.spyOn(FrameExtractorService, 'fetchFrameRange').mockResolvedValue(
            Array.from({length: 21}, (_, i) => new File(['real frame'], `frame_${i}.jpg`)),
        );
        const view = render(React.createElement(FramePlayer, {...playerProps, totalFrames: 21, duration: 21}));
        await act(flushPromises);
        await act(async () => { jest.advanceTimersByTime(100); await flushPromises(); });
        expect(EditorModel.videoFrameFiles[20]).not.toBe(placeholder);
        expect(fetch).toHaveBeenCalledWith('session', 0, 21);
        view.unmount();
    });

    it('does not draw a late old seek over a newer frame', async () => {
        const finishes = new Map<number, (files: File[]) => void>();
        jest.spyOn(FrameExtractorService, 'fetchFrameRange').mockImplementation((_, start) =>
            new Promise(resolve => { finishes.set(start, resolve); }));
        const view = render(React.createElement(FramePlayer, playerProps));
        await act(flushPromises);
        await act(async () => { jest.advanceTimersByTime(100); await flushPromises(); });
        view.rerender(React.createElement(FramePlayer, {...playerProps, currentTime: 120, currentFrame: 120}));
        await act(flushPromises);
        await act(async () => {
            finishes.get(100)(Array.from({length: 50}, () => new File(['new'], 'new.jpg')));
            await flushPromises();
        });
        const currentImage = EditorModel.videoFrameImage;
        expect(currentImage).not.toBeNull();
        await act(async () => {
            finishes.get(0)(Array.from({length: 100}, () => new File(['old'], 'old.jpg')));
            await flushPromises();
        });
        expect(EditorModel.videoFrameImage).toBe(currentImage);
        view.unmount();
    });

    it('retries a temporary first-frame failure and completes metadata initialization', async () => {
        EditorModel.preloadedImageCache.clear();
        const metadata = jest.fn();
        const fetch = jest.spyOn(FrameExtractorService, 'fetchFrameRange')
            .mockRejectedValueOnce(new Error('HTTP 503'))
            .mockResolvedValue(Array.from({length: 100}, () => new File(['real'], 'frame.jpg')));
        const view = render(React.createElement(FramePlayer, {...playerProps, onLoadedMetadata: metadata}));
        await act(flushPromises);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(metadata).not.toHaveBeenCalled();
        await act(async () => { jest.advanceTimersByTime(1000); await flushPromises(); });
        expect(metadata).toHaveBeenCalledTimes(1);
        view.unmount();
    });

    it('stops retrying an expired session and keeps its visible recovery message', async () => {
        EditorModel.preloadedImageCache.clear();
        const fetch = jest.spyOn(FrameExtractorService, 'fetchFrameRange')
            .mockRejectedValue(new SessionExpiredError('session'));
        const view = render(React.createElement(FramePlayer, playerProps));
        await act(flushPromises);
        expect(view.getByText('视频会话已失效')).toBeInTheDocument();
        await act(async () => { jest.advanceTimersByTime(5000); await flushPromises(); });
        expect(fetch).toHaveBeenCalledTimes(1);
        view.unmount();
    });

    it('does not publish a thumbnail whose encoding finishes after unmount', async () => {
        const encodings: BlobCallback[] = [];
        jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => encodings.push(callback));
        const ready = jest.fn();
        const view = render(React.createElement(FramePlayer, {...playerProps, onFrameReady: ready}));
        await act(flushPromises);
        await act(async () => { jest.advanceTimersByTime(100); await flushPromises(); });
        expect(encodings.length).toBeGreaterThan(0);
        view.unmount();
        await act(async () => {
            encodings.forEach(finish => finish(new Blob(['thumbnail'])));
            await flushPromises();
        });
        expect(ready).not.toHaveBeenCalled();
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('ignores late batch completion after unmount instead of decoding old frames', async () => {
        let finish: (files: File[]) => void;
        jest.spyOn(FrameExtractorService, 'fetchFrameRange').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const view = render(React.createElement(FramePlayer, playerProps));
        await act(flushPromises);
        await act(async () => { jest.advanceTimersByTime(100); await flushPromises(); });
        expect(finish).toBeDefined();
        view.unmount();
        await act(async () => { finish([new File(['late'], 'frame_0.jpg')]); await flushPromises(); });
        expect(EditorModel.videoFrameFiles[0]).toBeUndefined();
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });
});
