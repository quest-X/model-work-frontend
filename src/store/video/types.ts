import { ISize } from '../../interfaces/ISize';
import { Action } from '../Actions';

// 视频帧数据（扩展ImageData，用于存储视频每一帧的标注）
export type VideoFrameData = {
    frameNumber: number; // 帧编号
    timestamp: number; // 时间戳（秒）
    isKeyframe: boolean; // 是否为关键帧
    hasAnnotations: boolean; // 是否有标注
    // 标注数据会存储在ImageData中
};

// 视频项目数据
export type VideoData = {
    id: string;
    fileData: File; // 视频文件
    loadStatus: boolean;
    duration: number; // 视频时长（秒）
    fps: number; // 帧率
    totalFrames: number; // 总帧数
    videoSize: ISize; // 视频尺寸
    currentFrame: number; // 当前帧
    currentTime: number; // 当前时间（秒）
    isPlaying: boolean; // 是否正在播放
    frames: Map<number, VideoFrameData>; // 帧数据映射
    videoUrl?: string; // 视频URL（用于播放）
    preExtractedFrames?: File[]; // fast_ffmpeg_mode (full-load): all JPEG frames in memory
    sessionId?: string; // fast_ffmpeg_mode (on-demand): backend session ID for batch frame fetching
    // Note: when neither preExtractedFrames nor sessionId is set, VideoEditor
    // falls back to raw_browser_mode (browser-native <video> via VideoPlayer).
};

// 视频状态
export type VideoState = {
    isVideoMode: boolean; // 是否为视频模式
    activeVideo: VideoData | null; // 当前活动视频
    videos: VideoData[]; // 视频列表
    activeVideoIndex: number; // 当前活动视频索引
};

// Action Types
interface UpdateVideoMode {
    type: typeof Action.UPDATE_VIDEO_MODE;
    payload: {
        isVideoMode: boolean;
    };
}

interface AddVideoData {
    type: typeof Action.ADD_VIDEO_DATA;
    payload: {
        videoData: VideoData;
    };
}

interface UpdateActiveVideoIndex {
    type: typeof Action.UPDATE_ACTIVE_VIDEO_INDEX;
    payload: {
        activeVideoIndex: number;
    };
}

interface UpdateVideoCurrentFrame {
    type: typeof Action.UPDATE_VIDEO_CURRENT_FRAME;
    payload: {
        videoId: string;
        frameNumber: number;
        timestamp: number;
    };
}

interface UpdateVideoPlayingStatus {
    type: typeof Action.UPDATE_VIDEO_PLAYING_STATUS;
    payload: {
        videoId: string;
        isPlaying: boolean;
    };
}

interface UpdateVideoMetadata {
    type: typeof Action.UPDATE_VIDEO_METADATA;
    payload: {
        videoId: string;
        duration: number;
        fps: number;
        totalFrames: number;
        videoSize: ISize;
    };
}

interface AddVideoFrame {
    type: typeof Action.ADD_VIDEO_FRAME;
    payload: {
        videoId: string;
        frameData: VideoFrameData;
    };
}

interface UpdateVideoFrameAnnotationStatus {
    type: typeof Action.UPDATE_VIDEO_FRAME_ANNOTATION_STATUS;
    payload: {
        videoId: string;
        frameNumber: number;
        hasAnnotations: boolean;
    };
}

interface MarkVideoFrameAsKeyframe {
    type: typeof Action.MARK_VIDEO_FRAME_AS_KEYFRAME;
    payload: {
        videoId: string;
        frameNumber: number;
        isKeyframe: boolean;
    };
}

interface RemoveVideoData {
    type: typeof Action.REMOVE_VIDEO_DATA;
    payload: {
        videoId: string;
    };
}

interface ClearAllVideos {
    type: typeof Action.CLEAR_ALL_VIDEOS;
}

interface UpdateVideoSessionId {
    type: typeof Action.UPDATE_VIDEO_SESSION_ID;
    payload: {
        videoId: string;
        sessionId: string;
    };
}

export type VideoActionTypes =
    | UpdateVideoMode
    | AddVideoData
    | UpdateActiveVideoIndex
    | UpdateVideoCurrentFrame
    | UpdateVideoPlayingStatus
    | UpdateVideoMetadata
    | AddVideoFrame
    | UpdateVideoFrameAnnotationStatus
    | MarkVideoFrameAsKeyframe
    | RemoveVideoData
    | ClearAllVideos
    | UpdateVideoSessionId;

