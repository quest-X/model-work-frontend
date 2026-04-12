import {store} from "../../index";
import {SegmentationAPIDetector, SegmentationResult} from "../../ai/SegmentationAPIDetector";
import {ImageData, LabelName, LabelPolygon} from "../../store/labels/types";
import {LabelStatus} from "../../data/enums/LabelStatus";
import {v4 as uuidv4} from "uuid";
import {updateImageDataById, updateLabelNames} from "../../store/labels/actionCreators";
import {updateFullImageInferenceStatus, addInferenceHistory, updateSegmentationResults} from "../../store/ai/actionCreators";
import {submitNewNotification, deleteNotificationById, updateNotificationById} from "../../store/notifications/actionCreators";
import {updatePerClassColorationStatus} from "../../store/general/actionCreators";
import {NotificationUtil} from "../../utils/NotificationUtil";
import {LabelUtil} from "../../utils/LabelUtil";
import {LanguageConfig} from "../../data/LanguageConfig";
import {FrameExtractorService} from "../../services/FrameExtractorService";
import {EditorActions} from "./EditorActions";
import {EditorModel} from "../../staticModels/EditorModel";

export class AISegmentationActions {

    private static yieldToUI(): Promise<void> {
        return new Promise(r => setTimeout(r, 0));
    }

    private static async withConcurrency<T>(
        tasks: Array<() => Promise<T>>,
        limit: number,
        onProgress?: (done: number, total: number) => void
    ): Promise<Array<T | null>> {
        const results: Array<T | null> = new Array(tasks.length).fill(null);
        let nextIdx = 0;
        let done = 0;

        const worker = async () => {
            while (nextIdx < tasks.length) {
                const i = nextIdx++;
                try {
                    results[i] = await tasks[i]();
                } catch {
                    results[i] = null;
                }
                done++;
                onProgress?.(done, tasks.length);
            }
        };

        await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
        return results;
    }

