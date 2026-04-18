import {store} from '../../index';
import {RectUtil} from '../../utils/RectUtil';
import {updateCustomCursorStyle} from '../../store/general/actionCreators';
import {CustomCursorStyle} from '../../data/enums/CustomCursorStyle';
import {EditorData} from '../../data/EditorData';
import {BaseRenderEngine} from './BaseRenderEngine';
import {RenderEngineSettings} from '../../settings/RenderEngineSettings';
import {IPoint} from '../../interfaces/IPoint';
import {ILine} from '../../interfaces/ILine';
import {DrawUtil} from '../../utils/DrawUtil';
import {IRect} from '../../interfaces/IRect';
import {ImageData, LabelPolygon} from '../../store/labels/types';
import {LabelsSelector} from '../../store/selectors/LabelsSelector';
import {
    updateActiveLabelId,
    updateFirstLabelCreatedFlag,
    updateHighlightedLabelId,
    updateImageDataById
} from '../../store/labels/actionCreators';
import {LineUtil} from '../../utils/LineUtil';
import {MouseEventUtil} from '../../utils/MouseEventUtil';
import {EventType} from '../../data/enums/EventType';
import {RenderEngineUtil} from '../../utils/RenderEngineUtil';
import {LabelType} from '../../data/enums/LabelType';
import {EditorActions} from '../actions/EditorActions';
import {GeneralSelector} from '../../store/selectors/GeneralSelector';
import {Settings} from '../../settings/Settings';
import {LabelUtil} from '../../utils/LabelUtil';
import {PolygonUtil} from '../../utils/PolygonUtil';
import {EditorModel} from '../../staticModels/EditorModel';
import {LabelActions} from '../actions/LabelActions';

export class PolygonRenderEngine extends BaseRenderEngine {

    // =================================================================================================================
    // STATE
    // =================================================================================================================

    private activePath: IPoint[] = [];
    private resizeAnchorIndex: number = null;
    private suggestedAnchorPositionOnCanvas: IPoint = null;
    private suggestedAnchorIndexInPolygon: number = null;

    public constructor(canvas: HTMLCanvasElement) {
        super(canvas);
        this.labelType = LabelType.POLYGON;
    }

    // =================================================================================================================
    // EVENT HANDLERS
    // =================================================================================================================

    public update(data: EditorData): void {
        if (!!data.event) {
            switch (MouseEventUtil.getEventType(data.event)) {
                case EventType.MOUSE_MOVE:
                    this.mouseMoveHandler(data);
                    break;
                case EventType.MOUSE_UP:
                    this.mouseUpHandler(data);
                    break;
                case EventType.MOUSE_DOWN:
                    this.mouseDownHandler(data);
                    break;
                default:
                    break;
            }
        }
    }

    public mouseDownHandler(data: EditorData): void {
        const isMouseOverCanvas: boolean = RenderEngineUtil.isMouseOverCanvas(data);
        if (isMouseOverCanvas) {
            if (this.isCreationInProgress()) {
                const isMouseOverStartAnchor: boolean = this.isMouseOverAnchor(
                    data.mousePositionOnViewPortContent, this.activePath[0]);
                if (isMouseOverStartAnchor) {
                    this.addLabelAndFinishCreation(data);
                } else  {
                    this.updateActivelyCreatedLabel(data);
                }
            } else {
                const polygonUnderMouse: LabelPolygon = this.getPolygonUnderMouse(data);
                if (!!polygonUnderMouse) {
                    const anchorIndex: number = polygonUnderMouse.vertices.reduce(
                        (indexUnderMouse: number, anchor: IPoint, index: number) => {
                        if (indexUnderMouse === null) {
                            const anchorOnCanvas: IPoint = RenderEngineUtil.transferPointFromImageToViewPortContent(anchor, data);
                            if (this.isMouseOverAnchor(data.mousePositionOnViewPortContent, anchorOnCanvas)) {
                                return index;
                            }
                        }
                        return indexUnderMouse;
                    }, null);

                    if (anchorIndex !== null) {
                        this.startExistingLabelResize(data, polygonUnderMouse.id, anchorIndex);
                    } else {
                        store.dispatch(updateActiveLabelId(polygonUnderMouse.id));
                        const isMouseOverNewAnchor: boolean = this.isMouseOverAnchor(data.mousePositionOnViewPortContent, this.suggestedAnchorPositionOnCanvas);
                        if (isMouseOverNewAnchor) {
                            this.addSuggestedAnchorToPolygonLabel(data);
                        }
                    }
                } else {
                    this.updateActivelyCreatedLabel(data);
                }
            }
        }
    }

