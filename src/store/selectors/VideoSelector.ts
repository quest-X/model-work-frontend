import {store} from '../..';

export class VideoSelector {
    public static getActiveVideo() {
        return store.getState().video.activeVideo;
    }

    public static isVideoPlaying(): boolean {
        const activeVideo = store.getState().video.activeVideo;
        return activeVideo?.isPlaying ?? false;
    }

    public static isVideoMode(): boolean {
        return store.getState().video.isVideoMode;
    }

    public static getVideos() {
        return store.getState().video.videos;
    }

    public static getActiveVideoIndex(): number {
        return store.getState().video.activeVideoIndex;
    }
}

