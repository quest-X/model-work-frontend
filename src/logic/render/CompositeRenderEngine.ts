import {BaseRenderEngine} from './BaseRenderEngine';
import {LabelType} from '../../data/enums/LabelType';
import {EditorData} from '../../data/EditorData';
import {IPoint} from '../../interfaces/IPoint';
import {RenderEngineUtil} from '../../utils/RenderEngineUtil';
import {RectUtil} from '../../utils/RectUtil';
import {DrawUtil} from '../../utils/DrawUtil';
import {Settings} from '../../settings/Settings';
import {RenderEngineSettings} from '../../settings/RenderEngineSettings';
import {store} from '../../index';
import {ImageData} from '../../store/labels/types';
import {updateImageDataById, updateActiveLabelId, updateFirstLabelCreatedFlag} from '../../store/labels/actionCreators';
import {LabelsSelector} from '../../store/selectors/LabelsSelector';
import {LabelUtil} from '../../utils/LabelUtil';
import {LineUtil} from '../../utils/LineUtil';
import {updateCustomCursorStyle} from '../../store/general/actionCreators';
import {CustomCursorStyle} from '../../data/enums/CustomCursorStyle';
import {RectRenderEngine} from './RectRenderEngine';
import {PointRenderEngine} from './PointRenderEngine';
import {LineRenderEngine} from './LineRenderEngine';
import {PolygonRenderEngine} from './PolygonRenderEngine';

export class CompositeRenderEngine extends BaseRenderEngine {
    private pathVerticesOnCanvas: IPoint[] = [];
    private isClosed: boolean = false;
    private rectEngine: RectRenderEngine;
    private pointEngine: PointRenderEngine;
    private lineEngine: LineRenderEngine;
    private polygonEngine: PolygonRenderEngine;

    public constructor(canvas: HTMLCanvasElement) {
        super(canvas);
        this.labelType = LabelType.LINE;
        this.rectEngine = new RectRenderEngine(canvas);
        this.pointEngine = new PointRenderEngine(canvas);
        this.lineEngine = new LineRenderEngine(canvas);
        this.polygonEngine = new PolygonRenderEngine(canvas);
    }

    public update(data: EditorData): void {
        // 在复合路径创建进行中时，只处理自己的事件，不让子引擎抢占交互
        if (this.isInProgress()) {
            super.update(data);
            return;
        }

        // 检查点引擎是否在操作中（拖动点）
        if (this.pointEngine.isInProgress()) {
            this.pointEngine.update(data);
            return;
        }

        // 检查鼠标是否悬停在点标注上
        // 如果是，优先让点引擎处理（因为点最小，容易被遮挡）
        const isOverPoint = this.isMouseOverPoint(data);
        if (isOverPoint) {
            this.pointEngine.update(data);
            if (this.pointEngine.isInProgress()) return;
        }

        // 其他情况按原来的逻辑：先调用自己创建复合路径，然后让子引擎编辑已有标注
        super.update(data);

        // 在非复合创建进行中时，允许编辑已有标签（按优先级短路）
        if (!this.isInProgress()) {
            this.rectEngine.update(data);
            if (!this.rectEngine.isInProgress()) {
                this.polygonEngine.update(data);
            }
            if (!this.rectEngine.isInProgress() && !this.polygonEngine.isInProgress()) {
                // pointEngine 已在前面处理过
                this.lineEngine.update(data);
            }
        }
    }

    // 检查鼠标是否在点标注上
    private isMouseOverPoint(data: EditorData): boolean {
        if (!data.mousePositionOnViewPortContent) return false;

        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData) return false;

        for (const point of imageData.labelPoints || []) {
            if (!point.isVisible) continue;
            const pointOnCanvas = RenderEngineUtil.transferPointFromImageToViewPortContent(point.point, data);
            const pointBetweenPixels = RenderEngineUtil.setPointBetweenPixels(pointOnCanvas);
            const distance = Math.hypot(
                data.mousePositionOnViewPortContent.x - pointBetweenPixels.x,
                data.mousePositionOnViewPortContent.y - pointBetweenPixels.y
            );
            if (distance < Settings.RESIZE_HANDLE_HOVER_DIMENSION_PX / 2) {
                return true;
            }
        }

