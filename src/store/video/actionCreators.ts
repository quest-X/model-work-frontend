import { VideoData, VideoFrameData } from './types';
import { ISize } from '../../interfaces/ISize';

// Action Types常量
export const UPDATE_VIDEO_MODE = 'UPDATE_VIDEO_MODE';
export const ADD_VIDEO_DATA = 'ADD_VIDEO_DATA';
export const UPDATE_ACTIVE_VIDEO_INDEX = 'UPDATE_ACTIVE_VIDEO_INDEX';
export const UPDATE_VIDEO_CURRENT_FRAME = 'UPDATE_VIDEO_CURRENT_FRAME';
export const UPDATE_VIDEO_PLAYING_STATUS = 'UPDATE_VIDEO_PLAYING_STATUS';
export const UPDATE_VIDEO_METADATA = 'UPDATE_VIDEO_METADATA';
export const ADD_VIDEO_FRAME = 'ADD_VIDEO_FRAME';
export const UPDATE_VIDEO_FRAME_ANNOTATION_STATUS = 'UPDATE_VIDEO_FRAME_ANNOTATION_STATUS';
export const MARK_VIDEO_FRAME_AS_KEYFRAME = 'MARK_VIDEO_FRAME_AS_KEYFRAME';
export const REMOVE_VIDEO_DATA = 'REMOVE_VIDEO_DATA';
export const CLEAR_ALL_VIDEOS = 'CLEAR_ALL_VIDEOS';

// Action Creators
export const updateVideoMode = (isVideoMode: boolean) => ({
    type: UPDATE_VIDEO_MODE,
    payload: { isVideoMode }
});

export const addVideoData = (videoData: VideoData) => ({
    type: ADD_VIDEO_DATA,
    payload: { videoData }
});

export const updateActiveVideoIndex = (activeVideoIndex: number) => ({
    type: UPDATE_ACTIVE_VIDEO_INDEX,
    payload: { activeVideoIndex }
});

export const updateVideoCurrentFrame = (videoId: string, frameNumber: number, timestamp: number) => ({
    type: UPDATE_VIDEO_CURRENT_FRAME,
    payload: { videoId, frameNumber, timestamp }
});

export const updateVideoPlayingStatus = (videoId: string, isPlaying: boolean) => ({
    type: UPDATE_VIDEO_PLAYING_STATUS,
    payload: { videoId, isPlaying }
});

export const updateVideoMetadata = (
    videoId: string,
    duration: number,
    fps: number,
    totalFrames: number,
    videoSize: ISize
) => ({
    type: UPDATE_VIDEO_METADATA,
    payload: { videoId, duration, fps, totalFrames, videoSize }
});

export const addVideoFrame = (videoId: string, frameData: VideoFrameData) => ({
    type: ADD_VIDEO_FRAME,
    payload: { videoId, frameData }
});

export const updateVideoFrameAnnotationStatus = (
    videoId: string,
    frameNumber: number,
    hasAnnotations: boolean
) => ({
    type: UPDATE_VIDEO_FRAME_ANNOTATION_STATUS,
    payload: { videoId, frameNumber, hasAnnotations }
});

export const markVideoFrameAsKeyframe = (videoId: string, frameNumber: number, isKeyframe: boolean) => ({
    type: MARK_VIDEO_FRAME_AS_KEYFRAME,
    payload: { videoId, frameNumber, isKeyframe }
});

export const removeVideoData = (videoId: string) => ({
    type: REMOVE_VIDEO_DATA,
    payload: { videoId }
});

export const clearAllVideos = () => ({
    type: CLEAR_ALL_VIDEOS
});

