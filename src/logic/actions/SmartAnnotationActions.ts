import {store} from '../../index';
import {IPoint} from '../../interfaces/IPoint';
import {IRect} from '../../interfaces/IRect';
import {LabelsSelector} from '../../store/selectors/LabelsSelector';
import {SegmentationAPIDetector} from '../../ai/SegmentationAPIDetector';
import {submitNewNotification, deleteNotificationById, updateNotificationById} from '../../store/notifications/actionCreators';
import {NotificationUtil} from '../../utils/NotificationUtil';
import {NotificationsDataMap} from '../../data/info/NotificationsData';
import {Notification} from '../../data/enums/Notification';
import {ImageData, LabelRect} from '../../store/labels/types';
import {EditorModel} from '../../staticModels/EditorModel';
import {FrameExtractorService} from '../../services/FrameExtractorService';
import {LanguageConfig} from '../../data/LanguageConfig';
import {updateImageDataById} from '../../store/labels/actionCreators';
import {v4 as uuidv4} from 'uuid';
import {LabelStatus} from '../../data/enums/LabelStatus';
// NOTE: AISegmentationActions is imported dynamically inside runAllPrompts to avoid
// a circular import cycle: AISegmentationActions → EditorActions → RectRenderEngine
// → SmartAnnotationActions → AISegmentationActions. The cycle would crash module init
// (Cannot access 'ContextManager' before initialization).

/** 点 prompt 在图像空间的默认尺寸（用于存储，渲染时忽略此大小绘制为圆点） */
const POINT_PROMPT_SIZE = 1;

/**
 * Smart annotation interactive actions — stores SAM prompt markers
 * (points / bbox) as native LabelRect entries with `isPrompt: true`.
 * This way prompts inherit all existing label interactions: drag-to-move,
 * eraser-delete, keyboard delete, sidebar visibility, etc.
 *
 * When the user clicks "推理", all prompt rects are collected, sent to
 * SAM for inference, and then removed. The result is appended as regular
 * labelPolygons via AISegmentationActions.applySingleResult(..., 'smart').
 */
export class SmartAnnotationActions {

    // ── helpers ──────────────────────────────────────────────

    /** Get all prompt LabelRects from the active image */
    public static getPromptRects(imageData?: ImageData): LabelRect[] {
        const img = imageData || LabelsSelector.getActiveImageData();
        if (!img) return [];
        return img.labelRects.filter(r => r.isPrompt);
    }

    /** Remove all prompt LabelRects from the given image and dispatch to store */
    public static clearPrompts(imageData?: ImageData): void {
        const img = imageData || LabelsSelector.getActiveImageData();
        if (!img) return;
        const nonPrompt = img.labelRects.filter(r => !r.isPrompt);
        if (nonPrompt.length !== img.labelRects.length) {
            store.dispatch(updateImageDataById(img.id, {
                ...img,
                labelRects: nonPrompt,
            }));
        }
    }

    // ── add prompts ─────────────────────────────────────────