    /**
     * 批量分割 — 和 AIDetectionActions.detectBatch 完全并行的流程，
     * 只是 API 调用走 /segment、结果写入 labelPolygons 而非 labelRects。
     */
    public static async segmentBatch(imagesToSegment: ImageData[]): Promise<void> {
        if (!SegmentationAPIDetector.isEnabled() || imagesToSegment.length === 0) return;

        const startTime = Date.now();
        const t = () => LanguageConfig[store.getState().general.language]; // 实时读语言
        const total = imagesToSegment.length;
        let totalObjects = 0;
        let successCount = 0;
        let failCount = 0;

        console.log('[BatchSegment] Starting', { total });

        store.dispatch(updateFullImageInferenceStatus(true));
        const progressNotification = NotificationUtil.createInferenceProgressNotification();
        store.dispatch(submitNewNotification(progressNotification));

        const videoState = store.getState().video;
        const isVideo = videoState.isVideoMode;
        const allImagesData: ImageData[] = store.getState().labels.imagesData;
        const activeVideo = isVideo ? videoState.activeVideo : null;
        const fps = activeVideo?.fps || 30;

        // 通知辅助（节流 150ms）
        let lastNotifyTime = 0;
        const notify = (step: number, stepDesc: string, detail: string, force = false) => {
            const now = Date.now();
            if (!force && now - lastNotifyTime < 150) return;
            lastNotifyTime = now;
            store.dispatch(updateNotificationById(progressNotification.id, {
                ...progressNotification,
                currentStep: step,
                stepDescription: stepDesc,
                description: detail
            }));
        };

        const preFrames = activeVideo?.preExtractedFrames;
        const sessionId = activeVideo?.sessionId || EditorModel.videoSessionId;

        if (isVideo && (preFrames || sessionId || EditorModel.videoElement)) {
            // ======== Video mode: 帧捕获 + 分割 ========
            const selectedIds = new Set(imagesToSegment.map(img => img.id));
            const frameQueue: { frameIdx: number; imageData: ImageData }[] = [];
            for (let frameIdx = 0; frameIdx < allImagesData.length; frameIdx++) {
                if (selectedIds.has(allImagesData[frameIdx].id)) {
                    frameQueue.push({ frameIdx, imageData: allImagesData[frameIdx] });
                }
            }

            const captureTotal = frameQueue.length;
            console.log('[BatchSegment] Frame queue:', { captureTotal });

            if (captureTotal === 0) {
                store.dispatch(deleteNotificationById(progressNotification.id));
                store.dispatch(updateFullImageInferenceStatus(false));
                return;
            }

            let capturedBlobs: Array<Blob | null>;

            if (preFrames) {
                // fast_ffmpeg_mode (full-load)
                capturedBlobs = frameQueue.map(({ frameIdx }) =>
                    frameIdx < preFrames.length ? (preFrames[frameIdx] as Blob) : null
                );
            } else if (sessionId) {
                // fast_ffmpeg_mode (on-demand): fetch frames from backend
                capturedBlobs = new Array(captureTotal).fill(null);
                const FETCH_BATCH = 10;
                for (let i = 0; i < captureTotal; i += FETCH_BATCH) {
                    const count = Math.min(FETCH_BATCH, captureTotal - i);
                    const pct = Math.round((i / captureTotal) * 33);
                    notify(1,
                        `${t().aiInference.steps.captureFrame} (${i + count}/${captureTotal})`,
                        `${pct}%`
                    );
                    try {
                        const batchFrames = await FrameExtractorService.fetchFrameRange(sessionId, i, count);
                        for (let j = 0; j < batchFrames.length; j++) {
                            capturedBlobs[i + j] = batchFrames[j] as Blob;
                        }
                    } catch (err) {
                        console.warn(`[Segment/Capture] fetch frames ${i}-${i + count} failed:`, err);
                    }
                    if (i % 20 === 0 && i > 0) await this.yieldToUI();
                }
            } else {
                // raw_browser_mode: not implemented for segmentation (fallback)
                console.warn('[BatchSegment] raw_browser_mode not supported for segmentation');
                capturedBlobs = [];
            }

            // === 流式分割推理：4路并发 ===
            const inferStartTime = Date.now();
            console.log('[Segment] Streaming start', { captureTotal, concurrency: 4 });

            const tasks = capturedBlobs.map((blob, i) => {
                return async (): Promise<SegmentationResult[] | null> => {
                    if (!blob) {
                        failCount++;
                        store.dispatch(addInferenceHistory(frameQueue[i].imageData.id, 0, false, 'segmentation'));
                        return null;
                    }
                    try {
                        const results = await SegmentationAPIDetector.predictFromBlob(
                            blob, `frame_${frameQueue[i].frameIdx}.jpg`
                        );
                        this.applySingleResult(frameQueue[i].imageData, results);
                        totalObjects += results.length;
                        successCount++;
                        return results;
                    } catch (err) {
                        console.error(`[Segment] Frame ${frameQueue[i].frameIdx} FAILED:`, (err as Error).message);
                        failCount++;
                        store.dispatch(addInferenceHistory(frameQueue[i].imageData.id, 0, false, 'segmentation'));
                        return null;
                    }
                };
            });

            await this.withConcurrency(tasks, 4, (done, ttl) => {
                const pct = preFrames ? Math.round((done / ttl) * 90) : 33 + Math.round((done / ttl) * 55);
                notify(2, `${t().aiInference.steps.inferring} (${done}/${ttl})`, `${pct}% — ${t().video.frame} ${frameQueue[Math.min(done - 1, ttl - 1)].frameIdx}`);
            });

            console.log('[Segment] Streaming complete', {
                success: successCount, failed: failCount, elapsed: ((Date.now() - inferStartTime) / 1000).toFixed(1) + 's'
            });

        } else {
            // ======== 普通图像模式：4路并发流式分割 ========
            const imageQueue = imagesToSegment.filter(
                img => !img.labelPolygons.some(p => p.isCreatedByAI)
            );
            successCount = total - imageQueue.length;

            const imageTasks = imageQueue.map((imageData) => async (): Promise<SegmentationResult[] | null> => {
                try {
                    const blob = imageData.fileData;
                    const results = await SegmentationAPIDetector.predictFromBlob(blob, imageData.fileData?.name || 'image.jpg');
                    this.applySingleResult(imageData, results);
                    totalObjects += results.length;
                    successCount++;
                    return results;
                } catch (err) {
                    console.error(`[Segment] Image ${imageData.fileData?.name} FAILED:`, (err as Error).message);
                    failCount++;
                    store.dispatch(addInferenceHistory(imageData.id, 0, false, 'segmentation'));
                    return null;
                }
            });

            await this.withConcurrency(imageTasks, 4, (done, ttl) => {
                const pct = Math.round((done / ttl) * 100);
                notify(2, `${t().aiInference.steps.inferring} (${done}/${ttl})`, `${pct}% — ${imageQueue[done - 1]?.fileData?.name || `Image ${done}`}`);
            });
        }

        // ── 完成 ──
        store.dispatch(deleteNotificationById(progressNotification.id));
        store.dispatch(updateFullImageInferenceStatus(false));

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log('[BatchSegment] Complete', { totalTime: totalTime + 's', successCount, failCount, totalObjects });

        const doneTexts = t();
        store.dispatch(submitNewNotification(NotificationUtil.createSuccessNotification({
            header: doneTexts.notifications.batchDetectionCompleted,
            description: doneTexts.notifications.batchDetectionCompletedMessage
                .replace('{total}', String(successCount))
                .replace('{count}', String(totalObjects))
                .replace('{time}', totalTime)
        })));

        if (!store.getState().general.enablePerClassColoration) {
            store.dispatch(updatePerClassColorationStatus(true));
        }

        EditorActions.fullRender();
    }

