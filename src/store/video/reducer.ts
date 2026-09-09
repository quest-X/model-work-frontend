import { VideoState, VideoData } from './types';
import {
    UPDATE_VIDEO_MODE,
    ADD_VIDEO_DATA,
    UPDATE_ACTIVE_VIDEO_INDEX,
    UPDATE_VIDEO_CURRENT_FRAME,
    UPDATE_VIDEO_PLAYING_STATUS,
    UPDATE_VIDEO_METADATA,
    ADD_VIDEO_FRAME,
    UPDATE_VIDEO_FRAME_ANNOTATION_STATUS,
    MARK_VIDEO_FRAME_AS_KEYFRAME,
    REMOVE_VIDEO_DATA,
    CLEAR_ALL_VIDEOS,
    UPDATE_VIDEO_SESSION_ID,
} from './actionCreators';

const initialState: VideoState = {
    isVideoMode: false,
    activeVideo: null,
    videos: [],
    activeVideoIndex: -1
};

const updateMatchingVideo = (
    state: VideoState, videoId: string, update: (video: VideoData) => VideoData,
): VideoState => ({
    ...state,
    videos: state.videos.map(video => video.id === videoId ? update(video) : video),
    activeVideo: state.activeVideo?.id === videoId ? update(state.activeVideo) : state.activeVideo,
});

const removeVideo = (state: VideoState, videoId: string): VideoState => {
    const videos = state.videos.filter(video => video.id !== videoId);
    return {
        ...state,
        videos,
        activeVideoIndex: state.activeVideoIndex >= videos.length ? videos.length - 1 : state.activeVideoIndex,
        activeVideo: state.activeVideo?.id === videoId
            ? videos[Math.min(state.activeVideoIndex, videos.length - 1)] || null
            : state.activeVideo,
    };
};

export function videoReducer(state = initialState, action: any): VideoState {
    switch (action.type) {
        case UPDATE_VIDEO_MODE:
            return {
                ...state,
                isVideoMode: action.payload.isVideoMode
            };

        case ADD_VIDEO_DATA: {
            const newVideos = [...state.videos, action.payload.videoData];
            return {
                ...state,
                videos: newVideos,
                activeVideoIndex: newVideos.length - 1,
                activeVideo: action.payload.videoData
            };
        }

        case UPDATE_ACTIVE_VIDEO_INDEX:
            return {
                ...state,
                activeVideoIndex: action.payload.activeVideoIndex,
                activeVideo: state.videos[action.payload.activeVideoIndex] || null
            };

        case UPDATE_VIDEO_CURRENT_FRAME:
            return updateMatchingVideo(state, action.payload.videoId, video => ({
                ...video, currentFrame: action.payload.frameNumber, currentTime: action.payload.timestamp,
            }));

        case UPDATE_VIDEO_PLAYING_STATUS:
            return updateMatchingVideo(state, action.payload.videoId, video => ({
                ...video, isPlaying: action.payload.isPlaying,
            }));

        case UPDATE_VIDEO_METADATA:
            return updateMatchingVideo(state, action.payload.videoId, video => ({
                ...video, duration: action.payload.duration, fps: action.payload.fps,
                totalFrames: action.payload.totalFrames, videoSize: action.payload.videoSize, loadStatus: true,
            }));

        case ADD_VIDEO_FRAME:
            return updateMatchingVideo(state, action.payload.videoId, video => {
                const frames = new Map(video.frames);
                frames.set(action.payload.frameData.frameNumber, action.payload.frameData);
                return {...video, frames};
            });

        case UPDATE_VIDEO_FRAME_ANNOTATION_STATUS:
            return updateMatchingVideo(state, action.payload.videoId, video => {
                const frames = new Map(video.frames);
                const frame = frames.get(action.payload.frameNumber);
                if (frame) frames.set(action.payload.frameNumber, {...frame, hasAnnotations: action.payload.hasAnnotations});
                return {...video, frames};
            });

        case MARK_VIDEO_FRAME_AS_KEYFRAME:
            return updateMatchingVideo(state, action.payload.videoId, video => {
                const frames = new Map(video.frames);
                const frame = frames.get(action.payload.frameNumber);
                if (frame) frames.set(action.payload.frameNumber, {...frame, isKeyframe: action.payload.isKeyframe});
                return {...video, frames};
            });

        case REMOVE_VIDEO_DATA:
            return removeVideo(state, action.payload.videoId);

        case CLEAR_ALL_VIDEOS:
            return initialState;

        case UPDATE_VIDEO_SESSION_ID:
            return updateMatchingVideo(state, action.payload.videoId, video => ({
                ...video, sessionId: action.payload.sessionId,
            }));

        default:
            return state;
    }
}

