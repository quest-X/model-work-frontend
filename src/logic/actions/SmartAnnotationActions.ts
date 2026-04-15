import {store} from '../../index';
import {IPoint} from '../../interfaces/IPoint';
import {IRect} from '../../interfaces/IRect';
import {LabelsSelector} from '../../store/selectors/LabelsSelector';
import {SegmentationAPIDetector} from '../../ai/SegmentationAPIDetector';
import {submitNewNotification, deleteNotificationById, updateNotificationById} from '../../store/notifications/actionCreators';
import {NotificationUtil} from '../../utils/NotificationUtil';
import {NotificationsDataMap} from '../../data/info/NotificationsData';
import {Notification} from '../../data/enums/Notification';
import {ImageData} from '../../store/labels/types';
import {EditorModel} from '../../staticModels/EditorModel';
import {FrameExtractorService} from '../../services/FrameExtractorService';
import {LanguageConfig} from '../../data/LanguageConfig';
import {PendingPromptModel} from '../../staticModels/PendingPromptModel';
import {v4 as uuidv4} from 'uuid';
// NOTE: AISegmentationActions is imported dynamically inside runPrompt to avoid
// a circular import cycle: AISegmentationActions → EditorActions → RectRenderEngine
// → SmartAnnotationActions → AISegmentationActions. The cycle would crash module init
// (Cannot access 'ContextManager' before initialization).

/**
 * Smart annotation interactive actions — fires SAM prompt-based inference
 * from a single canvas click (point) or drag (bbox). Coordinates are passed
 * in IMAGE space (already converted by RectRenderEngine via RenderEngineUtil).
 *
 * Result is appended to the active image's labelPolygons via
 * AISegmentationActions.applySingleResult(..., 'smart'), which skips the
 * batch-inference history/results-panel bookkeeping.
 */
export class SmartAnnotationActions {

    public static async firePoint(pointOnImage: IPoint): Promise<void> {
        const promptId = uuidv4();
        PendingPromptModel.add({ id: promptId, kind: 'point', point: pointOnImage });
        try {
            await this.runPrompt({ point: [pointOnImage.x, pointOnImage.y] });
        } finally {
            PendingPromptModel.remove(promptId);
        }
    }

    public static async fireBbox(rectOnImage: IRect): Promise<void> {
        const promptId = uuidv4();
        PendingPromptModel.add({ id: promptId, kind: 'bbox', bbox: rectOnImage });
        const x1 = rectOnImage.x;
        const y1 = rectOnImage.y;
        const x2 = rectOnImage.x + rectOnImage.width;
        const y2 = rectOnImage.y + rectOnImage.height;
        try {
            await this.runPrompt({ bbox: [x1, y1, x2, y2] });
        } finally {
            PendingPromptModel.remove(promptId);
        }
    }

    private static async runPrompt(
        prompt: { point?: [number, number]; bbox?: [number, number, number, number] }
    ): Promise<void> {
        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData) {
            this.notifyError('No active image');
            return;
        }

        // 进度通知（和检测/批量分割推理一致的视觉反馈）
        const progressNotification = this.createProgressNotification(prompt);
        store.dispatch(submitNewNotification(progressNotification));

        try {
            // Step 1: 准备图像（取帧）
            this.updateProgress(progressNotification, 1, '准备图像帧');
            const blob = await this.resolveImageBlob(imageData);
            if (!blob || blob.size === 0) {
                store.dispatch(deleteNotificationById(progressNotification.id));
                this.notifyError('Could not obtain image bytes for the active frame');
                return;
            }

            // Step 2: SAM 推理
            this.updateProgress(progressNotification, 2, 'SAM 推理中');
            const results = await SegmentationAPIDetector.predictFromBlob(
                blob,
                imageData.fileData?.name || 'image.jpg',
                prompt
            );

            // Step 3: 写入多边形
            this.updateProgress(progressNotification, 3, `生成 ${results.length} 个多边形`);
            // Dynamic import breaks the AISegmentationActions ↔ EditorActions ↔ RectRenderEngine ↔ this cycle
            const { AISegmentationActions } = await import('./AISegmentationActions');
            AISegmentationActions.applySingleResult(imageData, results, 'smart');

            // 完成，关闭通知
            store.dispatch(deleteNotificationById(progressNotification.id));
        } catch (err) {
            console.error('[SmartAnnotation] inference failed:', err);
            store.dispatch(deleteNotificationById(progressNotification.id));
            this.notifyError((err as Error).message || 'Smart annotation failed');
        }
    }

    private static createProgressNotification(
        prompt: { point?: [number, number]; bbox?: [number, number, number, number] }
    ) {
        const base = NotificationUtil.createInferenceProgressNotification();
        const lang = store.getState().general.language;
        const texts = LanguageConfig[lang];
        const promptLabel = prompt.point
            ? (lang === 'zh' ? `单点 (${Math.round(prompt.point[0])}, ${Math.round(prompt.point[1])})` : `Point (${Math.round(prompt.point[0])}, ${Math.round(prompt.point[1])})`)
            : prompt.bbox
                ? (lang === 'zh' ? `框 ${Math.round(prompt.bbox[2] - prompt.bbox[0])}×${Math.round(prompt.bbox[3] - prompt.bbox[1])}` : `Bbox ${Math.round(prompt.bbox[2] - prompt.bbox[0])}×${Math.round(prompt.bbox[3] - prompt.bbox[1])}`)
            : '';
        return {
            ...base,
            header: lang === 'zh' ? '智能标注（SAM prompt）' : 'Smart Annotation (SAM prompt)',
            stepDescription: lang === 'zh' ? `准备 ${promptLabel}` : `Preparing ${promptLabel}`,
            totalSteps: 3,
            currentStep: 1,
            description: `1/3 · ${promptLabel}`,
        };
    }

    private static updateProgress(notification: any, step: number, stepDesc: string): void {
        store.dispatch(updateNotificationById(notification.id, {
            ...notification,
            currentStep: step,
            stepDescription: stepDesc,
            description: `${step}/3 · ${stepDesc}`,
        }));
    }

    /**
     * Resolve a non-empty Blob for the active frame.
     * - Image-mode projects: return the original imageData.fileData blob
     * - Video-mode projects: extract the current frame from the backend's
     *   FFmpeg session via FrameExtractorService.fetchFrameRange (single frame)
     */
    private static async resolveImageBlob(imageData: ImageData): Promise<Blob | null> {
        const directBlob = imageData.fileData;
        if (directBlob && directBlob.size > 0) {
            return directBlob;
        }
        // Video mode: fall back to FFmpeg session frame extraction
        const videoState = store.getState().video;
        if (!videoState?.isVideoMode) {
            return directBlob ?? null;
        }
        const sessionId = videoState.activeVideo?.sessionId || EditorModel.videoSessionId;
        if (!sessionId) {
            return directBlob ?? null;
        }
        // Find the active image's index in imagesData — that's the frame number
        const frameIdx = LabelsSelector.getActiveImageIndex();
        if (frameIdx === null || frameIdx < 0) {
            return directBlob ?? null;
        }
        try {
            const frames = await FrameExtractorService.fetchFrameRange(sessionId, frameIdx, 1);
            return frames[0] || directBlob || null;
        } catch (err) {
            console.warn('[SmartAnnotation] frame extraction failed:', err);
            return directBlob ?? null;
        }
    }

    private static notifyError(_msg: string): void {
        store.dispatch(submitNewNotification(NotificationUtil.createErrorNotification(
            NotificationsDataMap[Notification.MODEL_INFERENCE_ERROR]
        )));
    }
}