    /**
     * Add a point prompt to the active image as a tiny LabelRect.
     * Rendered as a green (positive) or red (negative) dot by RectRenderEngine.
     */
    public static addPoint(pointOnImage: IPoint, isNegative: boolean = false): void {
        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData) return;
        const promptRect: LabelRect = {
            id: uuidv4(),
            labelId: null,
            isVisible: true,
            rect: {
                x: pointOnImage.x - POINT_PROMPT_SIZE / 2,
                y: pointOnImage.y - POINT_PROMPT_SIZE / 2,
                width: POINT_PROMPT_SIZE,
                height: POINT_PROMPT_SIZE,
            },
            isCreatedByAI: false,
            status: LabelStatus.ACCEPTED,
            suggestedLabel: null,
            isPrompt: true,
            promptLabel: isNegative ? 'negative' : 'positive',
        };
        store.dispatch(updateImageDataById(imageData.id, {
            ...imageData,
            labelRects: [...imageData.labelRects, promptRect],
        }));
    }

    /**
     * Add a bbox prompt to the active image as a LabelRect.
     * Rendered as a blue dashed rect by RectRenderEngine.
     */
    public static addBbox(rectOnImage: IRect): void {
        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData) return;
        const promptRect: LabelRect = {
            id: uuidv4(),
            labelId: null,
            isVisible: true,
            rect: rectOnImage,
            isCreatedByAI: false,
            status: LabelStatus.ACCEPTED,
            suggestedLabel: null,
            isPrompt: true,
        };
        store.dispatch(updateImageDataById(imageData.id, {
            ...imageData,
            labelRects: [...imageData.labelRects, promptRect],
        }));
    }

    /**
     * Remove the last added prompt (undo).
     */
    public static undoLastPrompt(): void {
        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData) return;
        const prompts = imageData.labelRects.filter(r => r.isPrompt);
        if (prompts.length === 0) return;
        const lastId = prompts[prompts.length - 1].id;
        store.dispatch(updateImageDataById(imageData.id, {
            ...imageData,
            labelRects: imageData.labelRects.filter(r => r.id !== lastId),
        }));
    }

    // ── inference ───────────────────────────────────────────

    /**
     * Collect all prompt LabelRects and fire a single SAM inference.
     * Multiple points are sent together so SAM can use both positive
     * and negative points. Bbox is sent as a separate prompt if present.
     */
    public static async runAllPrompts(): Promise<void> {
        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData) {
            this.notifyError('No active image');
            return;
        }

        const prompts = this.getPromptRects(imageData);
        if (prompts.length === 0) return;

        // Build prompt payload
        const points: [number, number][] = [];
        const pointLabels: number[] = [];
        let bbox: [number, number, number, number] | undefined;

        for (const p of prompts) {
            if (p.promptLabel) {
                // Point prompt — center of the tiny rect
                const cx = p.rect.x + p.rect.width / 2;
                const cy = p.rect.y + p.rect.height / 2;
                points.push([cx, cy]);
                pointLabels.push(p.promptLabel === 'negative' ? 0 : 1);
            } else {
                // Bbox prompt — use the last bbox if multiple
                bbox = [p.rect.x, p.rect.y, p.rect.x + p.rect.width, p.rect.y + p.rect.height];
            }
        }

        // 开始推理 → 开启闪烁动画
        (window as any).__openSightPromptInferring = true;

        // Progress notification
        const lang = store.getState().general.language;
        const promptDesc = lang === 'zh'
            ? `${points.length} 个点${bbox ? ' + 框' : ''}`
            : `${points.length} point(s)${bbox ? ' + bbox' : ''}`;
        const progressNotification = this.createProgressNotification(promptDesc);
        store.dispatch(submitNewNotification(progressNotification));

        try {
            // Step 1: prepare image
            this.updateProgress(progressNotification, 1, lang === 'zh' ? '准备图像帧' : 'Preparing image');
            const blob = await this.resolveImageBlob(imageData);
            if (!blob || blob.size === 0) {
                store.dispatch(deleteNotificationById(progressNotification.id));
                this.notifyError('Could not obtain image bytes for the active frame');
                return;
            }

            // Step 2: SAM inference
            const { ActiveModel, formatModelDisplay } = await import('../../ai/ActiveModel');
            const modelDisplay = formatModelDisplay(ActiveModel.getSegmentation());
            this.updateProgress(progressNotification, 2, lang === 'zh' ? `${modelDisplay} 推理中` : `${modelDisplay} inferring`);
            const results = await SegmentationAPIDetector.predictFromBlob(
                blob,
                imageData.fileData?.name || 'image.jpg',
                {
                    points: points.length > 0 ? points : undefined,
                    pointLabels: pointLabels.length > 0 ? pointLabels : undefined,
                    bbox,
                }
            );

            // Step 3: apply results — re-read imageData to get the latest state
            this.updateProgress(progressNotification, 3, `${lang === 'zh' ? '生成' : 'Generated'} ${results.length} ${lang === 'zh' ? '个多边形' : 'polygon(s)'}`);

            // Remove prompt rects first, then apply segmentation results
            const latestImageData = LabelsSelector.getActiveImageData();
            if (latestImageData) {
                store.dispatch(updateImageDataById(latestImageData.id, {
                    ...latestImageData,
                    labelRects: latestImageData.labelRects.filter(r => !r.isPrompt),
                }));
            }

            const { AISegmentationActions } = await import('./AISegmentationActions');
            // Re-read again after clearing prompts
            const finalImageData = LabelsSelector.getActiveImageData();
            AISegmentationActions.applySingleResult(finalImageData || imageData, results, 'smart');

            (window as any).__openSightPromptInferring = false;
            store.dispatch(deleteNotificationById(progressNotification.id));
        } catch (err) {
            console.error('[SmartAnnotation] inference failed:', err);
            (window as any).__openSightPromptInferring = false;
            store.dispatch(deleteNotificationById(progressNotification.id));
            this.notifyError((err as Error).message || 'Smart annotation failed');
        }
    }

    private static createProgressNotification(promptDesc: string) {
        const base = NotificationUtil.createInferenceProgressNotification();
        const lang = store.getState().general.language;
        return {
            ...base,
            header: lang === 'zh' ? '智能标注（SAM prompt）' : 'Smart Annotation (SAM prompt)',
            stepDescription: lang === 'zh' ? `准备 ${promptDesc}` : `Preparing ${promptDesc}`,
            totalSteps: 3,
            currentStep: 1,
            description: `1/3 · ${promptDesc}`,
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
     */
    private static async resolveImageBlob(imageData: ImageData): Promise<Blob | null> {
        const directBlob = imageData.fileData;
        if (directBlob && directBlob.size > 0) {
            return directBlob;
        }
        const videoState = store.getState().video;
        if (!videoState?.isVideoMode) {
            return directBlob ?? null;
        }
        const sessionId = videoState.activeVideo?.sessionId || EditorModel.videoSessionId;
        if (!sessionId) {
            return directBlob ?? null;
        }
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

    private static notifyError(msg: string): void {
        console.error('[SmartAnnotation] error:', msg);
        const base = NotificationsDataMap[Notification.MODEL_INFERENCE_ERROR];
        store.dispatch(submitNewNotification(NotificationUtil.createErrorNotification({
            ...base,
            description: msg || base.description,
        })));
    }
}