    public mouseUpHandler(data: EditorData): void {
        if (this.isResizeInProgress())
            this.endExistingLabelResize(data);
    }

    public mouseMoveHandler(data: EditorData): void {
        if (!!data.viewPortContentImageRect && !!data.mousePositionOnViewPortContent) {
            const isOverImage: boolean = RenderEngineUtil.isMouseOverImage(data);
            if (isOverImage && !this.isCreationInProgress()) {
                const labelPolygon: LabelPolygon = this.getPolygonUnderMouse(data);
                if (!!labelPolygon && !this.isResizeInProgress()) {
                    if (LabelsSelector.getHighlightedLabelId() !== labelPolygon.id) {
                        store.dispatch(updateHighlightedLabelId(labelPolygon.id))
                    }
                    const pathOnCanvas: IPoint[] = RenderEngineUtil.transferPolygonFromImageToViewPortContent(labelPolygon.vertices, data);
                    const linesOnCanvas: ILine[] = PolygonUtil.getEdges(pathOnCanvas);

                    for (let j = 0; j < linesOnCanvas.length; j++) {
                        const mouseOverLine = RenderEngineUtil.isMouseOverLine(
                            data.mousePositionOnViewPortContent,
                            linesOnCanvas[j],
                            RenderEngineSettings.anchorHoverSize.width / 2
                        )
                        if (mouseOverLine) {
                            this.suggestedAnchorPositionOnCanvas = LineUtil.getCenter(linesOnCanvas[j]);
                            this.suggestedAnchorIndexInPolygon = j + 1;
                            break;
                        }
                    }
                } else {
                    if (LabelsSelector.getHighlightedLabelId() !== null) {
                        store.dispatch(updateHighlightedLabelId(null));
                        this.discardSuggestedPoint();
                    }
                }
            }
        }
    }

    // =================================================================================================================
    // RENDERING
    // =================================================================================================================

    public render(data: EditorData): void {
        const imageData: ImageData = EditorModel.playbackImageData || LabelsSelector.getActiveImageData();
        if (imageData) {
            this.drawExistingLabels(data);
            this.drawActivelyCreatedLabel(data);
            this.drawActivelyResizeLabel(data);
            this.updateCursorStyle(data);
            this.drawSuggestedAnchor(data);
        }
    }

    private updateCursorStyle(data: EditorData) {
        if (!!this.canvas && !!data.mousePositionOnViewPortContent && !GeneralSelector.getImageDragModeStatus()) {
            const isMouseOverCanvas: boolean = RenderEngineUtil.isMouseOverCanvas(data);
            if (isMouseOverCanvas) {
                if (this.isCreationInProgress()) {
                    const isMouseOverStartAnchor: boolean = this.isMouseOverAnchor(data.mousePositionOnViewPortContent, this.activePath[0]);
                    if (isMouseOverStartAnchor && this.activePath.length > 2)
                        store.dispatch(updateCustomCursorStyle(CustomCursorStyle.CLOSE));
                    else
                        store.dispatch(updateCustomCursorStyle(CustomCursorStyle.DEFAULT));
                } else {
                    const anchorUnderMouse: IPoint = this.getAnchorUnderMouse(data);
                    const isMouseOverNewAnchor: boolean = this.isMouseOverAnchor(data.mousePositionOnViewPortContent, this.suggestedAnchorPositionOnCanvas);
                    if (!!isMouseOverNewAnchor) {
                        store.dispatch(updateCustomCursorStyle(CustomCursorStyle.ADD));
                    } else if (this.isResizeInProgress()) {
                        store.dispatch(updateCustomCursorStyle(CustomCursorStyle.MOVE));
                    } else if (!!anchorUnderMouse) {
                        store.dispatch(updateCustomCursorStyle(CustomCursorStyle.MOVE));
                    } else {
                        RenderEngineUtil.wrapDefaultCursorStyleInCancel(data);
                    }
                }
                this.canvas.style.cursor = 'none';
            } else {
                this.canvas.style.cursor = 'default';
            }
        }
    }

