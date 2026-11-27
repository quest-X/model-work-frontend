import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react';
import VideoPlayer from '../VideoPlayer';
import {Language} from '../../../../data/LanguageConfig';
import {EditorModel} from '../../../../staticModels/EditorModel';

jest.mock('../../../../logic/actions/EditorActions', () => ({EditorActions: {setActiveImage: jest.fn(), fullRender: jest.fn()}}));

beforeEach(() => {
    jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({clearRect: jest.fn(), drawImage: jest.fn()} as unknown as CanvasRenderingContext2D);
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(null));
    HTMLVideoElement.prototype.requestVideoFrameCallback = jest.fn(() => 1);
    HTMLVideoElement.prototype.cancelVideoFrameCallback = jest.fn();
});
afterEach(() => { jest.restoreAllMocks(); EditorModel.videoElement = null; });

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
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalled();
    const originalSizeCanvas = jest.mocked(HTMLCanvasElement.prototype.toBlob).mock.instances.at(-1) as unknown as HTMLCanvasElement;
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
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalled();
    fireEvent.loadedData(video);
    expect(firstFrame).toHaveBeenCalledTimes(1);
});
