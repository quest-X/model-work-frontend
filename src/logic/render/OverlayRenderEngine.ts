import {EditorData} from '../../data/EditorData';
import {BaseRenderEngine} from './BaseRenderEngine';
import {LabelType} from '../../data/enums/LabelType';
import {LabelsSelector} from '../../store/selectors/LabelsSelector';
import {EditorModel} from '../../staticModels/EditorModel';
import {ImageData, LabelPolygon} from '../../store/labels/types';
import {RenderEngineUtil} from '../../utils/RenderEngineUtil';
import {DrawUtil} from '../../utils/DrawUtil';
import {IPoint} from '../../interfaces/IPoint';

type OverlayCommand = Partial<{
    type: string; color: string; width: number; dashed: boolean; label: string;
    x: number; y: number; x1: number; y1: number; x2: number; y2: number;
    dx: number; dy: number; scale: number; points: unknown[]; r: number;
    w: number; h: number; fill: boolean; text: string; size: number;
    anchor: string; bold: boolean;
}>;

/**
 * 通用自定义后处理 overlay 渲染器。
 *
 * 后端自定义脚本（postprocess hook）通过 detection 的 `extra.overlays` 字段
 * 传一个绘图指令数组，由本引擎在 canvas 上画出来。坐标始终是 image-space
 * （原图像素），引擎自动变换到 viewport。
 *
 * 支持的指令类型：
 *   - hline:   水平线   {type, y, color, width?, dashed?, label?}
 *   - vline:   垂直线   {type, x, color, width?, dashed?, label?}
 *   - line:    任意线   {type, x1, y1, x2, y2, color, width?, dashed?}
 *   - arrow:   单箭头   {type, x, y, dx, dy, color, scale?, width?}
 *   - arrows:  批量箭头  {type, points: [[x,y,dx,dy], ...], color, scale?, width?}
 *   - point:   圆点     {type, x, y, r, color}
 *   - rect:    矩形     {type, x, y, w, h, color, width?, fill?}
 *   - text:    文字     {type, x, y, text, color, size?, anchor?: 'left'|'center'|'right', bold?}
 *
 * 所有 type 之外的字段都是 optional；scale 默认 1，width 默认 1.5，anchor 默认 'left'。
 */
export class OverlayRenderEngine extends BaseRenderEngine {
    public constructor(canvas: HTMLCanvasElement) {
        super(canvas);
        this.labelType = LabelType.POLYGON;
    }

    protected mouseDownHandler(): void { /* Passive overlays do not edit labels. */ }
    protected mouseMoveHandler(): void { /* Passive overlays do not edit labels. */ }
    protected mouseUpHandler(): void { /* Passive overlays do not edit labels. */ }
    public isInProgress(): boolean { return false; }

    public render(data: EditorData): void {
        const imageData: ImageData = EditorModel.playbackImageData || LabelsSelector.getActiveImageData();
        if (!imageData) return;

        imageData.labelPolygons.forEach((p: LabelPolygon) => {
            if (!p.isVisible) return;
            const overlays = p.extra?.overlays;
            if (!Array.isArray(overlays) || overlays.length === 0) return;
            for (const o of overlays) {
                try { this.drawOne(o, data); }
                catch (e) { /* 单个指令失败不影响其他 */ }
            }
        });
    }

    // ── private ──────────────────────────────────────────────────────────

    private toView(pt: IPoint, data: EditorData): IPoint {
        return RenderEngineUtil.transferPointFromImageToViewPortContent(pt, data);
    }

    private drawOne(o: OverlayCommand, data: EditorData): void {
        if (!o || typeof o.type !== 'string') return;
        const color = typeof o.color === 'string' ? o.color : '#00d96a';
        const width = typeof o.width === 'number' ? o.width : 1.5;
        switch (o.type) {
            case 'hline':
                return this.drawHorizontal(o, data, color, width);
            case 'vline':
                return this.drawVertical(o, data, color, width);
            case 'line':
                return this.drawSegment(o, data, color, width);
            case 'arrow': {
                this.drawArrow(o.x, o.y, o.dx, o.dy, o.scale ?? 1, color, width, data);
                break;
            }
            case 'arrows':
                return this.drawArrows(o, data, color, width);
            case 'point':
                return this.drawPoint(o, data, color);
            case 'rect':
                return this.drawRectangle(o, data, color, width);
            case 'text':
                return this.drawText(o, data, color);
            default:
                return;
        }
    }

    private drawOverlayLine(o: OverlayCommand, color: string, width: number, a: IPoint, b: IPoint): void {
        if (o.dashed) DrawUtil.drawDashedLine(this.canvas, a, b, color, width);
        else DrawUtil.drawLine(this.canvas, a, b, color, width);
    }