    private drawActivelyCreatedLabel(data: EditorData) {
        const standardizedPoints: IPoint[] = this.activePath.map((point: IPoint) => RenderEngineUtil.setPointBetweenPixels(point));
        const path = standardizedPoints.concat(data.mousePositionOnViewPortContent);
        const lines: ILine[] = PolygonUtil.getEdges(path, false);
        const lineColor: string = BaseRenderEngine.resolveLabelLineColor(null, true)
        const anchorColor: string = BaseRenderEngine.resolveLabelAnchorColor(true)
        DrawUtil.drawPolygonWithFill(this.canvas, path, DrawUtil.hexToRGB(lineColor, 0.2));
        lines.forEach((line: ILine) => {
            DrawUtil.drawLine(this.canvas, line.start, line.end, lineColor, RenderEngineSettings.LINE_THICKNESS);
        });
        standardizedPoints.forEach((point: IPoint) => {
            DrawUtil.drawCircleWithFill(this.canvas, point, Settings.RESIZE_HANDLE_DIMENSION_PX/2, anchorColor);
        })
    }

    private drawActivelyResizeLabel(data: EditorData) {
        const activeLabelPolygon: LabelPolygon = LabelsSelector.getActivePolygonLabel();
        if (!!activeLabelPolygon && this.isResizeInProgress()) {
            const snappedMousePosition: IPoint = RectUtil.snapPointToRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
            const polygonOnCanvas: IPoint[] = activeLabelPolygon.vertices.map((point: IPoint, index: number) => {
                return index === this.resizeAnchorIndex ? snappedMousePosition : RenderEngineUtil.transferPointFromImageToViewPortContent(point, data);
            });
            this.drawPolygon(activeLabelPolygon.labelId, polygonOnCanvas, true);
        }
    }

    public drawExistingLabels(data: EditorData) {
        const activeLabelId: string = LabelsSelector.getActiveLabelId();
        const highlightedLabelId: string = LabelsSelector.getHighlightedLabelId();
        const imageData: ImageData = EditorModel.playbackImageData || LabelsSelector.getActiveImageData();
        if (!imageData) return;
        // 显示/隐藏标签开关：segmentationLabelsVisible 为 false 时隐藏所有多边形
        // 默认可见，与 reducer lazy-init 对齐
        const aiState = store.getState().ai.imageAIStates.get(imageData.id);
        const segmentationLabelsVisible: boolean = aiState?.segmentationLabelsVisible ?? true;
        if (!segmentationLabelsVisible) return;
        imageData.labelPolygons.forEach((labelPolygon: LabelPolygon) => {
            if (!labelPolygon.isVisible) return;
            const isActive: boolean = labelPolygon.id === activeLabelId || labelPolygon.id === highlightedLabelId;
            const pathOnCanvas: IPoint[] = RenderEngineUtil.transferPolygonFromImageToViewPortContent(labelPolygon.vertices, data);
            if (!(labelPolygon.id === activeLabelId && this.isResizeInProgress())) {
                this.drawPolygon(labelPolygon.labelId, pathOnCanvas, isActive);
            }
            this.drawLabelText(labelPolygon, pathOnCanvas);
        });
    }

    private drawLabelText(labelPolygon: LabelPolygon, pathOnCanvas: IPoint[]): void {
        let labelText = '';
        if (labelPolygon.labelId) {
            const labelName = LabelsSelector.getLabelNameById(labelPolygon.labelId);
            if (labelName) labelText = labelName.name;
        } else if ((labelPolygon as any).suggestedLabel) {
            labelText = (labelPolygon as any).suggestedLabel;
        }
        if (!labelText || pathOnCanvas.length === 0) return;

        const center: IPoint = pathOnCanvas.reduce(
            (acc: IPoint, p: IPoint) => ({x: acc.x + p.x, y: acc.y + p.y}),
            {x: 0, y: 0}
        );
        center.x /= pathOnCanvas.length;
        center.y /= pathOnCanvas.length;

        const fontSize = 12;
        const textWidth = labelText.length * fontSize * 0.6;
        const bgWidth = textWidth + 8;
        const bgHeight = 16;
        const labelBg: IRect = {
            x: center.x - bgWidth / 2,
            y: center.y - bgHeight / 2,
            width: bgWidth,
            height: bgHeight
        };

        let bgColor = 'rgba(255, 255, 255, 0.8)';
        const perClassColor = GeneralSelector.getEnablePerClassColorationStatus();
        if (perClassColor && labelPolygon.labelId) {
            const labelName = LabelsSelector.getLabelNameById(labelPolygon.labelId);
            if (labelName && labelName.color) {
                const hex = labelName.color.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);
                bgColor = `rgba(${r}, ${g}, ${b}, 0.8)`;
            }
        }

