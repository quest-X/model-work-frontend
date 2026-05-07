/**
 * ObjectTrackingActions — drives the SAM 2 / SAM 3 video tracking / retrieval flow.
 *
 * Two entry points:
 *   - startTracking(bbox): legacy bbox-based tracking (画框 → 跟踪)
 *   - startRetrieval(maskPolygons): 检索模式 — 用当前帧的 SAM polygon 作为 seed mask
 *
 * Both share the same streaming pipeline: /track NDJSON → per-frame polygon → Redux coalescer.
 */
import { v4 as uuidv4 } from 'uuid';
import { store } from '../../index';
import { ImageData, LabelName, LabelPolygon } from '../../store/labels/types';
import { LabelStatus } from '../../data/enums/LabelStatus';
import { SegmentationResult, SegmentationAPIDetector } from '../../ai/SegmentationAPIDetector';
import { PipelineStore } from '../../ai/PipelineStore';
import { TrackingAPIService } from '../../ai/TrackingAPIService';
import {
    submitNewNotification,
    deleteNotificationById,
    updateNotificationById,
} from '../../store/notifications/actionCreators';
import { NotificationUtil } from '../../utils/NotificationUtil';
import { updateTrackingInProgressStatus } from '../../store/general/actionCreators';
import { updateImageData, updateLabelNames } from '../../store/labels/actionCreators';
import { EditorActions } from './EditorActions';
import { FrameExtractorService } from '../../services/FrameExtractorService';
import { updateVideoSessionId } from '../../store/video/actionCreators';
import { LabelUtil } from '../../utils/LabelUtil';
import { TaskTracker, TaskHandle } from '../../services/TaskTracker';
import { TaskType } from '../../store/tasks/types';
import { LanguageConfig } from '../../data/LanguageConfig';

type StartParams = {
    sessionId: string;
    startFrameIdx: number;
    endFrameIdx: number;
    bboxImageSpace: [number, number, number, number];
    modelName: string;
    className?: string; // 可选；未给时用 "tracked"
};

/** 检索模式参数：用当前帧的 SAM polygon 作为 seed mask */
type RetrievalParams = {
    sessionId: string;
    startFrameIdx: number;
    endFrameIdx: number;
    /** 当前帧上的 polygon vertices（image-space），每个 polygon 是 [x,y][] */
    maskPolygons: [number, number][][];
    modelName: string;
    className?: string;
};

// ── Tracking dispatch coalescer ───────────────────────────────────────────────
// Per-frame `updateImageDataById` during a 700-frame SAM 2 tracking run is a
// dispatch storm: each one re-runs every connected selector and re-renders the
// 8298-row thumbnail virtual list, which is the dominant memory/CPU pressure
// during tracking and the most likely cause of long-run browser OOM.
//
// Buffer per-frame polygon additions in a Map keyed by imageId, flush once per
// idle tick (≤ 50ms) as a single `updateImageData(allImages)`. Modeled on U9's
// AIDetectionActions coalescer; intentionally duplicated here to keep tracking
// self-contained (different polygon-build path).
const pendingTrackingUpdates: Map<string, ImageData> = new Map();
let trackingFlushScheduled = false;
let trackingFlushHandle: number | null = null;

type IdleDeadline = { didTimeout: boolean; timeRemaining: () => number };
type RIC = (cb: (d: IdleDeadline) => void, opts?: { timeout?: number }) => number;
type CIC = (handle: number) => void;

const ric: RIC = (typeof (globalThis as any).requestIdleCallback === 'function')
    ? (globalThis as any).requestIdleCallback.bind(globalThis)
    : ((cb: (d: IdleDeadline) => void) => setTimeout(
        () => cb({ didTimeout: true, timeRemaining: () => 0 }), 16
    ) as unknown as number);

const cic: CIC = (typeof (globalThis as any).cancelIdleCallback === 'function')
    ? (globalThis as any).cancelIdleCallback.bind(globalThis)
    : ((h: number) => clearTimeout(h));

