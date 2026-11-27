import {useEffect, useRef, useState} from 'react';
import {store} from '../../../index';
import {EditorModel} from '../../../staticModels/EditorModel';
import {updateVideoCurrentFrame, updateVideoPlayingStatus} from '../../../store/video/actionCreators';
import {updateActiveImageIndex} from '../../../store/labels/actionCreators';

/** Infer a short lead, then inspect the annotated video while inference continues. */
export function useVideoInferenceFlow(videoId: string | undefined, inProgress: boolean,
    showResults: () => void, showStatistics: () => void, fps = 30): string | undefined {
    const [previewImageId, setPreviewImageId] = useState<string>();
    const running = useRef(false);
    const sequenceVideo = useRef<string>();
    const completed = useRef(false);
    const startedPlaying = useRef(false);
    const waitingForFrames = useRef(false);
    const progress = useRef({processed: 0, total: 0});
    const latestResult = useRef<string>();
    const callbacks = useRef({showResults, showStatistics, fps});
    callbacks.current = {showResults, showStatistics, fps};

    useEffect(() => {
        if (!inProgress) { sequenceVideo.current = undefined; return undefined; }
        if (!videoId || (sequenceVideo.current && sequenceVideo.current !== videoId)) return undefined;
        sequenceVideo.current = videoId;
        running.current = true;
        completed.current = false;
        startedPlaying.current = false;
        waitingForFrames.current = false;
        progress.current = {processed: 0, total: 0};
        latestResult.current = undefined;
        setPreviewImageId(undefined);
        callbacks.current.showResults();
        store.dispatch(updateVideoPlayingStatus(videoId, false));
        if (EditorModel.videoElement?.readyState >= 1) EditorModel.videoElement.currentTime = 0;
        store.dispatch(updateVideoCurrentFrame(videoId, 0, 0));
        store.dispatch(updateActiveImageIndex(0));
        const timer = setInterval(() => {
            if (latestResult.current) setPreviewImageId(latestResult.current);
        }, 250);
        return () => {
            clearInterval(timer);
            running.current = false;
            // Successful inference can finish before the viewer reaches the end.
            if (!completed.current) store.dispatch(updateVideoPlayingStatus(videoId, false));
        };
    }, [videoId, inProgress]);

    useEffect(() => {
        const frameReady = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (running.current && detail.videoId === videoId && detail.count > 0) latestResult.current = detail.imageId;
        };
        const advance = (event: Event) => {
            if (!running.current || !videoId) return;
            const detail = (event as CustomEvent).detail;
            progress.current = {processed: detail.count + (detail.failed || 0), total: detail.total};
            const currentFrame = store.getState().video.activeVideo?.currentFrame || 0;
            const lead = Math.min(detail.total, Math.max(1, Math.ceil(callbacks.current.fps * 0.5)));
            if ((!startedPlaying.current || waitingForFrames.current) && progress.current.processed - currentFrame >= lead) {
                startedPlaying.current = true;
                waitingForFrames.current = false;
                store.dispatch(updateVideoPlayingStatus(videoId, true));
            } else if (startedPlaying.current && currentFrame >= progress.current.processed - 1) {
                waitingForFrames.current = true;
                store.dispatch(updateVideoPlayingStatus(videoId, false));
            }
        };
        const complete = (event: Event) => {
            if (!running.current || !videoId) return;
            const detail = (event as CustomEvent).detail;
            completed.current = detail.count > 0 && !detail.cancelled && !detail.failed;
            if (completed.current) {
                if (!startedPlaying.current || waitingForFrames.current) store.dispatch(updateVideoPlayingStatus(videoId, true));
                setPreviewImageId(undefined);
                callbacks.current.showStatistics();
            } else store.dispatch(updateVideoPlayingStatus(videoId, false));
        };
        window.addEventListener('videoInferenceFrame', frameReady);
        window.addEventListener('batchInferenceProgress', advance);
        window.addEventListener('batchInferenceComplete', complete);
        return () => {
            window.removeEventListener('videoInferenceFrame', frameReady);
            window.removeEventListener('batchInferenceProgress', advance);
            window.removeEventListener('batchInferenceComplete', complete);
        };
    }, [videoId]);
    return previewImageId;
}