    /**
     * 单帧分割结果写入 Redux
     */
    private static applySingleResult(
        imageData: ImageData,
        results: SegmentationResult[]
    ): void {
        if (!results || results.length === 0) return;

        // 创建缺失标签
        const allClassNames = new Set(results.map(r => r.info.name));
        const existingLabels: LabelName[] = store.getState().labels.labels;
        const missingNames = [...allClassNames].filter(
            name => !existingLabels.some(e => e.name.toLowerCase() === name.toLowerCase())
        );
        if (missingNames.length > 0) {
            const newLabels = missingNames.map(name => LabelUtil.createLabelName(name));
            store.dispatch(updateLabelNames([...existingLabels, ...newLabels]));
        }

        const updatedLabels: LabelName[] = store.getState().labels.labels;
        const currentImagesData: ImageData[] = store.getState().labels.imagesData;
        const currentImg = currentImagesData.find(img => img.id === imageData.id);
        if (!currentImg) return;

        // mask → LabelPolygon
        const newPolygons: LabelPolygon[] = results
            .filter(result => result.mask && result.mask.length >= 3)
            .map(result => {
                const matchingLabel = updatedLabels.find(l =>
                    l.name.toLowerCase() === result.info.name.toLowerCase()
                );
                const labelId = matchingLabel?.id || null;

                return {
                    id: uuidv4(),
                    labelId,
                    vertices: result.mask
                        .filter(([x, y]) => isFinite(x) && isFinite(y))
                        .map(([x, y]) => ({ x, y })),
                    isCreatedByAI: true,
                    isVisible: true,
                    status: LabelStatus.ACCEPTED,
                    suggestedLabel: labelId ? null : result.info.name,
                };
            });

        if (newPolygons.length > 0) {
            const updatedImg = {
                ...currentImg,
                labelPolygons: [...currentImg.labelPolygons, ...newPolygons]
            };
            store.dispatch(updateImageDataById(imageData.id, updatedImg));
        }

        // 存储统一格式的推理结果（用于 InferenceResultsView）
        const segResults = SegmentationAPIDetector.convertToUnifiedFormat(results);
        store.dispatch(updateSegmentationResults(segResults, imageData.id));
        store.dispatch(addInferenceHistory(imageData.id, results.length, true, 'segmentation'));

        EditorActions.fullRender();
    }
}