function flushTrackingUpdates(): void {
    trackingFlushScheduled = false;
    trackingFlushHandle = null;
    if (pendingTrackingUpdates.size === 0) return;

    const current: ImageData[] = [...store.getState().labels.imagesData];
    let modified = false;
    for (let i = 0; i < current.length; i++) {
        const next = pendingTrackingUpdates.get(current[i].id);
        if (next) {
            current[i] = next;
            modified = true;
        }
    }
    pendingTrackingUpdates.clear();
    if (modified) {
        store.dispatch(updateImageData(current));
    }
}

function scheduleTrackingFlush(): void {
    if (trackingFlushScheduled) return;
    trackingFlushScheduled = true;
    trackingFlushHandle = ric(() => flushTrackingUpdates(), { timeout: 50 });
}

function forceFlushTrackingUpdates(): void {
    if (trackingFlushHandle !== null) {
        cic(trackingFlushHandle);
        trackingFlushHandle = null;
    }
    trackingFlushScheduled = false;
    flushTrackingUpdates();
}

/** Resolve a className → labelId, creating the LabelName if missing. */
function ensureLabelId(className: string): string | null {
    const existing: LabelName[] = store.getState().labels.labels;
    const hit = existing.find(l => l.name.toLowerCase() === className.toLowerCase());
    if (hit) return hit.id;
    const created = LabelUtil.createLabelName(className);
    store.dispatch(updateLabelNames([...existing, created]));
    return created.id;
}

export class ObjectTrackingActions {
    private static currentController: AbortController | null = null;
    // 当前 Task Manager 句柄。所有终态路径（cancel/finalize/handleError）都要清理它。
    private static currentTask: TaskHandle | null = null;

    public static isRunning(): boolean {
        return !!this.currentController;
    }

