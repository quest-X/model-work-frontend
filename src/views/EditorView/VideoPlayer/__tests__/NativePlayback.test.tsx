import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react';
import VideoPlayer from '../VideoPlayer';
import {Language} from '../../../../data/LanguageConfig';
import {EditorModel} from '../../../../staticModels/EditorModel';
import {EditorActions} from '../../../../logic/actions/EditorActions';

jest.mock('../../../../logic/actions/EditorActions', () => ({EditorActions: {setActiveImage: jest.fn(), fullRender: jest.fn()}}));

beforeEach(() => {
    jest.clearAllMocks();
    EditorModel.canvas = document.createElement('canvas');
    EditorModel.videoFrameImage = null;
    EditorModel.videoFrameCanvas = null;
    jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({clearRect: jest.fn(), drawImage: jest.fn()} as unknown as CanvasRenderingContext2D);
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(null));
    HTMLVideoElement.prototype.requestVideoFrameCallback = jest.fn(() => 1);
    HTMLVideoElement.prototype.cancelVideoFrameCallback = jest.fn();
});
afterEach(() => { jest.restoreAllMocks(); EditorModel.videoElement = null; EditorModel.videoFrameCanvas = null; EditorModel.videoFrameImage = null; EditorModel.canvas = null; });

it('uses authoritative fractional fps and frame count, supports one-frame seeks, and keeps play stable on callback changes', async () => {
    const metadata = jest.fn();
    const fps = 30000 / 1001;
    const props = {language: Language.ENGLISH, videoSrc: 'blob:original', currentTime: 0,
        currentFrame: 0, fps, totalFrames: 900, onLoadedMetadata: metadata, onFirstFrameDrawn: jest.fn()};
    const view = render(<VideoPlayer {...props}/>);
    const video = view.container.querySelector('video');
    Object.defineProperties(video, {readyState: {value: 2}, duration: {value: 30.03}, videoWidth: {value: 2160}, videoHeight: {value: 4096}});
    fireEvent.loadedMetadata(video);
    await waitFor(() => expect(metadata).toHaveBeenCalledWith(30.03, 900, fps, {width: 2160, height: 4096}));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    view.rerender(<VideoPlayer {...props} currentFrame={1} currentTime={1 / fps}/>);
    expect(video.currentTime).toBeCloseTo(1 / fps);
    fireEvent.seeked(video);
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
    const originalSizeCanvas = EditorModel.videoFrameCanvas;
    expect([originalSizeCanvas.width, originalSizeCanvas.height]).toEqual([2160, 4096]);
    await act(async () => { view.rerender(<VideoPlayer {...props} isPlaying/>); });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    await act(async () => { view.rerender(<VideoPlayer {...props} isPlaying onFirstFrameDrawn={jest.fn()}/>); });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
});

it('does not cache a metadata-only black canvas and publishes the first decoded frame once', async () => {
    let readyState = 1;
    const firstFrame = jest.fn();
    const metadata = jest.fn();
    const view = render(<VideoPlayer language={Language.ENGLISH} videoSrc="blob:delayed-first-frame"
        currentTime={0} currentFrame={0} fps={30000 / 1001} totalFrames={182}
        onLoadedMetadata={metadata} onFirstFrameDrawn={firstFrame}/>);
    const video = view.container.querySelector('video');
    Object.defineProperties(video, {readyState: {get: () => readyState}, duration: {value: 6.08},
        videoWidth: {value: 3840}, videoHeight: {value: 2160}});
    fireEvent.loadedMetadata(video);
    await waitFor(() => expect(metadata).toHaveBeenCalled());
    expect(firstFrame).not.toHaveBeenCalled();
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
    readyState = 2;
    fireEvent.loadedData(video);
    expect(firstFrame).toHaveBeenCalledTimes(1);
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
    expect([EditorModel.videoFrameCanvas.width, EditorModel.videoFrameCanvas.height]).toEqual([3840, 2160]);
    fireEvent.loadedData(video);
    expect(firstFrame).toHaveBeenCalledTimes(1);
});

it('finishes in-flight decoding and coalesces queued seeks to the newest target', async () => {
    const props = {language: Language.ENGLISH, videoSrc: 'blob:seek', currentTime: 0,
        currentFrame: 0, fps: 30, totalFrames: 182, onFrameDrawn: jest.fn(), onTimeUpdate: jest.fn()};
    const view = render(<VideoPlayer {...props}/>);
    const video = view.container.querySelector('video');
    let seeking = false;
    Object.defineProperties(video, {readyState: {value: 2}, duration: {value: 182 / 30},
        videoWidth: {value: 1920}, videoHeight: {value: 1080}, seeking: {get: () => seeking}});
    fireEvent.loadedMetadata(video);
    await waitFor(() => expect(EditorModel.videoFrameCanvas).not.toBeNull());
    const snapshot = EditorModel.videoFrameCanvas;
    const remove = jest.spyOn(video, 'removeEventListener');
    const assignTime = jest.spyOn(video, 'currentTime', 'set');
    view.rerender(<VideoPlayer {...props} currentFrame={30} currentTime={1}/>);
    view.rerender(<VideoPlayer {...props} currentFrame={60} currentTime={2}/>);
    view.rerender(<VideoPlayer {...props} currentFrame={90} currentTime={3}/>);
    expect(assignTime.mock.calls).toEqual([[1]]);
    jest.mocked(EditorActions.fullRender).mockClear();
    props.onFrameDrawn.mockClear();

    seeking = true;
    fireEvent.seeked(video);
    expect(EditorActions.fullRender).not.toHaveBeenCalled();
    seeking = false;
    fireEvent.timeUpdate(video);
    expect(props.onTimeUpdate).not.toHaveBeenCalled();
    fireEvent.seeked(video);
    expect(props.onFrameDrawn).toHaveBeenLastCalledWith(30);
    expect(assignTime.mock.calls).toEqual([[1], [3]]);
    fireEvent.seeked(video);

    expect(props.onFrameDrawn).toHaveBeenLastCalledWith(90);
    expect(EditorActions.fullRender).toHaveBeenCalledTimes(2);
    expect(EditorModel.videoFrameCanvas).toBe(snapshot);
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('seeked', expect.any(Function));
    view.unmount();
    expect(EditorModel.videoElement).toBeNull();
    expect(EditorModel.videoFrameCanvas).toBeNull();
    expect([snapshot.width, snapshot.height]).toEqual([0, 0]);
});