    private drawHorizontal(o: OverlayCommand, data: EditorData, color: string, width: number): void {
        const imgW = data.realImageSize?.width ?? 0;
        const y = Number(o.y);
        if (!Number.isFinite(y) || imgW <= 0) return;
        const a = this.toView({x: 0, y}, data);
        const b = this.toView({x: imgW, y}, data);
        this.drawOverlayLine(o, color, width, a, b);
        if (o.label) this.drawLabelText(o.label, color, this.toView({x: 8, y: y - 4}, data));
    }

    private drawVertical(o: OverlayCommand, data: EditorData, color: string, width: number): void {
        const x = Number(o.x);
        const imgH = data.realImageSize?.height ?? 0;
        if (!Number.isFinite(x) || imgH <= 0) return;
        this.drawOverlayLine(o, color, width, this.toView({x, y: 0}, data), this.toView({x, y: imgH}, data));
        if (o.label) this.drawLabelText(o.label, color, this.toView({x: x + 4, y: 16}, data));
    }

    private drawSegment(o: OverlayCommand, data: EditorData, color: string, width: number): void {
        const x1 = Number(o.x1), y1 = Number(o.y1), x2 = Number(o.x2), y2 = Number(o.y2);
        if (![x1, y1, x2, y2].every(Number.isFinite)) return;
        this.drawOverlayLine(o, color, width, this.toView({x: x1, y: y1}, data), this.toView({x: x2, y: y2}, data));
    }

    private drawArrows(o: OverlayCommand, data: EditorData, color: string, width: number): void {
        if (!Array.isArray(o.points)) return;
        const scale = typeof o.scale === 'number' ? o.scale : 1;
        for (const p of o.points) {
            if (!Array.isArray(p) || p.length < 4) continue;
            // 第 5 项可选 per-arrow color (例如按光流幅度调色)
            const arrowColor = (p.length >= 5 && typeof p[4] === 'string') ? p[4] : color;
            this.drawArrow(p[0], p[1], p[2], p[3], scale, arrowColor, width, data);
        }
    }

    private drawPoint(o: OverlayCommand, data: EditorData, color: string): void {
        const x = Number(o.x), y = Number(o.y);
        const r = Math.max(1, Number(o.r) || 3);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        DrawUtil.drawCircleWithFill(this.canvas, this.toView({x, y}, data), r, color);
    }

    private drawRectangle(o: OverlayCommand, data: EditorData, color: string, width: number): void {
        const x = Number(o.x), y = Number(o.y), w = Number(o.w), h = Number(o.h);
        if (![x, y, w, h].every(Number.isFinite)) return;
        const tl = this.toView({x, y}, data);
        const br = this.toView({x: x + w, y: y + h}, data);
        const r = {x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y};
        if (o.fill) DrawUtil.drawRectWithFill(this.canvas, r, color);
        else DrawUtil.drawRect(this.canvas, r, color, width);
    }

    private drawText(o: OverlayCommand, data: EditorData, color: string): void {
        const x = Number(o.x), y = Number(o.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || typeof o.text !== 'string') return;
        const size = typeof o.size === 'number' ? o.size : 14;
        const anchor = o.anchor === 'center' || o.anchor === 'right' ? o.anchor : 'left';
        DrawUtil.drawText(this.canvas, o.text, size, this.toView({x, y}, data), color, !!o.bold, anchor);
    }

    private drawArrow(
        x: number, y: number, dx: number, dy: number,
        scale: number, color: string, width: number, data: EditorData,
    ): void {
        if (![x, y, dx, dy].every(Number.isFinite)) return;
        const startImg: IPoint = {x, y};
        const endImg: IPoint = {x: x + dx * scale, y: y + dy * scale};
        const a = this.toView(startImg, data);
        const b = this.toView(endImg, data);
        DrawUtil.drawLine(this.canvas, a, b, color, width);

        // 箭头头部三角（在 viewport 坐标下计算）
        const vx = b.x - a.x, vy = b.y - a.y;
        const len = Math.hypot(vx, vy);
        if (len < 2) return;
        const head = Math.min(8, len * 0.4);
        const ux = vx / len, uy = vy / len;
        // 左右两侧偏角 ~25°
        const cos = Math.cos(0.43), sin = Math.sin(0.43);
        const p1: IPoint = {x: b.x - head * (ux * cos + uy * sin), y: b.y - head * (-ux * sin + uy * cos)};
        const p2: IPoint = {x: b.x - head * (ux * cos - uy * sin), y: b.y - head * (ux * sin + uy * cos)};
        DrawUtil.drawLine(this.canvas, b, p1, color, width);
        DrawUtil.drawLine(this.canvas, b, p2, color, width);
    }

    private drawLabelText(text: string, color: string, pos: IPoint): void {
        DrawUtil.drawText(this.canvas, text, 11, pos, color, false, 'left');
    }
}