    public static cancelTracking(): void {
        if (this.currentController) {
            this.currentController.abort();
            this.currentController = null;
            // Drain any pending polygons before canceling so frames already
            // received from backend before abort still land on screen.
            forceFlushTrackingUpdates();
            store.dispatch(updateTrackingInProgressStatus(false));
        }
        if (this.currentTask) {
            this.currentTask.cancel();
            this.currentTask = null;
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

        // P1 Task Manager 行：可取消，onCancel 走现有 cancelTracking 路径。
        const lang = store.getState().general.language;
        const tmTexts = LanguageConfig[lang].taskManager;
        const task = TaskTracker.startTask({
            type: TaskType.TRACKING,
            priority: 'P1',
            title: tmTexts.types.tracking,
            cancellable: true,
            onCancel: () => ObjectTrackingActions.cancelTracking(),
        });
        this.currentTask = task;

        const updateProgress = (step: number, description: string) => {
            store.dispatch(updateNotificationById(progressNotification.id, {
                ...progressNotification,
                currentStep: step,
                stepDescription: description,
                description,
            }));
            // 同步喂给 Task Manager；progress 由 doneCount/totalExpected 算
            const pct = Math.round((doneCount / totalExpected) * 100);
            task.update(pct, description);
        };
        updateProgress(1, `目标跟踪启动中 (0/${totalExpected})`);

        store.dispatch(updateTrackingInProgressStatus(true));

        const finalize = () => {
            // Drain any per-frame polygons still waiting in the coalescer
            // before tearing down the progress notification, otherwise the
            // last batch can be dropped (the next dispatch could mask their
            // pending state).
            forceFlushTrackingUpdates();
            store.dispatch(updateTrackingInProgressStatus(false));
            store.dispatch(deleteNotificationById(progressNotification.id));
            this.currentController = null;
            // currentTask 在 onDone/handleError 已经 complete/fail；
            // 如果还残留（比如 finalize 走到这里但前面没标记），保险起见清掉。
            this.currentTask = null;
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
            if (this.currentTask) {
                this.currentTask.fail(err);
                this.currentTask = null;
            }
            finalize();
        };

        // 把 segmentation 的 post-processing 流水线状态传给 /track，让追踪 mask 也走
        // polygon_epsilon / min_mask_area / mask_dilate / max_polygon_points。
        // 双重过滤：① pipeline 'postprocess' 阶段必须激活；② 每个参数自身 enabled。
        const postprocess = PipelineStore.isActivated('postprocess')
            ? (() => {
                const pp = SegmentationAPIDetector.getPostprocessParams();
                const out: { polygon_epsilon?: number; min_mask_area?: number; mask_dilate?: number; max_polygon_points?: number } = {};
                if (pp.polygon_epsilon_enabled !== false) out.polygon_epsilon = pp.polygon_epsilon;
                if (pp.min_mask_area_enabled !== false) out.min_mask_area = pp.min_mask_area;
                if (pp.mask_dilate_enabled !== false && pp.mask_dilate > 0) out.mask_dilate = pp.mask_dilate;
                if (pp.max_polygon_points_enabled !== false && pp.max_polygon_points > 0) out.max_polygon_points = pp.max_polygon_points;
                return Object.keys(out).length > 0 ? out : undefined;
            })()
            : undefined;

        this.currentController = TrackingAPIService.streamTrack(
            {
                sessionId: params.sessionId,
                startFrame: params.startFrameIdx,
                endFrame: params.endFrameIdx,
                bbox: params.bboxImageSpace,
                modelName: params.modelName,
                postprocess,
            },
            {
                onFrame: (f) => {
                    doneCount++;
                    // Progress text updates dispatch through the notifications
                    // reducer (queue capped to 1) — cheap, no coalescing needed.
                    updateProgress(2, `目标跟踪中 (${doneCount}/${totalExpected}) — 帧 ${f.frame_idx}`);

                    const mask = Array.isArray(f.mask) ? f.mask : [];
                    if (mask.length < 3) return;

                    // Read latest pending version first (so multiple polygons
                    // landing on the same frame within one flush window stack
                    // correctly), fall back to store.
                    const baseImg = pendingTrackingUpdates.get(
                        store.getState().labels.imagesData[f.frame_idx]?.id || ''
                    ) || store.getState().labels.imagesData[f.frame_idx];
                    if (!baseImg) return;

                    const labelId = ensureLabelId(className);

                    const polygon: LabelPolygon = {
                        id: uuidv4(),
                        labelId,
                        vertices: mask
                            .filter(([x, y]) => isFinite(x) && isFinite(y))
                            .map(([x, y]) => ({ x, y })),
                        isCreatedByAI: true,
                        isVisible: true,
                        status: LabelStatus.ACCEPTED,
                        suggestedLabel: labelId ? null : className,
                        confidence: f.confidence || 0,
                        trackingGroupId,
                    } as LabelPolygon;

                    const updated: ImageData = {
                        ...baseImg,
                        labelPolygons: [...baseImg.labelPolygons, polygon],
                    };
                    pendingTrackingUpdates.set(baseImg.id, updated);
                    scheduleTrackingFlush();
                },
                onStatus: (s) => {
                    if (s.status === 'clipping') {
                        updateProgress(1, `FFmpeg 切片 ${s.n_frames} 帧中...`);
                    } else if (s.status === 'preparing') {
                        updateProgress(1, `预处理中：SAM 2 视频编码 ${s.frames_to_encode} 帧（clip 已就位）`);
                    } else if (s.status === 'walking') {
                        // 旧路径残留；clip 模式下不再触发，但保留以兼容
                        updateProgress(1, `预处理中：SAM 2 视频编码 ${s.current}/${s.target}`);
                    }
                },
                onDone: (total) => {
                    const done = NotificationUtil.createSuccessNotification({
                        header: '目标跟踪完成',
                        description: `已生成 ${total} 帧的分割`,
                    });
                    store.dispatch(submitNewNotification(done));
                    setTimeout(() => store.dispatch(deleteNotificationById(done.id)), 3500);
                    if (this.currentTask) {
                        this.currentTask.complete();
                        this.currentTask = null;
                    }
                    finalize();
                },
                onError: (err) => { void handleError(err); },
            },
        );
    }

    /**
     * 检索模式入口：用当前帧的 SAM polygon 作为 seed mask，跨帧跟踪/检索。
     * 与 startTracking 共享整个 stream pipeline，唯一区别是 prompt 类型。
     */
    public static startRetrieval(params: RetrievalParams, _retried = false): void {
        if (this.currentController) {
            this.cancelTracking();
        }

        const trackingGroupId = uuidv4();
        const className = params.className || 'retrieved';
        const totalExpected = Math.max(1, params.endFrameIdx - params.startFrameIdx + 1);
        let doneCount = 0;

        const progressNotification = NotificationUtil.createInferenceProgressNotification();
        store.dispatch(submitNewNotification(progressNotification));

        const lang = store.getState().general.language;
        const tmTexts = LanguageConfig[lang].taskManager;
        const task = TaskTracker.startTask({
            type: TaskType.TRACKING,
            priority: 'P1',
            title: lang === 'zh' ? '检索跟踪' : 'Retrieval',
            cancellable: true,
            onCancel: () => ObjectTrackingActions.cancelTracking(),
        });
        this.currentTask = task;

        const updateProgress = (step: number, description: string) => {
            store.dispatch(updateNotificationById(progressNotification.id, {
                ...progressNotification,
                currentStep: step,
                stepDescription: description,
                description,
            }));
            const pct = Math.round((doneCount / totalExpected) * 100);
            task.update(pct, description);
        };
        updateProgress(1, lang === 'zh'
            ? `检索启动中 (0/${totalExpected})`
            : `Retrieval starting (0/${totalExpected})`);

        store.dispatch(updateTrackingInProgressStatus(true));

        const finalize = () => {
            forceFlushTrackingUpdates();
            store.dispatch(updateTrackingInProgressStatus(false));
            store.dispatch(deleteNotificationById(progressNotification.id));
            this.currentController = null;
            this.currentTask = null;
            EditorActions.fullRender();
        };

        const handleError = async (err: Error) => {
            console.error('[Retrieval] stream failed', err);
            const msg = err.message || '';
            const isSessionGone = /404/.test(msg) && /session.*not found/i.test(msg);

            if (isSessionGone && !_retried) {
                const activeVideo = store.getState().video?.activeVideo;
                if (activeVideo?.fileData) {
                    updateProgress(1, lang === 'zh' ? '视频会话已过期，正在重新上传…' : 'Session expired, re-uploading…');
                    try {
                        const result = await FrameExtractorService.openSession(
                            activeVideo.fileData,
                            activeVideo.fps || 0,
                        );
                        if (result.sessionId) {
                            store.dispatch(updateVideoSessionId(activeVideo.id, result.sessionId));
                            finalize();
                            ObjectTrackingActions.startRetrieval(
                                { ...params, sessionId: result.sessionId },
                                true,
                            );
                            return;
                        }
                    } catch (uploadErr) {
                        console.error('[Retrieval] re-upload failed', uploadErr);
                    }
                }
            }

            const description = isSessionGone
                ? (lang === 'zh' ? '视频会话已过期（后端重启后会话丢失），请重新上传视频后再追踪' : 'Video session expired')
                : msg || 'Unknown error';
            const fail = NotificationUtil.createErrorNotification({
                header: lang === 'zh' ? '检索跟踪失败' : 'Retrieval failed',
                description,
            });
            store.dispatch(submitNewNotification(fail));
            setTimeout(() => store.dispatch(deleteNotificationById(fail.id)), 5000);
            if (this.currentTask) {
                this.currentTask.fail(err);
                this.currentTask = null;
            }
            finalize();
        };

        const postprocess = PipelineStore.isActivated('postprocess')
            ? (() => {
                const pp = SegmentationAPIDetector.getPostprocessParams();
                const out: { polygon_epsilon?: number; min_mask_area?: number; mask_dilate?: number; max_polygon_points?: number } = {};
                if (pp.polygon_epsilon_enabled !== false) out.polygon_epsilon = pp.polygon_epsilon;
                if (pp.min_mask_area_enabled !== false) out.min_mask_area = pp.min_mask_area;
                if (pp.mask_dilate_enabled !== false && pp.mask_dilate > 0) out.mask_dilate = pp.mask_dilate;
                if (pp.max_polygon_points_enabled !== false && pp.max_polygon_points > 0) out.max_polygon_points = pp.max_polygon_points;
                return Object.keys(out).length > 0 ? out : undefined;
            })()
            : undefined;

        this.currentController = TrackingAPIService.streamTrack(
            {
                sessionId: params.sessionId,
                startFrame: params.startFrameIdx,
                endFrame: params.endFrameIdx,
                maskPolygons: params.maskPolygons,
                modelName: params.modelName,
                postprocess,
            },
            {
                onFrame: (f) => {
                    doneCount++;
                    updateProgress(2, lang === 'zh'
                        ? `检索中 (${doneCount}/${totalExpected}) — 帧 ${f.frame_idx}`
                        : `Retrieving (${doneCount}/${totalExpected}) — frame ${f.frame_idx}`);

                    const mask = Array.isArray(f.mask) ? f.mask : [];
                    if (mask.length < 3) return;

                    const baseImg = pendingTrackingUpdates.get(
                        store.getState().labels.imagesData[f.frame_idx]?.id || ''
                    ) || store.getState().labels.imagesData[f.frame_idx];
                    if (!baseImg) return;

                    const labelId = ensureLabelId(className);

                    const polygon: LabelPolygon = {
                        id: uuidv4(),
                        labelId,
                        vertices: mask
                            .filter(([x, y]) => isFinite(x) && isFinite(y))
                            .map(([x, y]) => ({ x, y })),
                        isCreatedByAI: true,
                        isVisible: true,
                        status: LabelStatus.ACCEPTED,
                        suggestedLabel: labelId ? null : className,
                        confidence: f.confidence || 0,
                        trackingGroupId,
                    } as LabelPolygon;

                    const updated: ImageData = {
                        ...baseImg,
                        labelPolygons: [...baseImg.labelPolygons, polygon],
                    };
                    pendingTrackingUpdates.set(baseImg.id, updated);
                    scheduleTrackingFlush();
                },
                onStatus: (s) => {
                    if (s.status === 'clipping') {
                        updateProgress(1, lang === 'zh'
                            ? `FFmpeg 切片 ${s.n_frames} 帧中...`
                            : `FFmpeg clipping ${s.n_frames} frames...`);
                    } else if (s.status === 'preparing') {
                        updateProgress(1, lang === 'zh'
                            ? `预处理中：SAM 2 视频编码 ${s.frames_to_encode} 帧`
                            : `Preparing: SAM 2 encoding ${s.frames_to_encode} frames`);
                    }
                },
                onDone: (total) => {
                    const done = NotificationUtil.createSuccessNotification({
                        header: lang === 'zh' ? '检索跟踪完成' : 'Retrieval complete',
                        description: lang === 'zh' ? `已生成 ${total} 帧的分割` : `Generated masks for ${total} frames`,
                    });
                    store.dispatch(submitNewNotification(done));
                    setTimeout(() => store.dispatch(deleteNotificationById(done.id)), 3500);
                    if (this.currentTask) {
                        this.currentTask.complete();
                        this.currentTask = null;
                    }
                    finalize();
                },
                onError: (err) => { void handleError(err); },
            },
        );
    }
}
