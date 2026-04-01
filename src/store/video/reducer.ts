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
    CLEAR_ALL_VIDEOS
} from './actionCreators';

const initialState: VideoState = {
    isVideoMode: false,
    activeVideo: null,
    videos: [],
    activeVideoIndex: -1
};

export function videoReducer(state = initialState, action: any): VideoState {
    switch (action.type) {
        case UPDATE_VIDEO_MODE:
            return {
                ...state,
                isVideoMode: action.payload.isVideoMode
            };

        case ADD_VIDEO_DATA:
            const newVideos = [...state.videos, action.payload.videoData];
            return {
                ...state,
                videos: newVideos,
                activeVideoIndex: newVideos.length - 1,
                activeVideo: action.payload.videoData
            };

        case UPDATE_ACTIVE_VIDEO_INDEX:
            return {
                ...state,
                activeVideoIndex: action.payload.activeVideoIndex,
                activeVideo: state.videos[action.payload.activeVideoIndex] || null
            };

        case UPDATE_VIDEO_CURRENT_FRAME:
            return {
                ...state,
                videos: state.videos.map(video =>
                    video.id === action.payload.videoId
                        ? {
                              ...video,
                              currentFrame: action.payload.frameNumber,
                              currentTime: action.payload.timestamp
                          }
                        : video
                ),
                activeVideo:
                    state.activeVideo?.id === action.payload.videoId
                        ? {
                              ...state.activeVideo,
                              currentFrame: action.payload.frameNumber,
                              currentTime: action.payload.timestamp
                          }
                        : state.activeVideo
            };

        case UPDATE_VIDEO_PLAYING_STATUS:
            return {
                ...state,
                videos: state.videos.map(video =>
                    video.id === action.payload.videoId
                        ? { ...video, isPlaying: action.payload.isPlaying }
                        : video
                ),
                activeVideo:
                    state.activeVideo?.id === action.payload.videoId
                        ? { ...state.activeVideo, isPlaying: action.payload.isPlaying }
                        : state.activeVideo
            };

        case UPDATE_VIDEO_METADATA:
            return {
                ...state,
                videos: state.videos.map(video =>
                    video.id === action.payload.videoId
                        ? {
                              ...video,
                              duration: action.payload.duration,
                              fps: action.payload.fps,
                              totalFrames: action.payload.totalFrames,
                              videoSize: action.payload.videoSize,
                              loadStatus: true
                          }
                        : video
                ),
                activeVideo:
                    state.activeVideo?.id === action.payload.videoId
                        ? {
                              ...state.activeVideo,
                              duration: action.payload.duration,
                              fps: action.payload.fps,
                              totalFrames: action.payload.totalFrames,
                              videoSize: action.payload.videoSize,
                              loadStatus: true
                          }
                        : state.activeVideo
            };

        case ADD_VIDEO_FRAME:
            return {
                ...state,
                videos: state.videos.map(video => {
                    if (video.id === action.payload.videoId) {
                        const newFrames = new Map(video.frames);
                        newFrames.set(action.payload.frameData.frameNumber, action.payload.frameData);
                        return { ...video, frames: newFrames };
                    }
                    return video;
                }),
                activeVideo:
                    state.activeVideo?.id === action.payload.videoId
                        ? (() => {
                              const newFrames = new Map(state.activeVideo.frames);
                              newFrames.set(
                                  action.payload.frameData.frameNumber,
                                  action.payload.frameData
                              );
                              return { ...state.activeVideo, frames: newFrames };
                          })()
                        : state.activeVideo
            };

        case UPDATE_VIDEO_FRAME_ANNOTATION_STATUS:
            return {
                ...state,
                videos: state.videos.map(video => {
                    if (video.id === action.payload.videoId) {
                        const newFrames = new Map(video.frames);
                        const frame = newFrames.get(action.payload.frameNumber);
                        if (frame) {
                            newFrames.set(action.payload.frameNumber, {
                                ...frame,
                                hasAnnotations: action.payload.hasAnnotations
                            });
                        }
                        return { ...video, frames: newFrames };
                    }
                    return video;
                }),
                activeVideo:
                    state.activeVideo?.id === action.payload.videoId
                        ? (() => {
                              const newFrames = new Map(state.activeVideo.frames);
                              const frame = newFrames.get(action.payload.frameNumber);
                              if (frame) {
                                  newFrames.set(action.payload.frameNumber, {
                                      ...frame,
                                      hasAnnotations: action.payload.hasAnnotations
                                  });
                              }
                              return { ...state.activeVideo, frames: newFrames };
                          })()
                        : state.activeVideo
            };

        case MARK_VIDEO_FRAME_AS_KEYFRAME:
            return {
                ...state,
                videos: state.videos.map(video => {
                    if (video.id === action.payload.videoId) {
                        const newFrames = new Map(video.frames);
                        const frame = newFrames.get(action.payload.frameNumber);
                        if (frame) {
                            newFrames.set(action.payload.frameNumber, {
                                ...frame,
                                isKeyframe: action.payload.isKeyframe
                            });
                        }
                        return { ...video, frames: newFrames };
                    }
                    return video;
                }),
                activeVideo:
                    state.activeVideo?.id === action.payload.videoId
                        ? (() => {
                              const newFrames = new Map(state.activeVideo.frames);
                              const frame = newFrames.get(action.payload.frameNumber);
                              if (frame) {
                                  newFrames.set(action.payload.frameNumber, {
                                      ...frame,
                                      isKeyframe: action.payload.isKeyframe
                                  });
                              }
                              return { ...state.activeVideo, frames: newFrames };
                          })()
                        : state.activeVideo
            };

        case REMOVE_VIDEO_DATA:
            const filteredVideos = state.videos.filter(video => video.id !== action.payload.videoId);
            return {
                ...state,
                videos: filteredVideos,
                activeVideoIndex:
                    state.activeVideoIndex >= filteredVideos.length
                        ? filteredVideos.length - 1
                        : state.activeVideoIndex,
                activeVideo:
                    state.activeVideo?.id === action.payload.videoId
                        ? filteredVideos[Math.min(state.activeVideoIndex, filteredVideos.length - 1)] || null
                        : state.activeVideo
            };

        case CLEAR_ALL_VIDEOS:
            return initialState;

        default:
            return state;
    }
}