        DrawUtil.drawRectWithFill(this.canvas, labelBg, bgColor);
        DrawUtil.drawText(
            this.canvas,
            labelText,
            fontSize,
            {x: labelBg.x + labelBg.width / 2, y: labelBg.y + labelBg.height / 2},
            perClassColor ? '#FFFFFF' : '#000000',
            true,
            'center'
        );
    }

    private drawPolygon(labelId: string | null, polygon: IPoint[], isActive: boolean) {
        const lineColor: string = BaseRenderEngine.resolveLabelLineColor(labelId, true)
        const anchorColor: string = BaseRenderEngine.resolveLabelAnchorColor(true)
        const standardizedPoints: IPoint[] = polygon.map((point: IPoint) => RenderEngineUtil.setPointBetweenPixels(point));
        // 始终填充多边形（半透明 20%），active 时颜色加深到 30% 以做视觉区分
        const fillAlpha = isActive ? 0.3 : 0.2;
        DrawUtil.drawPolygonWithFill(this.canvas, standardizedPoints, DrawUtil.hexToRGB(lineColor, fillAlpha));
        DrawUtil.drawPolygon(this.canvas, standardizedPoints, lineColor, RenderEngineSettings.LINE_THICKNESS);
        if (isActive) {
            standardizedPoints.forEach((point: IPoint) => {
                DrawUtil.drawCircleWithFill(this.canvas, point, Settings.RESIZE_HANDLE_DIMENSION_PX/2, anchorColor);
            })
        }
    }

    private drawSuggestedAnchor(data: EditorData) {
        const anchorColor: string = BaseRenderEngine.resolveLabelAnchorColor(true)
        if (this.suggestedAnchorPositionOnCanvas) {
            const suggestedAnchorRect: IRect = RectUtil
                .getRectWithCenterAndSize(this.suggestedAnchorPositionOnCanvas, RenderEngineSettings.suggestedAnchorDetectionSize);
            const isMouseOverSuggestedAnchor: boolean = RectUtil.isPointInside(suggestedAnchorRect, data.mousePositionOnViewPortContent);

            if (isMouseOverSuggestedAnchor) {
                DrawUtil.drawCircleWithFill(
                    this.canvas, this.suggestedAnchorPositionOnCanvas, Settings.RESIZE_HANDLE_DIMENSION_PX/2, anchorColor);
            }
        }
    }

    // =================================================================================================================
    // CREATION
    // =================================================================================================================

    private updateActivelyCreatedLabel(data: EditorData) {
        if (this.isCreationInProgress()) {
            const mousePositionSnapped: IPoint = RectUtil.snapPointToRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
            this.activePath.push(mousePositionSnapped);
        } else {
            const isMouseOverImage: boolean = RectUtil.isPointInside(data.viewPortContentImageRect, data.mousePositionOnViewPortContent);
            if (isMouseOverImage) {
                EditorActions.setViewPortActionsDisabledStatus(true);
                this.activePath.push(data.mousePositionOnViewPortContent);
                store.dispatch(updateActiveLabelId(null));
            }
        }
    }

    public cancelLabelCreation() {
        this.activePath = [];
        EditorActions.setViewPortActionsDisabledStatus(false);
    }

    private finishLabelCreation() {
        this.activePath = [];
        EditorActions.setViewPortActionsDisabledStatus(false);
    }

    public addLabelAndFinishCreation(data: EditorData) {
        if (this.isCreationInProgress() && this.activePath.length > 2) {
            const polygonOnImage: IPoint[] = RenderEngineUtil.transferPolygonFromViewPortContentToImage(this.activePath, data);
            this.addPolygonLabel(polygonOnImage);
            this.finishLabelCreation();
        }
    }

    private addPolygonLabel(polygon: IPoint[]) {
        const activeLabelId = LabelsSelector.getActiveLabelNameId();
        const imageData: ImageData = LabelsSelector.getActiveImageData();
        const labelPolygon: LabelPolygon = LabelUtil.createLabelPolygon(activeLabelId, polygon);
        imageData.labelPolygons.push(labelPolygon);
        store.dispatch(updateImageDataById(imageData.id, imageData));
        store.dispatch(updateFirstLabelCreatedFlag(true));
        store.dispatch(updateActiveLabelId(labelPolygon.id));
    };

    // =================================================================================================================
    // TRANSFER
    // =================================================================================================================

    private startExistingLabelResize(data: EditorData, labelId: string, anchorIndex: number) {
        store.dispatch(updateActiveLabelId(labelId));
        this.resizeAnchorIndex = anchorIndex;
        EditorActions.setViewPortActionsDisabledStatus(true);
    }

    private endExistingLabelResize(data: EditorData) {
        this.applyResizeToPolygonLabel(data);
        this.resizeAnchorIndex = null;
        EditorActions.setViewPortActionsDisabledStatus(false);
    }

    private applyResizeToPolygonLabel(data: EditorData) {
        const imageData: ImageData = LabelsSelector.getActiveImageData();
        const activeLabel: LabelPolygon = LabelsSelector.getActivePolygonLabel();
        imageData.labelPolygons = imageData.labelPolygons.map((polygon: LabelPolygon) => {
            if (polygon.id !== activeLabel.id) {
                return polygon
            } else {
                return {
                    ...polygon,
                    vertices: polygon.vertices.map((value: IPoint, index: number) => {
                        if (index !== this.resizeAnchorIndex) {
                            return value;
                        } else {
                            const snappedMousePosition: IPoint =
                                RectUtil.snapPointToRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
                            return RenderEngineUtil.transferPointFromViewPortContentToImage(snappedMousePosition, data);
                        }
                    })
                }
            }
        });
        store.dispatch(updateImageDataById(imageData.id, imageData));
        store.dispatch(updateActiveLabelId(activeLabel.id));
    }

    private discardSuggestedPoint(): void {
        this.suggestedAnchorIndexInPolygon = null;
        this.suggestedAnchorPositionOnCanvas = null;
    }

    // =================================================================================================================
    // UPDATE
    // =================================================================================================================

    private addSuggestedAnchorToPolygonLabel(data: EditorData) {
        const imageData: ImageData = LabelsSelector.getActiveImageData();
        const activeLabel: LabelPolygon = LabelsSelector.getActivePolygonLabel();
        const newAnchorPositionOnImage: IPoint =
            RenderEngineUtil.transferPointFromViewPortContentToImage(this.suggestedAnchorPositionOnCanvas, data);
        const insert = (arr, index, newItem) => [...arr.slice(0, index), newItem, ...arr.slice(index)];

        const newImageData: ImageData = {
            ...imageData,
            labelPolygons: imageData.labelPolygons.map((polygon: LabelPolygon) => {
                if (polygon.id !== activeLabel.id) {
                    return polygon
                } else {
                    return {
                        ...polygon,
                        vertices: insert(polygon.vertices, this.suggestedAnchorIndexInPolygon, newAnchorPositionOnImage)
                    }
                }
            })
        };

        store.dispatch(updateImageDataById(newImageData.id, newImageData));
        this.startExistingLabelResize(data, activeLabel.id, this.suggestedAnchorIndexInPolygon);
        this.discardSuggestedPoint();
    }

    // =================================================================================================================
    // VALIDATORS
    // =================================================================================================================

    public isInProgress(): boolean {
        return this.isCreationInProgress() || this.isResizeInProgress();
    }

    private isCreationInProgress(): boolean {
        return this.activePath !== null && this.activePath.length !== 0;
    }

    private isResizeInProgress(): boolean {
        return this.resizeAnchorIndex !== null;
    }

    private isMouseOverAnchor(mouse: IPoint, anchor: IPoint): boolean {
        if (!mouse || !anchor) return null;
        return RectUtil.isPointInside(RectUtil.getRectWithCenterAndSize(anchor, RenderEngineSettings.anchorSize), mouse);
    }

    /**
     * Ray-casting 点在多边形内判断（canvas 坐标）
     */
    private static isPointInsidePolygon(point: IPoint, vertices: IPoint[]): boolean {
        if (vertices.length < 3) return false;
        let inside = false;
        const { x, y } = point;
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
            const xi = vertices[i].x, yi = vertices[i].y;
            const xj = vertices[j].x, yj = vertices[j].y;
            const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    /**
     * 橡皮擦模式：
     *  - 点击靠近顶点 → 删除该顶点（<3个则删整个多边形）
     *  - 点击多边形内部 → 删整个多边形
     *  - 点击多边形边缘 → 删整个多边形
     * 返回 true 表示有删除发生。
     */
    public eraserClick(data: EditorData): boolean {
        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData) return false;
        const mouse = data.mousePositionOnViewPortContent;
        if (!mouse) return false;

        // 顶点命中半径稍大（方便操作）
        const vertexRadius = RenderEngineSettings.anchorHoverSize.width;
        // 边缘命中半径
        const edgeRadius = RenderEngineSettings.anchorHoverSize.width / 2;

        for (const polygon of imageData.labelPolygons) {
            if (!polygon.isVisible) continue;
            const verticesOnCanvas = RenderEngineUtil.transferPolygonFromImageToViewPortContent(polygon.vertices, data);

            // 1. 优先：靠近某个顶点 → 删除该顶点
            for (let i = 0; i < verticesOnCanvas.length; i++) {
                if (RenderEngineUtil.isMouseOverAnchor(mouse, verticesOnCanvas[i], vertexRadius)) {
                    LabelActions.deletePolygonVertexByIndex(imageData.id, polygon.id, i);
                    EditorActions.fullRender();
                    return true;
                }
            }

            // 2. 点击内部（ray-casting）→ 删整个多边形
            if (PolygonRenderEngine.isPointInsidePolygon(mouse, verticesOnCanvas)) {
                LabelActions.deletePolygonLabelById(imageData.id, polygon.id);
                EditorActions.fullRender();
                return true;
            }

            // 3. 点击边缘 → 删整个多边形
            if (RenderEngineUtil.isMouseOverPolygon(mouse, verticesOnCanvas, edgeRadius)) {
                LabelActions.deletePolygonLabelById(imageData.id, polygon.id);
                EditorActions.fullRender();
                return true;
            }
        }

        return false;
    }

    // =================================================================================================================
    // FINE ERASER HELPERS
    // =================================================================================================================

    /**
     * 返回鼠标下方的多边形 ID（内部 ray-casting 或边缘/顶点附近）
     * 供 AllLabelsRenderEngine 的双击检测使用
     */
    public getPolygonIdUnderMouse(data: EditorData): string | null {
        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData) return null;
        const mouse = data.mousePositionOnViewPortContent;
        if (!mouse) return null;

        const vertexRadius = RenderEngineSettings.anchorHoverSize.width;
        const edgeRadius   = RenderEngineSettings.anchorHoverSize.width / 2;

        for (const polygon of imageData.labelPolygons) {
            if (!polygon.isVisible) continue;
            const verticesOnCanvas = RenderEngineUtil.transferPolygonFromImageToViewPortContent(polygon.vertices, data);

            if (PolygonRenderEngine.isPointInsidePolygon(mouse, verticesOnCanvas)) return polygon.id;
            if (RenderEngineUtil.isMouseOverPolygon(mouse, verticesOnCanvas, edgeRadius)) return polygon.id;
            for (const v of verticesOnCanvas) {
                if (RenderEngineUtil.isMouseOverAnchor(mouse, v, vertexRadius)) return polygon.id;
            }
        }
        return null;
    }

    /**
     * 精细擦除：移除指定多边形中距鼠标 ≤ brushRadius 像素的顶点
     * 返回 true = 多边形仍存在，false = 顶点不足 3 个已整体删除
     */
    public eraseVerticesNearPoint(data: EditorData, polygonId: string, brushRadius: number): boolean {
        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData) return false;
        const mouse = data.mousePositionOnViewPortContent;
        if (!mouse) return false;

        const polygon = imageData.labelPolygons.find(p => p.id === polygonId);
        if (!polygon) return false;

        const verticesOnCanvas = RenderEngineUtil.transferPolygonFromImageToViewPortContent(polygon.vertices, data);
        const toRemove = new Set<number>();
        for (let i = 0; i < verticesOnCanvas.length; i++) {
            const dx = verticesOnCanvas[i].x - mouse.x;
            const dy = verticesOnCanvas[i].y - mouse.y;
            if (Math.sqrt(dx * dx + dy * dy) <= brushRadius) toRemove.add(i);
        }
        if (toRemove.size === 0) return true;

        const remaining = polygon.vertices.filter((_, i) => !toRemove.has(i));
        if (remaining.length < 3) {
            LabelActions.deletePolygonLabelById(imageData.id, polygonId);
            EditorActions.fullRender();
            return false;
        }
        const newImageData = {
            ...imageData,
            labelPolygons: imageData.labelPolygons.map(p =>
                p.id === polygonId ? { ...p, vertices: remaining } : p
            )
        };
        store.dispatch(updateImageDataById(imageData.id, newImageData));
        EditorActions.fullRender();
        return true;
    }

    /**
     * 精细擦除模式下的视觉叠加：
     *  - 橙色半透明多边形轮廓 + 填充
     *  - 所有顶点白色圆点
     *  - 笔刷范围内顶点红色圆点
     *  - 鼠标位置笔刷圆圈
     */
    public drawFineEraserOverlay(data: EditorData, polygonId: string, brushRadius: number): void {
        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData) return;
        const mouse = data.mousePositionOnViewPortContent;
        const polygon = imageData.labelPolygons.find(p => p.id === polygonId);
        if (!polygon) return;

        const verts = RenderEngineUtil.transferPolygonFromImageToViewPortContent(polygon.vertices, data);

        // Orange fill + outline
        DrawUtil.drawPolygonWithFill(this.canvas, verts, 'rgba(255, 140, 0, 0.30)');
        DrawUtil.drawPolygon(this.canvas, verts, 'rgba(255, 140, 0, 0.90)', 2);

        // Brush circle around cursor
        if (mouse) {
            DrawUtil.drawCircle(this.canvas, mouse, brushRadius, 0, 360, 1.5, 'rgba(255, 80, 80, 0.75)');
        }

        // Vertex dots
        for (const v of verts) {
            const inBrush = mouse !== null && (() => {
                const dx = v.x - mouse.x;
                const dy = v.y - mouse.y;
                return Math.sqrt(dx * dx + dy * dy) <= brushRadius;
            })();
            const fill = inBrush ? 'rgba(255, 50, 50, 1)' : 'rgba(255, 255, 255, 0.9)';
            DrawUtil.drawCircleWithFill(this.canvas, v, 5, fill);
            DrawUtil.drawCircle(this.canvas, v, 5, 0, 360, 1, 'rgba(0, 0, 0, 0.5)');
        }
    }

    // =================================================================================================================
    // GETTERS
    // =================================================================================================================

    private getPolygonUnderMouse(data: EditorData): LabelPolygon | null {
        const mouseOnCanvas = data.mousePositionOnViewPortContent;
        if (!mouseOnCanvas) return null;

        const labelPolygons: LabelPolygon[] = LabelsSelector
            .getActiveImageData()
            .labelPolygons
            .filter((labelPolygon: LabelPolygon) => labelPolygon.isVisible);
        const radius = RenderEngineSettings.anchorHoverSize.width / 2;

        for (const labelPolygon of labelPolygons) {
            const verticesOnCanvas = RenderEngineUtil
                .transferPolygonFromImageToViewPortContent(labelPolygon.vertices, data);
            if (RenderEngineUtil.isMouseOverPolygon(mouseOnCanvas, verticesOnCanvas, radius)) {
                return labelPolygon;
            }
        }
        return null;
    }

    private getAnchorUnderMouse(data: EditorData): IPoint | null {
        const mouseOnCanvas = data.mousePositionOnViewPortContent;
        if (!mouseOnCanvas) return null;

        const labelPolygons: LabelPolygon[] = LabelsSelector
            .getActiveImageData()
            .labelPolygons
            .filter((labelPolygon: LabelPolygon) => labelPolygon.isVisible);
        const radius = RenderEngineSettings.anchorHoverSize.width / 2;

        for (const labelPolygon of labelPolygons) {
            const verticesOnCanvas = RenderEngineUtil
                .transferPolygonFromImageToViewPortContent(labelPolygon.vertices, data);
            for (const vertexOnCanvas of verticesOnCanvas) {
                if (RenderEngineUtil.isMouseOverAnchor(mouseOnCanvas, vertexOnCanvas, radius)) return vertexOnCanvas;
            }
        }
        return null;
    }
}