it('subscribes before assigning currentTime, including immediate seek completion', async () => {
    const props = {language: Language.ENGLISH, videoSrc: 'blob:immediate-seek', currentTime: 0,
        currentFrame: 0, fps: 30, totalFrames: 182};
    const view = render(<VideoPlayer {...props}/>);
    const video = view.container.querySelector('video');
    let time = 0;
    Object.defineProperties(video, {readyState: {value: 2}, duration: {value: 182 / 30},
        videoWidth: {value: 1920}, videoHeight: {value: 1080},
        currentTime: {get: () => time, set: value => { time = value; video.dispatchEvent(new Event('seeked')); }}});
    fireEvent.loadedMetadata(video);
    await waitFor(() => expect(EditorModel.videoFrameCanvas).not.toBeNull());
    jest.mocked(EditorActions.fullRender).mockClear();
    view.rerender(<VideoPlayer {...props} currentFrame={60} currentTime={2}/>);
    expect(EditorActions.fullRender).toHaveBeenCalledTimes(1);
    expect(time).toBe(2);
});

it('discards queued seeks when the source changes', () => {
    const props = {language: Language.ENGLISH, videoSrc: 'blob:old', currentTime: 0,
        currentFrame: 0, fps: 30, totalFrames: 182, onFrameDrawn: jest.fn()};
    const view = render(<VideoPlayer {...props}/>);
    const video = view.container.querySelector('video');
    Object.defineProperties(video, {readyState: {value: 2}, duration: {value: 182 / 30},
        videoWidth: {value: 1920}, videoHeight: {value: 1080}});
    fireEvent.loadedMetadata(video);
    view.rerender(<VideoPlayer {...props} currentTime={1} currentFrame={30}/>);
    view.rerender(<VideoPlayer {...props} currentTime={3} currentFrame={90}/>);
    view.rerender(<VideoPlayer {...props} videoSrc="blob:new"/>);
    const assignTime = jest.spyOn(video, 'currentTime', 'set');
    props.onFrameDrawn.mockClear();
    fireEvent.seeked(video);
    expect(assignTime).not.toHaveBeenCalled();
    expect(props.onFrameDrawn).not.toHaveBeenCalled();
});

it('starts playback at the latest drag target and removes the paused seek handler', async () => {
    const props = {language: Language.ENGLISH, videoSrc: 'blob:seek-play', currentTime: 0,
        currentFrame: 0, fps: 30, totalFrames: 182, onFrameDrawn: jest.fn()};
    const view = render(<VideoPlayer {...props}/>);
    const video = view.container.querySelector('video');
    Object.defineProperties(video, {readyState: {value: 2}, duration: {value: 182 / 30},
        videoWidth: {value: 1920}, videoHeight: {value: 1080}});
    fireEvent.loadedMetadata(video);
    view.rerender(<VideoPlayer {...props} currentTime={1} currentFrame={30}/>);
    view.rerender(<VideoPlayer {...props} currentTime={3} currentFrame={90}/>);
    expect(video.currentTime).toBe(1);
    await act(async () => view.rerender(<VideoPlayer {...props} currentTime={3} currentFrame={90} isPlaying/>));
    expect(video.currentTime).toBe(3);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    props.onFrameDrawn.mockClear();
    fireEvent.seeked(video);
    expect(props.onFrameDrawn).not.toHaveBeenCalled();
});

it('pauses immediately while play is pending and never restarts callbacks from the cancelled play', async () => {
    let resolvePlay: () => void;
    let paused = true;
    jest.mocked(HTMLMediaElement.prototype.play).mockImplementation(() => {
        paused = false;
        return new Promise(resolve => { resolvePlay = resolve; });
    });
    jest.mocked(HTMLMediaElement.prototype.pause).mockImplementation(() => { paused = true; });
    const props = {language: Language.ENGLISH, videoSrc: 'blob:pending-play', currentTime: 0,
        currentFrame: 0, fps: 30, totalFrames: 182, onTimeUpdate: jest.fn()};
    const view = render(<VideoPlayer {...props}/>);
    const video = view.container.querySelector('video');
    Object.defineProperties(video, {readyState: {value: 2}, duration: {value: 182 / 30},
        videoWidth: {value: 1920}, videoHeight: {value: 1080}, paused: {get: () => paused}});
    fireEvent.loadedMetadata(video);
    await waitFor(() => expect(EditorModel.videoFrameCanvas).not.toBeNull());
    view.rerender(<VideoPlayer {...props} isPlaying/>);
    expect(paused).toBe(false);
    view.rerender(<VideoPlayer {...props} isPlaying={false}/>);
    expect(paused).toBe(true);
    await act(async () => { resolvePlay(); });
    expect(HTMLVideoElement.prototype.requestVideoFrameCallback).not.toHaveBeenCalled();
    expect(props.onTimeUpdate).not.toHaveBeenCalled();
});