        return false;
    }

    protected mouseDownHandler(data: EditorData): void {
        const event = data.event as MouseEvent;
        if (!event || event.button !== 0) return;
        const isMouseOverCanvas = RenderEngineUtil.isMouseOverCanvas(data);
        const isMouseOverImage = RenderEngineUtil.isMouseOverImage(data);
        if (!isMouseOverCanvas || !isMouseOverImage) return;

        const snappedPoint = RectUtil.snapPointToRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
        const imageData: ImageData = LabelsSelector.getActiveImageData();
        if (!imageData) return;

        if (this.pathVerticesOnCanvas.length === 0) {
            this.pathVerticesOnCanvas.push(snappedPoint);
        } else {
            const first = this.pathVerticesOnCanvas[0];
            const last = this.pathVerticesOnCanvas[this.pathVerticesOnCanvas.length - 1];
            const distanceToFirst = Math.hypot(snappedPoint.x - first.x, snappedPoint.y - first.y);
            const isClosing = distanceToFirst < 10 && this.pathVerticesOnCanvas.length >= 3;

            if (isClosing) {
                this.isClosed = true;
                this.finalizeCommit(data);
            } else {
                const originalLine = { start: last, end: snappedPoint };
                const snapResult = LineUtil.snapLineToAxis(originalLine);
                this.pathVerticesOnCanvas.push(snapResult.snappedLine.end);
            }
        }
    }

    protected mouseMoveHandler(data: EditorData): void {
        // 仅用于预览当前段
        if (this.pathVerticesOnCanvas.length >= 1 && !!data.mousePositionOnViewPortContent) {
            const last = this.pathVerticesOnCanvas[this.pathVerticesOnCanvas.length - 1];
            const first = this.pathVerticesOnCanvas[0];
            const snappedPoint = RectUtil.snapPointToRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
            const originalLine = { start: last, end: snappedPoint };
            const snapResult = LineUtil.snapLineToAxis(originalLine);
            const distanceToFirst = Math.hypot(snappedPoint.x - first.x, snappedPoint.y - first.y);
            const isClosingPreview = distanceToFirst < 10 && this.pathVerticesOnCanvas.length >= 2;

            // 绘制透明多边形填充（当有2个或更多顶点且鼠标位置形成第3个点时）
            if (this.pathVerticesOnCanvas.length >= 2) {
                const previewPath = [...this.pathVerticesOnCanvas, snapResult.snappedLine.end];
                const color = RenderEngineSettings.DEFAULT_LINE_COLOR;
                DrawUtil.drawPolygonWithFill(this.canvas, previewPath, DrawUtil.hexToRGB(color, 0.2));
            }

            if (isClosingPreview) {
                DrawUtil.drawLine(this.canvas, last, first, RenderEngineSettings.DEFAULT_LINE_COLOR, Settings.RESIZE_HANDLE_DIMENSION_PX > 0 ? 2 : 1);
                DrawUtil.drawCircleWithFill(this.canvas, first, Settings.RESIZE_HANDLE_HOVER_DIMENSION_PX/2, RenderEngineSettings.DEFAULT_ANCHOR_COLOR);
                store.dispatch(updateCustomCursorStyle(CustomCursorStyle.CLOSE));
            } else {
                DrawUtil.drawLine(this.canvas, snapResult.snappedLine.start, snapResult.snappedLine.end, RenderEngineSettings.DEFAULT_LINE_COLOR, Settings.RESIZE_HANDLE_DIMENSION_PX > 0 ? 2 : 1);
                store.dispatch(updateCustomCursorStyle(CustomCursorStyle.DEFAULT));
                const standardizedLine = { start: snapResult.snappedLine.start, end: snapResult.snappedLine.end };
                const length = LineUtil.getPixelLength(standardizedLine as any);
                if (length >= 10) {
                    const lengthText = LineUtil.formatLengthText(length);
                    const labelPosition = LineUtil.getLengthLabelPosition(standardizedLine as any, 20);
                    const ctx = this.canvas.getContext('2d');
                    ctx.font = '12px Arial';
                    const textWidth = ctx.measureText(lengthText).width;
                    const padding = 4;
                    DrawUtil.drawRectWithFill(this.canvas, {
                        x: labelPosition.x - textWidth/2 - padding,
                        y: labelPosition.y - 8 - padding,
                        width: textWidth + 2 * padding,
                        height: 16 + 2 * padding
                    }, 'rgba(0, 0, 0, 0.7)');
                    DrawUtil.drawText(this.canvas, lengthText, 12, labelPosition, RenderEngineSettings.DEFAULT_LINE_COLOR, false, 'center');
                }
            }
            DrawUtil.drawCircleWithFill(this.canvas, last, Settings.RESIZE_HANDLE_DIMENSION_PX/2, RenderEngineSettings.DEFAULT_ANCHOR_COLOR);
        }
    }

    protected mouseUpHandler(data: EditorData): void {}

    public render(data: EditorData): void {
        if (!data.viewPortContentImageRect || !data.realImageSize) {
            return; // 图像还没有加载完成，跳过渲染
        }
        
        this.rectEngine.render(data);
        this.polygonEngine.render(data);
        this.pointEngine.render(data);
        this.lineEngine.render(data);
        const color = RenderEngineSettings.DEFAULT_LINE_COLOR;
        const anchorColor = RenderEngineSettings.DEFAULT_ANCHOR_COLOR;
        
        // 绘制已经确定的多边形填充（如果有至少3个顶点）
        if (this.pathVerticesOnCanvas.length >= 3) {
            DrawUtil.drawPolygonWithFill(this.canvas, this.pathVerticesOnCanvas, DrawUtil.hexToRGB(color, 0.2));
        }
        
        if (this.pathVerticesOnCanvas.length >= 1) {
            DrawUtil.drawCircleWithFill(this.canvas, this.pathVerticesOnCanvas[0], Settings.RESIZE_HANDLE_DIMENSION_PX/2, anchorColor);
        }
        for (let i = 1; i < this.pathVerticesOnCanvas.length; i++) {
            const a = this.pathVerticesOnCanvas[i - 1];
            const b = this.pathVerticesOnCanvas[i];
            DrawUtil.drawLine(this.canvas, a, b, color, Settings.RESIZE_HANDLE_DIMENSION_PX > 0 ? 2 : 1);
            DrawUtil.drawCircleWithFill(this.canvas, b, Settings.RESIZE_HANDLE_DIMENSION_PX/2, anchorColor);
            const standardizedLine = { start: a, end: b } as any;
            const length = LineUtil.getPixelLength(standardizedLine);
            if (length >= 10) {
                const lengthText = LineUtil.formatLengthText(length);
                const labelPosition = LineUtil.getLengthLabelPosition(standardizedLine, 20);
                const ctx = this.canvas.getContext('2d');
                ctx.font = '12px Arial';
                const textWidth = ctx.measureText(lengthText).width;
                const padding = 4;
                DrawUtil.drawRectWithFill(this.canvas, {
                    x: labelPosition.x - textWidth/2 - padding,
                    y: labelPosition.y - 8 - padding,
                    width: textWidth + 2 * padding,
                    height: 16 + 2 * padding
                }, 'rgba(0, 0, 0, 0.7)');
                DrawUtil.drawText(this.canvas, lengthText, 12, labelPosition, color, false, 'center');
            }
        }
        if (this.pathVerticesOnCanvas.length === 1) {
            const p = this.pathVerticesOnCanvas[0];
            const label = `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
            const pos = { x: p.x + 12, y: p.y - 12 };
            const ctx = this.canvas.getContext('2d');
            ctx.font = '12px Arial';
            const textWidth = ctx.measureText(label).width;
            const padding = 4;
            DrawUtil.drawRectWithFill(this.canvas, {
                x: pos.x - textWidth/2 - padding,
                y: pos.y - 8 - padding,
                width: textWidth + 2 * padding,
                height: 16 + 2 * padding
            }, 'rgba(0, 0, 0, 0.7)');
            DrawUtil.drawText(this.canvas, label, 12, pos, color, false, 'center');
        }
        if (this.isClosed && this.pathVerticesOnCanvas.length >= 3) {
            const pts = this.pathVerticesOnCanvas;
            let area = 0;
            for (let i = 0; i < pts.length; i++) {
                const j = (i + 1) % pts.length;
                area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
            }
            area = Math.abs(area) / 2;
            const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
            const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
            const label = `${area.toFixed(1)}px²`;
            const pos = { x: cx, y: cy };
            const ctx = this.canvas.getContext('2d');
            ctx.font = '12px Arial';
            const textWidth = ctx.measureText(label).width;
            const padding = 4;
            DrawUtil.drawRectWithFill(this.canvas, {
                x: pos.x - textWidth/2 - padding,
                y: pos.y - 8 - padding,
                width: textWidth + 2 * padding,
                height: 16 + 2 * padding
            }, 'rgba(0, 0, 0, 0.7)');
            DrawUtil.drawText(this.canvas, label, 12, pos, color, false, 'center');
        }
        this.mouseMoveHandler(data);
    }

    public finalizeCommit(data: EditorData): void {
        const imageData: ImageData = LabelsSelector.getActiveImageData();
        if (!imageData) return;
        const activeLabelNameId = LabelsSelector.getActiveLabelNameId() ?? null;

        if (this.isClosed && this.pathVerticesOnCanvas.length >= 3) {
            if (!imageData.labelPolygons) return;
            const polygonOnImage = RenderEngineUtil.transferPolygonFromViewPortContentToImage(this.pathVerticesOnCanvas, data);
            const labelPolygon = LabelUtil.createLabelPolygon(activeLabelNameId as any, polygonOnImage);
            imageData.labelPolygons.push(labelPolygon);
            store.dispatch(updateImageDataById(imageData.id, imageData));
            store.dispatch(updateActiveLabelId(labelPolygon.id));
            store.dispatch(updateFirstLabelCreatedFlag(true));
        } else if (this.pathVerticesOnCanvas.length === 2) {
            if (!imageData.labelLines) return;
            const lineVP = { start: this.pathVerticesOnCanvas[0], end: this.pathVerticesOnCanvas[1] };
            const lineOnImage = RenderEngineUtil.transferLineFromViewPortContentToImage(lineVP as any, data);
            const labelLine = LabelUtil.createLabelLine(activeLabelNameId as any, lineOnImage);
            imageData.labelLines.push(labelLine);
            store.dispatch(updateImageDataById(imageData.id, imageData));
            store.dispatch(updateActiveLabelId(labelLine.id));
            store.dispatch(updateFirstLabelCreatedFlag(true));
        } else if (this.pathVerticesOnCanvas.length === 1) {
            if (!imageData.labelPoints) return;
            const pointOnImage = RenderEngineUtil.transferPointFromViewPortContentToImage(this.pathVerticesOnCanvas[0], data);
            const labelPoint = LabelUtil.createLabelPoint(activeLabelNameId as any, pointOnImage);
            imageData.labelPoints.push(labelPoint);
            store.dispatch(updateImageDataById(imageData.id, imageData));
            store.dispatch(updateActiveLabelId(labelPoint.id));
            store.dispatch(updateFirstLabelCreatedFlag(true));
        }

        this.pathVerticesOnCanvas = [];
        this.isClosed = false;
    }

    public isInProgress(): boolean {
        return this.pathVerticesOnCanvas.length > 0;
    }
}
