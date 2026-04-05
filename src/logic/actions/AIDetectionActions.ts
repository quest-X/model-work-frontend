import {store} from "../../index";
import {DetectionAPIDetector, DetectionResult} from "../../ai/DetectionAPIDetector";
import {ImageData, LabelName, LabelRect} from "../../store/labels/types";
import {LabelStatus} from "../../data/enums/LabelStatus";
import {v4 as uuidv4} from "uuid";
import {updateImageDataById, updateImageData, updateLabelNames, updateActiveImageIndex} from "../../store/labels/actionCreators";
import {updateFullImageInferenceStatus, addInferenceHistory, toggleImageAILabelsVisibility, updateSegmentationResults} from "../../store/ai/actionCreators";
import {submitNewNotification, deleteNotificationById, updateNotificationById} from "../../store/notifications/actionCreators";
import {updatePerClassColorationStatus} from "../../store/general/actionCreators";
import {updateVideoCurrentFrame} from "../../store/video/actionCreators";
import {NotificationUtil} from "../../utils/NotificationUtil";
import {LabelUtil} from "../../utils/LabelUtil";
import {RectUtil} from "../../utils/RectUtil";
import {IRect} from "../../interfaces/IRect";
import {AISelector} from "../../store/selectors/AISelector";
import {LanguageConfig} from "../../data/LanguageConfig";
import {EditorActions} from "./EditorActions";
import {EditorModel} from "../../staticModels/EditorModel";

export class AIDetectionActions {

    /**
     * 执行全图目标检测
     * @param imageData 当前图片数据
     */
    public static detectObjects(imageData: ImageData): void {
        // 检测功能独立运行，不受分割功能开关状态影响
        
        // 检查检测API是否可用
        if (!DetectionAPIDetector.isEnabled()) {
            return;
        }

        // 创建检测进度通知
        const progressNotification = NotificationUtil.createInferenceProgressNotification();
        store.dispatch(submitNewNotification(progressNotification));

        // 获取国际化文本
        const language = store.getState().general.language;
        const texts = LanguageConfig[language];

        // 更新进度：步骤1 - 预处理 (立即执行，无延迟)
        queueMicrotask(() => {
            const step1Notification = NotificationUtil.updateInferenceProgress(
                progressNotification, 
                1, 
                texts.aiInference.steps.preprocessing
            );
            store.dispatch(updateNotificationById(progressNotification.id, step1Notification));
        });

        // 更新进度：步骤2 - 检测过程
        const step2Notification = NotificationUtil.updateInferenceProgress(
            progressNotification, 
            2, 
            texts.notifications.detectionInProgress
        );
        store.dispatch(updateNotificationById(progressNotification.id, step2Notification));

        // 使用微任务调用检测API，避免阻塞UI
        queueMicrotask(() => {
            // 调用检测API
            DetectionAPIDetector.predict(
                imageData,
                // 成功回调
                (results: DetectionResult[]) => {
                    // 更新进度：步骤3 - 后处理
                    const step3Notification = NotificationUtil.updateInferenceProgress(
                        step2Notification, 
                        3, 
                        texts.aiInference.steps.postprocessing
                    );
                    store.dispatch(updateNotificationById(progressNotification.id, step3Notification));
                    // 检测完成，发现对象
                
                    // 将检测结果转换为可编辑的标注框
                    this.convertDetectionResultsToLabelRects(imageData, results);

                    // 将检测结果同步到推理结果视图
                    const segResults = DetectionAPIDetector.convertToSegmentationFormat(results);
                    store.dispatch(updateSegmentationResults(segResults));
                    
                    // 批量更新通知，避免多次dispatch
                    queueMicrotask(() => {
                        // 完成检测进度，显示最终统计
                        const completedNotification = NotificationUtil.completeInferenceProgress(
                            step3Notification,
                            results.length
                        );
                        store.dispatch(updateNotificationById(progressNotification.id, completedNotification));
                        
                        // 延迟显示成功通知，但缩短时间
                        setTimeout(() => {
                            // 删除进度通知
                            store.dispatch(deleteNotificationById(progressNotification.id));
                            
                            const totalTime = ((Date.now() - progressNotification.startTime!) / 1000).toFixed(2);
                            
                            // 显示成功通知
                            const language = store.getState().general.language;
                            const texts = LanguageConfig[language];
                            const successNotification = NotificationUtil.createSuccessNotification({
                                header: texts.notifications.detectionCompleted,
                                description: texts.notifications.detectionCompletedMessage
                                    .replace('{count}', String(results.length))
                                    .replace('{time}', totalTime)
                            });
                            successNotification.i18nHeader = 'notifications.detectionCompleted';
                            successNotification.i18nDescription = 'notifications.detectionCompletedMessage';
                            successNotification.i18nParams = { count: String(results.length), time: totalTime };
                            store.dispatch(submitNewNotification(successNotification));
                        }, 800); // 减少延迟时间
                    });

                    // 记录详细结果（性能优化：移除日志输出）
                    
                    // 重置检测状态
                    store.dispatch(updateFullImageInferenceStatus(false));

                    // 添加检测历史记录（会自动设置aiLabelsVisible为true）
                    store.dispatch(addInferenceHistory(imageData.id, results.length, true, 'detection'));

                    // 触发 canvas 重绘，显示检测结果
                    EditorActions.fullRender();
                },
                // 失败回调
                (error: Error) => {
                    // 目标检测失败
                    
                    // 删除进度通知
                    store.dispatch(deleteNotificationById(progressNotification.id));
                    
                    // 显示错误通知
                    const language = store.getState().general.language;
                    const texts = LanguageConfig[language];
                    const errorNotification = NotificationUtil.createErrorNotification({
                        header: texts.notifications.detectionFailed,
                        description: error.message || texts.notifications.detectionFailedMessage
                    });
                    errorNotification.i18nHeader = 'notifications.detectionFailed';
                    store.dispatch(submitNewNotification(errorNotification));
                    
                    // 重置检测状态
                    store.dispatch(updateFullImageInferenceStatus(false));
                    
                    // 添加失败的检测历史记录
                    // 检测失败，添加失败记录
                    store.dispatch(addInferenceHistory(imageData.id, 0, false, 'detection'));
                }
            );
        }); // 移除不必要的延迟
    }

