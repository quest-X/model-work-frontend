import {videoReducer} from '../reducer';
import {VideoData} from '../types';
import {
    addVideoData, addVideoFrame, markVideoFrameAsKeyframe, removeVideoData,
    updateVideoCurrentFrame, updateVideoFrameAnnotationStatus, updateVideoMetadata,
    updateVideoPlayingStatus, updateVideoSessionId,
} from '../actionCreators';

const video = (id: string): VideoData => ({
    id, fileData: new File(['video'], `${id}.mp4`), loadStatus: false, duration: 0,
    fps: 30, totalFrames: 0, videoSize: {width: 0, height: 0}, currentFrame: 0,
    currentTime: 0, isPlaying: false, frames: new Map(),
});

it('keeps active and listed video updates consistent without mutating other videos or prior frames', () => {
    const first = video('first');
    const second = video('second');
    let state = videoReducer(videoReducer(undefined, addVideoData(first)), addVideoData(second));
    const original = state;
    const frame = {frameNumber: 2, timestamp: 0.08, hasAnnotations: false, isKeyframe: false};
    for (const action of [
        updateVideoMetadata('second', 4, 25, 100, {width: 1920, height: 1080}),
        updateVideoCurrentFrame('second', 2, 0.08), updateVideoPlayingStatus('second', true),
        updateVideoSessionId('second', 'session-2'), addVideoFrame('second', frame),
        markVideoFrameAsKeyframe('second', 2, true), updateVideoFrameAnnotationStatus('second', 2, true),
    ]) state = videoReducer(state, action);
    expect(state.videos[0]).toBe(first);
    expect(state.activeVideo).toEqual(state.videos[1]);
    expect(state.activeVideo).toMatchObject({loadStatus: true, fps: 25, currentFrame: 2,
        currentTime: 0.08, isPlaying: true, sessionId: 'session-2'});
    expect(state.activeVideo.frames.get(2)).toEqual({...frame, isKeyframe: true, hasAnnotations: true});
    expect(original.activeVideo.frames.size).toBe(0);
    state = videoReducer(state, removeVideoData('second'));
    expect(state.activeVideo).toBe(first);
    expect(state.activeVideoIndex).toBe(0);
    state = videoReducer(state, removeVideoData('first'));
    expect(state.activeVideo).toBeNull();
    expect(state.activeVideoIndex).toBe(-1);
});
