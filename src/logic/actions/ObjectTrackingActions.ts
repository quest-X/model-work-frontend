/**
 * ObjectTrackingActions — drives the SAM 2 / SAM 3 video tracking flow.
 *
 * Flow:
 *   1. User draws a bbox in trackingMode → RectRenderEngine stores it and opens the popup.
 *   2. User confirms frame range in ObjectTrackingPopup → calls startTracking().
 *   3. startTracking streams /track NDJSON; for each frame builds a SegmentationResult
 *      and reuses AISegmentationActions.applySingleResult(source='tracking') so
 *      the polygon gets added without polluting the inference-history panel.
 *   4. cancelTracking() or user abort closes the stream.
 */
import { v4 as uuidv4 } from 'uuid';
import { store } from '../../index';
import { ImageData } from '../../store/labels/types';
import { SegmentationResult } from '../../ai/SegmentationAPIDetector';
import { TrackingAPIService } from '../../ai/TrackingAPIService';
import { AISegmentationActions } from './AISegmentationActions';
import {
    submitNewNotification,
    deleteNotificationById,
    updateNotificationById,
} from '../../store/notifications/actionCreators';
import { NotificationUtil } from '../../utils/NotificationUtil';
import { updateTrackingInProgressStatus } from '../../store/general/actionCreators';
import { EditorActions } from './EditorActions';
import { FrameExtractorService } from '../../services/FrameExtractorService';
import { updateVideoSessionId } from '../../store/video/actionCreators';

type StartParams = {
    sessionId: string;
    startFrameIdx: number;
    endFrameIdx: number;
    bboxImageSpace: [number, number, number, number];
    modelName: string;
    className?: string; // 可选；未给时用 "tracked"
};

export class ObjectTrackingActions {
    private static currentController: AbortController | null = null;

    public static isRunning(): boolean {
        return !!this.currentController;
    }

    public static cancelTracking(): void {
        if (this.currentController) {
            this.currentController.abort();
            this.currentController = null;
            store.dispatch(updateTrackingInProgressStatus(false));
        }
    }

    public static startTracking(params: StartParams, _retried = false): void {
        if (this.currentController) {
            this.cancelTracking();
        }

        const trackingGroupId = uuidv4();
        const className = params.className || 'tracked';
        const totalExpected = Math.max(1, params.endFrameIdx - params.startFrameIdx + 1);
        let doneCount = 0;

        const progressNotification = NotificationUtil.createInferenceProgressNotification();
        store.dispatch(submitNewNotification(progressNotification));

        const updateProgress = (step: number, description: string) => {
            store.dispatch(updateNotificationById(progressNotification.id, {
                ...progressNotification,
                currentStep: step,
                stepDescription: description,
                description,
            }));
        };
        updateProgress(1, `目标跟踪启动中 (0/${totalExpected})`);

        store.dispatch(updateTrackingInProgressStatus(true));

        const finalize = () => {
            store.dispatch(updateTrackingInProgressStatus(false));
            store.dispatch(deleteNotificationById(progressNotification.id));
            this.currentController = null;
            EditorActions.fullRender();
        };

        const handleError = async (err: Error) => {
            console.error('[Tracking] stream failed', err);
            const msg = err.message || '';
            const isSessionGone = /404/.test(msg) && /session.*not found/i.test(msg);

            if (isSessionGone && !_retried) {
                const activeVideo = store.getState().video?.activeVideo;
                if (activeVideo?.fileData) {
                    updateProgress(1, '视频会话已过期，正在重新上传…');
                    try {
                        const result = await FrameExtractorService.openSession(
                            activeVideo.fileData,
                            activeVideo.fps || 0,
                        );
                        if (result.sessionId) {
                            store.dispatch(updateVideoSessionId(activeVideo.id, result.sessionId));
                            finalize();
                            ObjectTrackingActions.startTracking(
                                { ...params, sessionId: result.sessionId },
                                true,
                            );
                            return;
                        }
                    } catch (uploadErr) {
                        console.error('[Tracking] re-upload failed', uploadErr);
                    }
                }
            }

            const description = isSessionGone
                ? '视频会话已过期（后端重启后会话丢失），请重新上传视频后再追踪'
                : msg || 'Unknown error';
            const fail = NotificationUtil.createErrorNotification({
                header: '目标跟踪失败',
                description,
            });
            store.dispatch(submitNewNotification(fail));
            setTimeout(() => store.dispatch(deleteNotificationById(fail.id)), 5000);
            finalize();
        };

        this.currentController = TrackingAPIService.streamTrack(
            {
                sessionId: params.sessionId,
                startFrame: params.startFrameIdx,
                endFrame: params.endFrameIdx,
                bbox: params.bboxImageSpace,
                modelName: params.modelName,
            },
            {
                onFrame: (f) => {
                    doneCount++;
                    updateProgress(2, `目标跟踪中 (${doneCount}/${totalExpected}) — 帧 ${f.frame_idx}`);

                    const mask = Array.isArray(f.mask) ? f.mask : [];
                    if (mask.length < 3) return;

                    const imagesData = store.getState().labels.imagesData;
                    const frameImg: ImageData | undefined = imagesData[f.frame_idx];
                    if (!frameImg) return;

                    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
                    for (const [mx, my] of mask) {
                        if (mx < x1) x1 = mx;
                        if (my < y1) y1 = my;
                        if (mx > x2) x2 = mx;
                        if (my > y2) y2 = my;
                    }

                    const result: SegmentationResult = {
                        info: { id: 0, name: className, confidence: f.confidence || 0 },
                        bbox: [x1, y1, x2, y2],
                        mask,
                    };

                    AISegmentationActions.applySingleResult(
                        frameImg,
                        [result],
                        'tracking',
                        trackingGroupId,
                    );
                },
                onDone: (total) => {
                    const done = NotificationUtil.createSuccessNotification({
                        header: '目标跟踪完成',
                        description: `已生成 ${total} 帧的分割`,
                    });
                    store.dispatch(submitNewNotification(done));
                    setTimeout(() => store.dispatch(deleteNotificationById(done.id)), 3500);
                    finalize();
                },
                onError: (err) => { void handleError(err); },
            },
        );
    }
}
