import {IRect} from '../../interfaces/IRect';
import {BaseRenderEngine} from './BaseRenderEngine';
import {EditorData} from '../../data/EditorData';
import {EditorModel} from '../../staticModels/EditorModel';
import {ViewPortActions} from '../actions/ViewPortActions';
import {DrawUtil} from '../../utils/DrawUtil';
import {RenderEngineUtil} from '../../utils/RenderEngineUtil';
import {RenderEngineSettings} from '../../settings/RenderEngineSettings';
import {IPoint} from '../../interfaces/IPoint';
import {GeneralSelector} from '../../store/selectors/GeneralSelector';
import {ProjectType} from '../../data/enums/ProjectType';
import {PopupWindowType} from '../../data/enums/PopupWindowType';

export class PrimaryEditorRenderEngine extends BaseRenderEngine {

    public constructor(canvas: HTMLCanvasElement) {
        super(canvas);
    }

    // =================================================================================================================
    // EVENT HANDLERS
    // =================================================================================================================

    public mouseMoveHandler(data: EditorData): void {}
    public mouseDownHandler(data: EditorData): void {}
    public mouseUpHandler(data: EditorData): void {}

    // =================================================================================================================
    // RENDERING
    // =================================================================================================================

    public render(data: EditorData): void {
        this.drawImage(EditorModel.image, ViewPortActions.calculateViewPortContentImageRect());
        this.renderCrossHair(data);
        this.renderPendingPrompts(data);
    }

    public renderPendingPrompts(data: EditorData): void {
        // Read from window global to avoid Vite HMR module-identity drift — the
        // action producer and the renderer can otherwise load different copies
        // of a module and end up with divergent in-module state.
        const prompts = (window as any).__openSightPendingPrompts as Array<{
            id: string;
            kind: 'point' | 'bbox';
            point?: IPoint;
            bbox?: IRect;
        }> | undefined;
        if (!prompts || prompts.length === 0) return;
        const ctx = this.canvas.getContext('2d');
        if (!ctx) return;
        // Blinking alpha: 800ms period, 0.25–1.0 range
        const phase = (Math.sin(Date.now() / 150) + 1) / 2;
        const alpha = 0.25 + 0.75 * phase;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#ffffff';
        ctx.fillStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);

        for (const p of prompts) {
            if (p.kind === 'point' && p.point) {
                const vp = RenderEngineUtil.transferPointFromImageToViewPortContent(p.point, data);
                // Solid inner dot
                ctx.beginPath();
                ctx.arc(vp.x, vp.y, 5, 0, Math.PI * 2);
                ctx.fill();
                // Outer ring
                ctx.beginPath();
                ctx.arc(vp.x, vp.y, 11, 0, Math.PI * 2);
                ctx.stroke();
            } else if (p.kind === 'bbox' && p.bbox) {
                const tl = RenderEngineUtil.transferPointFromImageToViewPortContent(
                    {x: p.bbox.x, y: p.bbox.y},
                    data,
                );
                const br = RenderEngineUtil.transferPointFromImageToViewPortContent(
                    {x: p.bbox.x + p.bbox.width, y: p.bbox.y + p.bbox.height},
                    data,
                );
                const w = br.x - tl.x;
                const h = br.y - tl.y;
                // 半透明填充 + 描边，都随 alpha 一起闪烁
                ctx.globalAlpha = alpha * 0.3;
                ctx.fillRect(tl.x, tl.y, w, h);
                ctx.globalAlpha = alpha;
                ctx.strokeRect(tl.x, tl.y, w, h);
            }
        }
        ctx.restore();
    }

    public renderCrossHair(data: EditorData): void {
        if (!this.shouldRenderCrossHair(data)) return;

        const mouse = RenderEngineUtil.setPointBetweenPixels(data.mousePositionOnViewPortContent);
        const drawLine = (startPoint: IPoint, endPoint: IPoint) => {
            DrawUtil.drawLine(this.canvas, startPoint, endPoint, RenderEngineSettings.CROSS_HAIR_LINE_COLOR, 2)
        }
        drawLine(
            {x: mouse.x, y: 0},
            {x: mouse.x - 1, y: mouse.y - RenderEngineSettings.crossHairPadding}
        )
        drawLine(
            {x: mouse.x, y: mouse.y + RenderEngineSettings.crossHairPadding},
            {x: mouse.x - 1, y: data.viewPortContentSize.height}
        )
        drawLine(
            {x: 0, y: mouse.y},
            {x: mouse.x - RenderEngineSettings.crossHairPadding, y: mouse.y - 1}
        )
        drawLine(
            {x: mouse.x + RenderEngineSettings.crossHairPadding, y: mouse.y},
            {x: data.viewPortContentSize.width, y: mouse.y - 1}
        )
    }

    public shouldRenderCrossHair(data: EditorData): boolean {
        // Crosshair renders whenever smart annotation mode is active — it doubles
        // as the visual targeting reticle for SAM point/bbox prompts.
        const isSmartAnnotationActive = GeneralSelector.getSmartAnnotationActiveStatus();
        const isImageInDragMode = GeneralSelector.getImageDragModeStatus();
        const projectType: ProjectType = GeneralSelector.getProjectType();
        const activePopupType: PopupWindowType = GeneralSelector.getActivePopupType();
        const isMouseOverCanvas: boolean = RenderEngineUtil.isMouseOverCanvas(data);
        const isCustomCursorBlocked =  GeneralSelector.getPreventCustomCursorStatus();

        return [
            !!this.canvas,
            isSmartAnnotationActive,
            !isImageInDragMode,
            projectType !== ProjectType.IMAGE_RECOGNITION,
            !activePopupType,
            isMouseOverCanvas,
            !isCustomCursorBlocked
        ].every(Boolean)
    }

    public drawImage(image: HTMLImageElement, imageRect: IRect) {
        if (!!image && !!this.canvas) {
            const ctx = this.canvas.getContext('2d');
            ctx.drawImage(image, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
        }
    }

    isInProgress(): boolean {
        return false;
    }
}