    /** 让出主线程给 UI 渲染 */
    private static yieldToUI(): Promise<void> {
        return new Promise(r => setTimeout(r, 0));
    }

    /**
     * 并发信号量：限制同时进行的 async 任务数
     */
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
     * 批量检测 — 顺序两阶段架构（无竞态条件）
     *
     * 视频模式：
     *   Phase 1: 顺序捕获（一帧一帧 seek+capture，无并发，无共享可变状态）
     *   Phase 2: 4路并发推理（withConcurrency，已验证安全）
     *   Phase 3: 单次 Redux dispatch 批量写入所有结果
     *
     * 图像模式：
     *   4路并发推理 → 批量写入
     */
    public static async detectBatch(imagesToDetect: ImageData[]): Promise<void> {
        if (!DetectionAPIDetector.isEnabled() || imagesToDetect.length === 0) return;

        const startTime = Date.now();
        const language = store.getState().general.language;
        const texts = LanguageConfig[language];
        const total = imagesToDetect.length;
        let totalObjects = 0;
        let successCount = 0;
        let failCount = 0;

        console.log('[BatchDetect] Starting', { total });

        const progressNotification = NotificationUtil.createInferenceProgressNotification();
        store.dispatch(submitNewNotification(progressNotification));

        const videoState = store.getState().video;
        const isVideo = videoState.isVideoMode;
        const allImagesData: ImageData[] = store.getState().labels.imagesData;
        const activeVideo = isVideo ? videoState.activeVideo : null;
        const fps = activeVideo?.fps || 30;

        console.log('[BatchDetect] Mode:', isVideo ? `video (fps=${fps})` : 'image');

        // 通知辅助（节流 150ms）— 更新 stepDescription + currentStep
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

        // ======== 视频模式 ========
        const preFrames = activeVideo?.preExtractedFrames;

        if (isVideo && (preFrames || EditorModel.videoElement)) {
            // 视频模式：检测 ALL 帧（不依赖 isSelected 标志，直接用 store 中的完整列表）
            const frameQueue: { frameIdx: number; imageData: ImageData }[] = [];
            for (let frameIdx = 0; frameIdx < allImagesData.length; frameIdx++) {
                frameQueue.push({ frameIdx, imageData: allImagesData[frameIdx] });
            }

            const captureTotal = frameQueue.length;
            console.log('[BatchDetect] Frame queue:', { captureTotal, skipped: total - captureTotal });

            if (captureTotal === 0) {
                store.dispatch(deleteNotificationById(progressNotification.id));
                store.dispatch(updateFullImageInferenceStatus(false));
                return;
            }

            let capturedBlobs: Array<Blob | null>;

            if (preFrames) {
                // === 预拆帧模式：直接使用帧 File 作为 Blob（跳过 Phase 1 捕获） ===
                console.log('[Capture] 预拆帧模式：跳过 Phase 1，直接使用帧数据', { captureTotal });
                notify(1, `使用预拆帧数据 (${captureTotal} 帧)`, '跳过捕获阶段...', true);
                capturedBlobs = frameQueue.map(({ frameIdx }) =>
                    frameIdx < preFrames.length ? (preFrames[frameIdx] as Blob) : null
                );
            } else {
                // === 回退模式：Phase 1 顺序捕获 ===
                const video = EditorModel.videoElement!;
                const captureCanvas = document.createElement('canvas');
                captureCanvas.width = video.videoWidth;
                captureCanvas.height = video.videoHeight;
                const captureCtx = captureCanvas.getContext('2d')!;

                capturedBlobs = new Array(captureTotal).fill(null);
                let captureSuccess = 0;
                let captureFail = 0;
                const captureStartTime = Date.now();

                console.log('[Capture] Phase 1 starting', {
                    captureTotal,
                    videoSize: `${video.videoWidth}x${video.videoHeight}`,
                    readyState: video.readyState
                });

                for (let i = 0; i < captureTotal; i++) {
                    const { frameIdx } = frameQueue[i];
                    const targetTime = frameIdx / fps;

                    if (i % 5 === 0 || i === captureTotal - 1) {
                        const pct = Math.round((i / captureTotal) * 33);
                        notify(1, `${texts.aiInference.steps.captureFrame} (${i + 1}/${captureTotal})`, `${pct}% — 帧 ${frameIdx}`);
                    }
                    if (i % 8 === 0 && i > 0) await this.yieldToUI();

                    let captured = false;
                    for (let attempt = 0; attempt < 4; attempt++) {
                        await this.seekVideoToTimeForCapture(video, targetTime);
                        try {
                            capturedBlobs[i] = await this.captureFrameToBlob(video, captureCtx, captureCanvas);
                            captured = true;
                            break;
                        } catch (err) {
                            console.warn(`[Capture] Frame ${frameIdx} attempt ${attempt + 1} failed: ${(err as Error).message}, readyState=${video.readyState}`);
                            if (attempt < 3) {
                                await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
                            }
                        }
                    }

                    if (captured) {
                        captureSuccess++;
                    } else {
                        captureFail++;
                        console.error(`[Capture] Frame ${frameIdx} FAILED after 3 attempts`);
                    }
                }

                captureCanvas.width = 0;
                captureCanvas.height = 0;

                const captureElapsed = ((Date.now() - captureStartTime) / 1000).toFixed(1);
                console.log('[Capture] Phase 1 complete', {
                    success: captureSuccess,
                    failed: captureFail,
                    total: captureTotal,
                    elapsed: captureElapsed + 's'
                });
            }

            // === Phase 2: 4路并发推理 ===
            const inferStartTime = Date.now();
            console.log('[Inference] Phase 2 starting', { captureTotal, concurrency: 4 });

            const tasks = capturedBlobs.map((blob, i) => {
                return async (): Promise<DetectionResult[] | null> => {
                    if (!blob) {
                        console.warn(`[Inference] Skipping frame ${frameQueue[i].frameIdx} — no blob`);
                        return null;
                    }
                    try {
                        const results = await DetectionAPIDetector.predictFromBlob(
                            blob, `frame_${frameQueue[i].frameIdx}.jpg`
                        );
                        console.log(`[Inference] Frame ${frameQueue[i].frameIdx}: ${results.length} objects`);
                        return results;
                    } catch (err) {
                        console.error(`[Inference] Frame ${frameQueue[i].frameIdx} FAILED:`, (err as Error).message);
                        return null;
                    }
                };
            });

            const inferenceResults = await this.withConcurrency(tasks, 4, (done, ttl) => {
                const pct = preFrames ? Math.round((done / ttl) * 90) : 33 + Math.round((done / ttl) * 55);
                notify(2, `${texts.aiInference.steps.inferring} (${done}/${ttl})`, `${pct}% — 帧 ${frameQueue[Math.min(done - 1, ttl - 1)].frameIdx}`);
            });

            const inferElapsed = ((Date.now() - inferStartTime) / 1000).toFixed(1);
            const inferSuccess = inferenceResults.filter(r => r !== null).length;
            console.log('[Inference] Phase 2 complete', {
                success: inferSuccess,
                failed: captureTotal - inferSuccess,
                elapsed: inferElapsed + 's'
            });

            // === Phase 3: 批量写入 Redux ===
            notify(3, `写入标注数据 (${captureTotal} 帧)`, '即将完成...', true);
            await this.yieldToUI();

            console.log('[Apply] Phase 3 starting');
            this.batchApplyResults(frameQueue, inferenceResults);

            for (let i = 0; i < captureTotal; i++) {
                const r = inferenceResults[i];
                if (r !== null) {
                    store.dispatch(addInferenceHistory(frameQueue[i].imageData.id, r.length, true, 'detection'));
                    totalObjects += r.length;
                    successCount++;
                } else {
                    store.dispatch(addInferenceHistory(frameQueue[i].imageData.id, 0, false, 'detection'));
                    failCount++;
                }
            }

            console.log('[Apply] Phase 3 complete', { totalObjects, successCount, failCount });

        } else {
            // ======== 普通图像模式：4路并发 ========
            const imageQueue = imagesToDetect.filter(
                img => !img.labelRects.some((r: LabelRect) => r.isCreatedByAI)
            );
            successCount = total - imageQueue.length;

            const imageTasks = imageQueue.map((imageData) => async (): Promise<DetectionResult[] | null> => {
                try {
                    return await new Promise((resolve, reject) => {
                        DetectionAPIDetector.predict(imageData, resolve, reject);
                    });
                } catch (err) {
                    console.error(`[Inference] Image ${imageData.fileData?.name} FAILED:`, (err as Error).message);
                    return null;
                }
            });

            const imageResults = await this.withConcurrency(imageTasks, 4, (done, ttl) => {
                const pct = Math.round((done / ttl) * 100);
                notify(2, `${texts.aiInference.steps.inferring} (${done}/${ttl})`, `${pct}% — ${imageQueue[done - 1]?.fileData?.name || `Image ${done}`}`);
            });

            this.batchApplyResults(
                imageQueue.map((imageData, i) => ({ frameIdx: i, imageData })),
                imageResults
            );

            for (let i = 0; i < imageQueue.length; i++) {
                const results = imageResults[i];
                if (results !== null) {
                    store.dispatch(addInferenceHistory(imageQueue[i].id, results.length, true, 'detection'));
                    totalObjects += results.length;
                    successCount++;
                } else {
                    store.dispatch(addInferenceHistory(imageQueue[i].id, 0, false, 'detection'));
                    failCount++;
                }
            }
        }

        // ── 完成 ──
        // 视频模式：检测完成后同步到第一帧，确保画面和检测结果一致
        if (isVideo && activeVideo) {
            store.dispatch(updateVideoCurrentFrame(activeVideo.id, 0, 0));
            store.dispatch(updateActiveImageIndex(0));
        }

        store.dispatch(deleteNotificationById(progressNotification.id));
        store.dispatch(updateFullImageInferenceStatus(false));

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log('[BatchDetect] Complete', { totalTime: totalTime + 's', successCount, failCount, totalObjects });

        const lang = store.getState().general.language;
        const t = LanguageConfig[lang];
        store.dispatch(submitNewNotification(NotificationUtil.createSuccessNotification({
            header: t.notifications.batchDetectionCompleted,
            description: t.notifications.batchDetectionCompletedMessage
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
     * 批量将推理结果写入 Redux — 单次 dispatch 更新所有图像
     * 避免 N 次 updateImageDataById 触发 N 次 React 重渲染
     */
    private static batchApplyResults(
        frameQueue: { frameIdx: number; imageData: ImageData }[],
        inferenceResults: Array<DetectionResult[] | null>
    ): void {
        // 预先创建所有缺失的标签（合并所有结果中的类别名，一次性创建）
        const allClassNames = new Set<string>();
        for (const results of inferenceResults) {
            if (results) results.forEach(r => allClassNames.add(r.info.name));
        }
        const existingLabels: LabelName[] = store.getState().labels.labels;
        const missingNames = [...allClassNames].filter(
            name => !existingLabels.some(e => e.name.toLowerCase() === name.toLowerCase())
        );
        if (missingNames.length > 0) {
            this.createMissingLabels(missingNames);
        }

        // 用最新的标签列表生成 LabelRects
        const updatedLabels: LabelName[] = store.getState().labels.labels;
        const currentImagesData: ImageData[] = [...store.getState().labels.imagesData];

        // 构建 imageId → imagesData 索引的 map 加速查找
        const idToIdx = new Map<string, number>();
        currentImagesData.forEach((img, idx) => idToIdx.set(img.id, idx));

        let modified = false;

        for (let i = 0; i < frameQueue.length; i++) {
            const results = inferenceResults[i];
            if (!results) { continue; }
            if (results.length === 0) { continue; }

            const { imageData } = frameQueue[i];
            const arrIdx = idToIdx.get(imageData.id);
            if (arrIdx === undefined) { continue; }

            const currentImg = currentImagesData[arrIdx];
            const newRects: LabelRect[] = [];

            for (const result of results) {
                const [x1, y1, x2, y2] = result.bbox;
                const rect: IRect = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };

                if (this.checkDuplicateLabelRect(currentImg.labelRects, rect, result.info.name, updatedLabels)) {
                    continue;
                }

                const matchingLabel = updatedLabels.find(l =>
                    l.name.toLowerCase() === result.info.name.toLowerCase()
                );
                const labelId = matchingLabel?.id || null;

                newRects.push({
                    id: uuidv4(),
                    labelId,
                    rect,
                    isCreatedByAI: true,
                    isVisible: true,
                    status: LabelStatus.ACCEPTED,
                    suggestedLabel: labelId ? null : result.info.name,
                    confidence: result.info.confidence ?? 0
                });
            }

            if (newRects.length > 0) {
                currentImagesData[arrIdx] = {
                    ...currentImg,
                    labelRects: [...currentImg.labelRects, ...newRects]
                };
                modified = true;
            }
        }

        // 单次 dispatch 更新全部图像数据
        if (modified) {
            store.dispatch(updateImageData(currentImagesData));
            // 同步缓存到 EditorModel，供播放时 handleVideoTimeUpdate 立即读取
            // （避免 imagesDataRef 在 React 重渲染前读到旧数据导致 rects=0）
            EditorModel.latestImagesData = currentImagesData;
        }

        // 为每个有检测结果的帧设置 aiLabelsVisible = true
        // 否则 RectRenderEngine 中 `isCreatedByAI ? aiLabelsVisible : true` 会隐藏所有 AI 框
        for (let i = 0; i < frameQueue.length; i++) {
            const results = inferenceResults[i];
            if (results && results.length > 0) {
                const { imageData } = frameQueue[i];
                store.dispatch(addInferenceHistory(imageData.id, results.length, true, 'detection'));
            }
        }
    }

    /**
     * 复用已有 canvas 从视频捕获当前帧为 Blob。
     * 用 createImageBitmap 验证帧非空。
     */
    private static async captureFrameToBlob(
        video: HTMLVideoElement,
        ctx: CanvasRenderingContext2D,
        canvas: HTMLCanvasElement
    ): Promise<Blob> {
        if (video.readyState < 2) throw new Error('Video not ready');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob: Blob = await new Promise((resolve, reject) => {
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.92);
        });
        const bmp = await createImageBitmap(blob);
        bmp.close();
        return blob;
    }

    /**
     * 将检测结果转换为可编辑的标注框（异步版，单张检测用）
     */
    private static convertDetectionResultsToLabelRects(imageData: ImageData, results: DetectionResult[]): void {
        this.createMissingLabelsIfNeeded(results);
        queueMicrotask(() => {
            // 单张检测走 batchApplyResults 同样的逻辑
            this.batchApplyResults(
                [{ frameIdx: 0, imageData }],
                [results]
            );
        });
    }

    /** 如果检测结果中有未知标签，先创建 */
    private static createMissingLabelsIfNeeded(results: DetectionResult[]): void {
        const existingLabels: LabelName[] = store.getState().labels.labels;
        const uniqueNewLabels = [...new Set(results
            .filter(result => !existingLabels.some(existing =>
                existing.name.toLowerCase() === result.info.name.toLowerCase()
            ))
            .map(result => result.info.name)
        )];
        if (uniqueNewLabels.length > 0) {
            this.createMissingLabels(uniqueNewLabels);
        }
    }

    /**
     * 创建缺失的标签
     */
    private static createMissingLabels(labelNames: string[]): void {
        const existingLabels: LabelName[] = store.getState().labels.labels;
        
        // 过滤掉已存在的标签名称（不区分大小写）
        const filteredLabelNames = labelNames.filter(name => 
            !existingLabels.some(existing => 
                existing.name.toLowerCase() === name.toLowerCase()
            )
        );
        
        if (filteredLabelNames.length === 0) {
            console.log('所有AI检测标签都已存在，无需创建新标签');
            return;
        }
        
        const newLabels = filteredLabelNames.map(name => LabelUtil.createLabelName(name));
        const updatedLabels = [...existingLabels, ...newLabels];
        
        store.dispatch(updateLabelNames(updatedLabels));
        // 创建了AI标签，跳过重复标签（性能优化：移除日志）
    }

    /**
     * 检查是否为重复的标注框
     */
    private static checkDuplicateLabelRect(
        existingLabelRects: LabelRect[], 
        detectionRect: IRect, 
        className: string,
        existingLabels: LabelName[]
    ): boolean {
        const IOU_THRESHOLD = 0.7; // IOU阈值，大于此值认为是相同位置
        
        for (const existingRect of existingLabelRects) {
            const iou = RectUtil.calculateIOU(existingRect.rect, detectionRect);
            
            if (iou > IOU_THRESHOLD) {
                let isSameLabel = false;
                
                if (existingRect.labelId) {
                    const existingLabelName = existingLabels.find(label => label.id === existingRect.labelId);
                    if (existingLabelName) {
                        isSameLabel = existingLabelName.name.toLowerCase() === className.toLowerCase();
                    }
                } else if (existingRect.suggestedLabel) {
                    isSameLabel = existingRect.suggestedLabel.toLowerCase() === className.toLowerCase();
                }
                
                if (isSameLabel) {
                    console.log(`🔍 检测到重复标注框: ${className} (IOU: ${iou.toFixed(3)})`);
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 批量捕获专用 seek — 不依赖 rVFC（视频 opacity:0 时 rVFC 可能不触发）
     *
     * 策略：seeked 事件 → 轮询 readyState >= 3（最多 2s）→ 100ms 缓冲
     * H.264 远离关键帧的帧解码可能需要 >500ms，故轮询上限设为 2s。
     */
    private static seekVideoToTimeForCapture(video: HTMLVideoElement, time: number): Promise<void> {
        return new Promise<void>((resolve) => {
            // 已在目标时间
            if (Math.abs(video.currentTime - time) < 0.001) {
                if (video.readyState >= 3) {
                    setTimeout(resolve, 50);
                    return;
                }
                // 已到目标时间但帧未解码 — 直接轮询 readyState，不依赖 seeked 事件
                // （设置相同的 currentTime 不会触发 seeked）
                let polls = 0;
                const check = () => {
                    if (video.readyState >= 3 || polls >= 100) {
                        setTimeout(resolve, 100);
                    } else {
                        polls++;
                        setTimeout(check, 20);
                    }
                };
                check();
                return;
            }

            let settled = false;
            const settle = () => {
                if (settled) return;
                settled = true;
                video.removeEventListener('seeked', onSeeked);
                clearTimeout(emergencyTimer);
                resolve();
            };

            const emergencyTimer = setTimeout(() => {
                console.warn(`[Capture] Seek timeout for time=${time.toFixed(3)}, readyState=${video.readyState}, currentTime=${video.currentTime.toFixed(3)}`);
                settle();
            }, 5000); // 5秒保护（H.264 极端情况）

            const waitForDecode = () => {
                let polls = 0;
                const check = () => {
                    if (video.readyState >= 3 || polls >= 100) { // 100 × 20ms = 2000ms
                        setTimeout(settle, 100); // 100ms 缓冲
                    } else {
                        polls++;
                        setTimeout(check, 20);
                    }
                };
                check();
            };

            const onSeeked = () => {
                if (video.readyState >= 3) {
                    setTimeout(settle, 100);
                } else {
                    waitForDecode();
                }
            };

            video.addEventListener('seeked', onSeeked, { once: true });
            video.currentTime = time;
        });
    }

    /**
     * 单帧检测用 seek — 使用 rVFC 获得最高精度（视频可见时使用）
     */
    private static seekVideoToTime(video: HTMLVideoElement, time: number): Promise<void> {
        return new Promise<void>((resolve) => {
            if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) {
                resolve();
                return;
            }

            let settled = false;
            const settle = () => {
                if (settled) return;
                settled = true;
                clearTimeout(globalTimer);
                resolve();
            };

            const globalTimer = setTimeout(settle, 5000);

            const onSeeked = () => {
                if ('requestVideoFrameCallback' in video) {
                    (video as any).requestVideoFrameCallback(() => settle());
                } else {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            setTimeout(settle, 20);
                        });
                    });
                }
            };

            video.addEventListener('seeked', onSeeked, { once: true });
            video.currentTime = time;
        });
    }
}
