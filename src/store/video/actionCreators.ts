import { VideoActionTypes, VideoData, VideoFrameData } from './types';
import { Action } from '../Actions';
import { ISize } from '../../interfaces/ISize';

// Action Types常量
export const UPDATE_VIDEO_MODE = Action.UPDATE_VIDEO_MODE;
export const ADD_VIDEO_DATA = Action.ADD_VIDEO_DATA;
export const UPDATE_ACTIVE_VIDEO_INDEX = Action.UPDATE_ACTIVE_VIDEO_INDEX;
export const UPDATE_VIDEO_CURRENT_FRAME = Action.UPDATE_VIDEO_CURRENT_FRAME;
export const UPDATE_VIDEO_PLAYING_STATUS = Action.UPDATE_VIDEO_PLAYING_STATUS;
export const UPDATE_VIDEO_METADATA = Action.UPDATE_VIDEO_METADATA;
export const ADD_VIDEO_FRAME = Action.ADD_VIDEO_FRAME;
export const UPDATE_VIDEO_FRAME_ANNOTATION_STATUS = Action.UPDATE_VIDEO_FRAME_ANNOTATION_STATUS;
export const MARK_VIDEO_FRAME_AS_KEYFRAME = Action.MARK_VIDEO_FRAME_AS_KEYFRAME;
export const REMOVE_VIDEO_DATA = Action.REMOVE_VIDEO_DATA;
export const CLEAR_ALL_VIDEOS = Action.CLEAR_ALL_VIDEOS;

// Action Creators
export const updateVideoMode = (isVideoMode: boolean): VideoActionTypes => ({
    type: UPDATE_VIDEO_MODE,
    payload: { isVideoMode }
});

export const addVideoData = (videoData: VideoData): VideoActionTypes => ({
    type: ADD_VIDEO_DATA,
    payload: { videoData }
});

export const updateActiveVideoIndex = (activeVideoIndex: number): VideoActionTypes => ({
    type: UPDATE_ACTIVE_VIDEO_INDEX,
    payload: { activeVideoIndex }
});

export const updateVideoCurrentFrame = (videoId: string, frameNumber: number, timestamp: number): VideoActionTypes => ({
    type: UPDATE_VIDEO_CURRENT_FRAME,
    payload: { videoId, frameNumber, timestamp }
});

export const updateVideoPlayingStatus = (videoId: string, isPlaying: boolean): VideoActionTypes => ({
    type: UPDATE_VIDEO_PLAYING_STATUS,
    payload: { videoId, isPlaying }
});

export const updateVideoMetadata = (
    videoId: string,
    duration: number,
    fps: number,
    totalFrames: number,
    videoSize: ISize
): VideoActionTypes => ({
    type: UPDATE_VIDEO_METADATA,
    payload: { videoId, duration, fps, totalFrames, videoSize }
});

export const addVideoFrame = (videoId: string, frameData: VideoFrameData): VideoActionTypes => ({
    type: ADD_VIDEO_FRAME,
    payload: { videoId, frameData }
});

export const updateVideoFrameAnnotationStatus = (
    videoId: string,
    frameNumber: number,
    hasAnnotations: boolean
): VideoActionTypes => ({
    type: UPDATE_VIDEO_FRAME_ANNOTATION_STATUS,
    payload: { videoId, frameNumber, hasAnnotations }
});

export const markVideoFrameAsKeyframe = (videoId: string, frameNumber: number, isKeyframe: boolean): VideoActionTypes => ({
    type: MARK_VIDEO_FRAME_AS_KEYFRAME,
    payload: { videoId, frameNumber, isKeyframe }
});

export const removeVideoData = (videoId: string): VideoActionTypes => ({
    type: REMOVE_VIDEO_DATA,
    payload: { videoId }
});

export const clearAllVideos = (): VideoActionTypes => ({
    type: CLEAR_ALL_VIDEOS
});

export const UPDATE_VIDEO_SESSION_ID = Action.UPDATE_VIDEO_SESSION_ID;

export const updateVideoSessionId = (videoId: string, sessionId: string): VideoActionTypes => ({
    type: UPDATE_VIDEO_SESSION_ID,
    payload: { videoId, sessionId },
});

