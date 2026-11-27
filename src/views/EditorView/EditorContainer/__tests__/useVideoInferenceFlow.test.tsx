import React from 'react';
import {act, render, screen} from '@testing-library/react';
import configureStore from '../../../../configureStore';
import {store} from '../../../../index';
import {addVideoData, updateVideoCurrentFrame} from '../../../../store/video/actionCreators';
import {updateActiveImageIndex} from '../../../../store/labels/actionCreators';
import {EditorModel} from '../../../../staticModels/EditorModel';
import {useVideoInferenceFlow} from '../useVideoInferenceFlow';

jest.mock('../../../../index', () => ({store: {dispatch: jest.fn(), getState: jest.fn()}}));
const showResults = jest.fn();
const showStatistics = jest.fn();
const Harness = ({running}: {running: boolean}) => {
    const preview = useVideoInferenceFlow('video', running, showResults, showStatistics, 30);
    return <span>{preview || 'waiting'}</span>;
};
let state: ReturnType<typeof configureStore>;
const emit = (type: string, detail: object) => act(() => {window.dispatchEvent(new CustomEvent(type, {detail}));});
const playing = () => state.getState().video.activeVideo.isPlaying;

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    state = configureStore();
    state.dispatch(addVideoData({id: 'video', fileData: new File(['video'], 'clip.mp4'), loadStatus: true,
        duration: 2, fps: 30, totalFrames: 60, videoSize: {width: 640, height: 480},
        currentFrame: 0, currentTime: 0, isPlaying: false, frames: new Map()}));
    jest.mocked(store.getState).mockImplementation(state.getState);
    jest.mocked(store.dispatch).mockImplementation(state.dispatch);
    EditorModel.videoElement = null;
});
afterEach(() => { jest.useRealTimers(); });

it('buffers inferred frames before playback, previews results and keeps playing after statistics open', () => {
    const view = render(<Harness running={false}/>);
    view.rerender(<Harness running/>);
    expect(showResults).toHaveBeenCalledTimes(1);
    expect(playing()).toBe(false);
    emit('batchInferenceProgress', {count: 8, failed: 0, total: 60});
    expect(playing()).toBe(false);
    emit('batchInferenceProgress', {count: 16, failed: 0, total: 60});
    expect(playing()).toBe(true);
    emit('videoInferenceFrame', {videoId: 'video', imageId: 'inferred-frame-12', count: 1});
    act(() => {jest.advanceTimersByTime(250);});
    expect(screen.getByText('inferred-frame-12')).toBeInTheDocument();
    emit('batchInferenceComplete', {count: 60, failed: 0, cancelled: false});
    expect(showStatistics).toHaveBeenCalledTimes(1);
    view.rerender(<Harness running={false}/>);
    expect(playing()).toBe(true);
});

it('waits if playback reaches the inferred frames and resumes when the lead is restored', () => {
    render(<Harness running/>);
    emit('batchInferenceProgress', {count: 16, total: 60});
    state.dispatch(updateVideoCurrentFrame('video', 15, 0.5));
    emit('batchInferenceProgress', {count: 16, total: 60});
    expect(playing()).toBe(false);
    emit('batchInferenceProgress', {count: 31, total: 60});
    expect(playing()).toBe(true);
});

it.each([{count: 10, failed: 1, cancelled: false}, {count: 10, failed: 0, cancelled: true}])(
    'stops playback without showing successful statistics on failure or cancellation', detail => {
        render(<Harness running/>);
        emit('batchInferenceProgress', {count: 16, total: 60});
        emit('batchInferenceComplete', detail);
        expect(playing()).toBe(false);
        expect(showStatistics).not.toHaveBeenCalled();
    }
);

it('keeps frame 825 and the video position during and after single-frame inference', () => {
    state.dispatch(updateVideoCurrentFrame('video', 824, 824 / 30));
    state.dispatch(updateActiveImageIndex(824));
    const video = document.createElement('video');
    video.currentTime = 824 / 30;
    Object.defineProperty(video, 'readyState', {value: 4});
    EditorModel.videoElement = video;
    const view = render(<Harness running={false}/>);
    view.rerender(<Harness running/>);
    expect(state.getState().video.activeVideo.currentFrame).toBe(824);
    expect(state.getState().labels.activeImageIndex).toBe(824);
    expect(video.currentTime).toBe(824 / 30);
    emit('videoInferenceFrame', {videoId: 'video', imageId: 'frame-825', count: 1});
    view.rerender(<Harness running={false}/>);
    expect(state.getState().video.activeVideo.currentFrame).toBe(824);
    expect(state.getState().labels.activeImageIndex).toBe(824);
    expect(video.currentTime).toBe(824 / 30);
});
