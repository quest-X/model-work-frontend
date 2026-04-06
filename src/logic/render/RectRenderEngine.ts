import {IPoint} from '../../interfaces/IPoint';
import {IRect} from '../../interfaces/IRect';
import {RectUtil} from '../../utils/RectUtil';
import {DrawUtil} from '../../utils/DrawUtil';
import {store} from '../..';
import {ImageData, LabelRect} from '../../store/labels/types';
import {
    updateActiveLabelId,
    updateFirstLabelCreatedFlag,
    updateHighlightedLabelId,
    updateImageDataById
} from '../../store/labels/actionCreators';
import {PointUtil} from '../../utils/PointUtil';
import {RectAnchor} from '../../data/RectAnchor';
import {RenderEngineSettings} from '../../settings/RenderEngineSettings';
import {Direction} from '../../data/enums/Direction';
import {updateCustomCursorStyle} from '../../store/general/actionCreators';
import {CustomCursorStyle} from '../../data/enums/CustomCursorStyle';
import {LabelsSelector} from '../../store/selectors/LabelsSelector';
import {EditorData} from '../../data/EditorData';
import {BaseRenderEngine} from './BaseRenderEngine';
import {RenderEngineUtil} from '../../utils/RenderEngineUtil';
import {LabelType} from '../../data/enums/LabelType';
import {EditorActions} from '../actions/EditorActions';
import {EditorModel} from '../../staticModels/EditorModel';
import {GeneralSelector} from '../../store/selectors/GeneralSelector';
import {LabelStatus} from '../../data/enums/LabelStatus';
import {LabelUtil} from '../../utils/LabelUtil';
import {Settings} from '../../settings/Settings';

export class RectRenderEngine extends BaseRenderEngine {

    // =================================================================================================================
    // STATE
    // =================================================================================================================

    private startCreateRectPoint: IPoint;
    private startResizeRectAnchor: RectAnchor;
    private startMoveRectPoint: IPoint;
    private moveRectId: string;
    
    // 多边形移动相关状态
    private movePolygonId: string;
    private startMovePolygonPoint: IPoint;

    public constructor(canvas: HTMLCanvasElement) {
        super(canvas);
        this.labelType = LabelType.RECT;
    }

    // =================================================================================================================
    // EVENT HANDLERS
    // =================================================================================================================

    public mouseDownHandler = (data: EditorData) => {
        const isMouseOverImage: boolean = RenderEngineUtil.isMouseOverImage(data);
        const isMouseOverCanvas: boolean = RenderEngineUtil.isMouseOverCanvas(data);
        const isInLabelDragMode: boolean = GeneralSelector.getImageDragModeStatus();

        // 只处理左键点击 (button === 0)，忽略中键和右键
        const mouseEvent = data.event as MouseEvent;
        if (mouseEvent && mouseEvent.button !== 0) {
            return;
        }

        if (isMouseOverCanvas) {
            if (isInLabelDragMode) {
                // 标签拖拽模式：优先检查锚点，然后检查整个矩形区域
                const rectUnderMouseEdge: LabelRect = this.getRectUnderMouse(data);
                if (!!rectUnderMouseEdge) {
                    const rect: IRect = this.calculateRectRelativeToActiveImage(rectUnderMouseEdge.rect, data);
                    const anchorUnderMouse: RectAnchor = this.getAnchorUnderMouseByRect(rect, data.mousePositionOnViewPortContent, data.viewPortContentImageRect);

                    store.dispatch(updateActiveLabelId(rectUnderMouseEdge.id));

                    if (!!anchorUnderMouse && rectUnderMouseEdge.status === LabelStatus.ACCEPTED) {
                        this.startRectResize(anchorUnderMouse);
                        return;
                    }
                }

                const rectUnderMouseDrag: LabelRect = this.getRectUnderMouseForDrag(data);
                if (!!rectUnderMouseDrag && rectUnderMouseDrag.status === LabelStatus.ACCEPTED) {
                    store.dispatch(updateActiveLabelId(rectUnderMouseDrag.id));
                    this.startRectMove(data.mousePositionOnViewPortContent, rectUnderMouseDrag.id);
                } else {
                    const activeLabelViewType = LabelsSelector.getActiveLabelViewType();
                    if (activeLabelViewType === LabelType.ALL) {
                        const polygonUnderMouse = this.getPolygonUnderMouse(data);
                        if (!!polygonUnderMouse && polygonUnderMouse.status === LabelStatus.ACCEPTED) {
                            store.dispatch(updateActiveLabelId(polygonUnderMouse.id));
                            this.startPolygonMove(data.mousePositionOnViewPortContent, polygonUnderMouse.id);
                        }
                    }
                }
            } else {
                // 普通模式：恢复 origin 逻辑
                const rectUnderMouse: LabelRect = this.getRectUnderMouse(data);
                if (!!rectUnderMouse) {
                    const rect: IRect = this.calculateRectRelativeToActiveImage(rectUnderMouse.rect, data);
                    const anchorUnderMouse: RectAnchor = this.getAnchorUnderMouseByRect(rect, data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
                    if (!!anchorUnderMouse && rectUnderMouse.status === LabelStatus.ACCEPTED) {
                        store.dispatch(updateActiveLabelId(rectUnderMouse.id));
                        this.startRectResize(anchorUnderMouse);
                    } else {
                        if (!!LabelsSelector.getHighlightedLabelId())
                            store.dispatch(updateActiveLabelId(LabelsSelector.getHighlightedLabelId()));
                        else
                            this.startRectCreation(data.mousePositionOnViewPortContent);
                    }
                } else if (isMouseOverImage) {
                    this.startRectCreation(data.mousePositionOnViewPortContent);
                }
            }
        }
    };

    public mouseUpHandler = (data: EditorData) => {
        if (!!data.viewPortContentImageRect) {
            const mousePositionSnapped: IPoint = RectUtil.snapPointToRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
            const activeLabelRect: LabelRect = LabelsSelector.getActiveRectLabel();

            if (!!this.startCreateRectPoint && !PointUtil.equals(this.startCreateRectPoint, mousePositionSnapped)) {

                const minX: number = Math.min(this.startCreateRectPoint.x, mousePositionSnapped.x);
                const minY: number = Math.min(this.startCreateRectPoint.y, mousePositionSnapped.y);
                const maxX: number = Math.max(this.startCreateRectPoint.x, mousePositionSnapped.x);
                const maxY: number = Math.max(this.startCreateRectPoint.y, mousePositionSnapped.y);

                const rect = {x: minX, y: minY, width: maxX - minX, height: maxY - minY};
                this.addRectLabel(RenderEngineUtil.transferRectFromImageToViewPortContent(rect, data));
            }

            if (!!this.startResizeRectAnchor && !!activeLabelRect) {
                const rect: IRect = this.calculateRectRelativeToActiveImage(activeLabelRect.rect, data);
                const startAnchorPosition: IPoint = PointUtil.add(this.startResizeRectAnchor.position,
                    data.viewPortContentImageRect);
                const delta: IPoint = PointUtil.subtract(mousePositionSnapped, startAnchorPosition);
                const resizeRect: IRect = RectUtil.resizeRect(rect, this.startResizeRectAnchor.type, delta);
                const scale: number = RenderEngineUtil.calculateImageScale(data);
                const scaledRect: IRect = RectUtil.scaleRect(resizeRect, scale);

                const imageData = LabelsSelector.getActiveImageData();
                imageData.labelRects = imageData.labelRects.map((labelRect: LabelRect) => {
                    if (labelRect.id === activeLabelRect.id) {
                        return {
                            ...labelRect,
                            rect: scaledRect
                        };
                    }
                    return labelRect;
                });
                store.dispatch(updateImageDataById(imageData.id, imageData));
            }

            // 处理矩形框移动
            if (!!this.startMoveRectPoint && !!this.moveRectId && !!data.mousePositionOnViewPortContent) {
                const delta: IPoint = PointUtil.subtract(data.mousePositionOnViewPortContent, this.startMoveRectPoint);
                const scale: number = RenderEngineUtil.calculateImageScale(data);
                const deltaOnImage: IPoint = PointUtil.multiply(delta, scale);

                const imageData = LabelsSelector.getActiveImageData();
                if (imageData) {
                    const rectToMove = imageData.labelRects.find(rect => rect.id === this.moveRectId);
                    if (!!rectToMove) {
                        const movedRect: IRect = RectUtil.translate(rectToMove.rect, deltaOnImage);
                        imageData.labelRects = imageData.labelRects.map((labelRect: LabelRect) => {
                            if (labelRect.id === this.moveRectId) {
                                return {
                                    ...labelRect,
                                    rect: movedRect
                                };
                            }
                            return labelRect;
                        });
                        store.dispatch(updateImageDataById(imageData.id, imageData));
                    }
                }
            }
        }
        this.endRectTransformation();
    };

    public mouseMoveHandler = (data: EditorData) => {
        if (!!data.viewPortContentImageRect && !!data.mousePositionOnViewPortContent) {
            const isOverImage: boolean = RenderEngineUtil.isMouseOverImage(data);

            // 处理多边形移动
            if (this.isPolygonMoveInProgress()) {
                this.updatePolygonMove(data);
            }

            if (isOverImage && !this.startResizeRectAnchor) {
                const labelRect: LabelRect = this.getRectUnderMouse(data);
                if (!!labelRect && !this.isInProgress()) {
                    if (LabelsSelector.getHighlightedLabelId() !== labelRect.id) {
                        store.dispatch(updateHighlightedLabelId(labelRect.id))
                    }
                } else {
                    if (LabelsSelector.getHighlightedLabelId() !== null) {
                        store.dispatch(updateHighlightedLabelId(null))
                    }
                }
            }
        }
    };

    // =================================================================================================================
    // RENDERING
    // =================================================================================================================

    public render(data: EditorData) {
        // 确保基础数据完整才开始渲染
        if (!data.viewPortContentImageRect || !data.realImageSize) {
            return; // 图像还没有加载完成，跳过渲染
        }
        
        const activeLabelId: string = LabelsSelector.getActiveLabelId();
        // 播放时直接使用预设的帧数据，绕过 Redux activeImageIndex 查找
        const imageData: ImageData = EditorModel.playbackImageData || LabelsSelector.getActiveImageData();
        
        // 获取当前图片的AI标签显示状态（高性能缓存优化）
        let aiLabelsVisible = false;
        let segmentationLabelsVisible = false;
        let currentImageAIState = null;
        if (imageData) {
            const imageAIStates = store.getState().ai.imageAIStates;
            currentImageAIState = imageAIStates.get(imageData.id);
            aiLabelsVisible = currentImageAIState ? currentImageAIState.aiLabelsVisible : false;
            segmentationLabelsVisible = currentImageAIState ? currentImageAIState.segmentationLabelsVisible : false;
        }
        
        // 渲染矩形框标签
        if (imageData && imageData.labelRects) {
            imageData.labelRects.forEach((labelRect: LabelRect) => {
                // 检查标签是否应该显示
                const shouldShow = labelRect.isVisible &&
                    (labelRect.isCreatedByAI ? aiLabelsVisible : true);

                if (shouldShow) {
                    if (labelRect.status === LabelStatus.ACCEPTED && labelRect.id === activeLabelId) {
                        this.drawActiveRect(labelRect, data)
                    } else {
                        this.drawInactiveRect(labelRect, data);
                    }
                }
            });
            this.drawCurrentlyCreatedRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
            this.updateCursorStyle(data);
        }
        
        // 只有在"全部标签"视图时才渲染其他类型的标签
        const activeLabelViewType = LabelsSelector.getActiveLabelViewType();
        if (imageData && activeLabelViewType === LabelType.ALL) {
            
            // 渲染多边形标签
            if (imageData.labelPolygons) {
                imageData.labelPolygons.forEach((labelPolygon) => {
                    let shouldShow = false;
                    
                    if (activeLabelViewType === LabelType.ALL) {
                        // 全部标签视图：显示所有可见的多边形标签
                        shouldShow = labelPolygon.isVisible && 
                                   labelPolygon.status === LabelStatus.ACCEPTED;
                    } else {
                        // 其他视图：只显示AI生成的多边形标签（如果分割标签可见）
                        shouldShow = labelPolygon.isVisible && 
                                   labelPolygon.status === LabelStatus.ACCEPTED &&
                                   labelPolygon.isCreatedByAI &&
                                   segmentationLabelsVisible;
                    }
                    
                    if (shouldShow && labelPolygon.vertices && labelPolygon.vertices.length >= 3) {
                        const lineColor = BaseRenderEngine.resolveLabelLineColor(labelPolygon.labelId, true, labelPolygon.isCreatedByAI);
                        // 需要将多边形顶点从图像坐标转换为画布坐标
                        const transformedPoints = labelPolygon.vertices.map((point) => 
                            RenderEngineUtil.transferPointFromImageToViewPortContent(point, data)
                        );
                        const standardizedPoints = transformedPoints.map((point) => RenderEngineUtil.setPointBetweenPixels(point));
                        
                        DrawUtil.drawPolygonWithFill(this.canvas, standardizedPoints, DrawUtil.hexToRGB(lineColor, 0.2));
                        DrawUtil.drawPolygon(this.canvas, standardizedPoints, lineColor, RenderEngineSettings.LINE_THICKNESS);
                    }
                });
            }
            
            // 渲染点标签
            if (imageData.labelPoints) {
                imageData.labelPoints.forEach((labelPoint) => {
                    let shouldShow = false;
                    
                    if (activeLabelViewType === LabelType.ALL) {
                        // 全部标签视图：显示所有可见的点标签
                        shouldShow = labelPoint.isVisible && 
                                   labelPoint.status === LabelStatus.ACCEPTED;
                    } else {
                        // 其他视图：只显示AI生成的点标签（如果AI标签可见）
                        shouldShow = labelPoint.isVisible && 
                                   labelPoint.status === LabelStatus.ACCEPTED &&
                                   labelPoint.isCreatedByAI &&
                                   aiLabelsVisible;
                    }
                    
                    if (shouldShow) {
                        const pointColor = BaseRenderEngine.resolveLabelLineColor(labelPoint.labelId, true, labelPoint.isCreatedByAI);
                        const transformedPoint = RenderEngineUtil.transferPointFromImageToViewPortContent(labelPoint.point, data);
                        const standardizedPoint = RenderEngineUtil.setPointBetweenPixels(transformedPoint);
                        DrawUtil.drawCircleWithFill(this.canvas, standardizedPoint, Settings.RESIZE_HANDLE_DIMENSION_PX/2, pointColor);
                    }
                });
            }
            
            // 渲染线条标签
            if (imageData.labelLines) {
                imageData.labelLines.forEach((labelLine) => {
                    let shouldShow = false;
                    
                    if (activeLabelViewType === LabelType.ALL) {
                        // 全部标签视图：显示所有可见的线条标签
                        shouldShow = labelLine.isVisible && 
                                   labelLine.status === LabelStatus.ACCEPTED;
                    } else {
                        // 其他视图：只显示AI生成的线条标签（如果AI标签可见）
                        shouldShow = labelLine.isVisible && 
                                   labelLine.status === LabelStatus.ACCEPTED &&
                                   labelLine.isCreatedByAI &&
                                   aiLabelsVisible;
                    }
                    
                    if (shouldShow) {
                        const lineColor = BaseRenderEngine.resolveLabelLineColor(labelLine.labelId, true, labelLine.isCreatedByAI);
                        const transformedStart = RenderEngineUtil.transferPointFromImageToViewPortContent(labelLine.line.start, data);
                        const transformedEnd = RenderEngineUtil.transferPointFromImageToViewPortContent(labelLine.line.end, data);
                        const startPoint = RenderEngineUtil.setPointBetweenPixels(transformedStart);
                        const endPoint = RenderEngineUtil.setPointBetweenPixels(transformedEnd);
                        DrawUtil.drawLine(this.canvas, startPoint, endPoint, lineColor, RenderEngineSettings.LINE_THICKNESS);
                    }
                });
            }
        }
    }

    private drawCurrentlyCreatedRect(mousePosition: IPoint, imageRect: IRect) {
        if (!!this.startCreateRectPoint) {
            const mousePositionSnapped: IPoint = RectUtil.snapPointToRect(mousePosition, imageRect);
            const activeRect: IRect = {
                x: this.startCreateRectPoint.x,
                y: this.startCreateRectPoint.y,
                width: mousePositionSnapped.x - this.startCreateRectPoint.x,
                height: mousePositionSnapped.y - this.startCreateRectPoint.y
            };
            const activeRectBetweenPixels = RenderEngineUtil.setRectBetweenPixels(activeRect);
            const lineColor: string = BaseRenderEngine.resolveLabelLineColor(null, true, false)
            DrawUtil.drawRect(this.canvas, activeRectBetweenPixels, lineColor, RenderEngineSettings.LINE_THICKNESS);
        }
    }

    private drawInactiveRect(labelRect: LabelRect, data: EditorData) {
        const rectOnImage: IRect = RenderEngineUtil.transferRectFromViewPortContentToImage(labelRect.rect, data)
        const highlightedLabelId: string = LabelsSelector.getHighlightedLabelId()
        const displayAsActive: boolean = labelRect.status === LabelStatus.ACCEPTED && labelRect.id === highlightedLabelId;
        const lineColor: string = BaseRenderEngine.resolveLabelLineColor(labelRect.labelId, displayAsActive, labelRect.isCreatedByAI)
        const anchorColor: string = BaseRenderEngine.resolveLabelAnchorColor(displayAsActive);
        this.renderRect(rectOnImage, displayAsActive, lineColor, anchorColor);
        
        // 为所有有标签的标注框添加标签文字
        this.drawLabelText(labelRect, rectOnImage, data);
    }

    private drawActiveRect(labelRect: LabelRect, data: EditorData) {
        let rect: IRect = this.calculateRectRelativeToActiveImage(labelRect.rect, data);
        
        if (!!this.startResizeRectAnchor) {
            const startAnchorPosition: IPoint = PointUtil.add(this.startResizeRectAnchor.position, data.viewPortContentImageRect);
            const endAnchorPositionSnapped: IPoint = RectUtil.snapPointToRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
            const delta = PointUtil.subtract(endAnchorPositionSnapped, startAnchorPosition);
            rect = RectUtil.resizeRect(rect, this.startResizeRectAnchor.type, delta);
        } else if (!!this.startMoveRectPoint && labelRect.id === this.moveRectId) {
            // 移动预览：显示矩形框跟随鼠标移动
            const delta: IPoint = PointUtil.subtract(data.mousePositionOnViewPortContent, this.startMoveRectPoint);
            rect = RectUtil.translate(rect, delta);
        }
        
        const rectOnImage: IRect = RectUtil.translate(rect, data.viewPortContentImageRect);
        const lineColor: string = BaseRenderEngine.resolveLabelLineColor(labelRect.labelId, true, labelRect.isCreatedByAI)
        const anchorColor: string = BaseRenderEngine.resolveLabelAnchorColor(true);
        this.renderRect(rectOnImage, true, lineColor, anchorColor);
        
        // 为活跃的标注框也显示标签文字
        this.drawLabelText(labelRect, rectOnImage, data);
    }

    private renderRect(rectOnImage: IRect, isActive: boolean, lineColor: string, anchorColor: string) {
        const rectBetweenPixels = RenderEngineUtil.setRectBetweenPixels(rectOnImage);
        DrawUtil.drawRectWithFill(this.canvas, rectBetweenPixels, DrawUtil.hexToRGB(lineColor, 0.2));
        DrawUtil.drawRect(this.canvas, rectBetweenPixels, lineColor, RenderEngineSettings.LINE_THICKNESS);
        if (isActive) {
            const handleCenters: IPoint[] = RectUtil.mapRectToAnchors(rectOnImage).map((rectAnchor: RectAnchor) => rectAnchor.position);
            handleCenters.forEach((center: IPoint) => {
                const handleRect: IRect = RectUtil.getRectWithCenterAndSize(center, RenderEngineSettings.anchorSize);
                const handleRectBetweenPixels: IRect = RenderEngineUtil.setRectBetweenPixels(handleRect);
                DrawUtil.drawRectWithFill(this.canvas, handleRectBetweenPixels, anchorColor);
            })
        }
    }

    private updateCursorStyle(data: EditorData) {
        if (!!this.canvas && !!data.mousePositionOnViewPortContent && !GeneralSelector.getImageDragModeStatus()) {
            const rectUnderMouse: LabelRect = this.getRectUnderMouse(data);
            const rectAnchorUnderMouse: RectAnchor = this.getAnchorUnderMouse(data);
            if ((!!rectAnchorUnderMouse && rectUnderMouse && rectUnderMouse.status === LabelStatus.ACCEPTED) || !!this.startResizeRectAnchor) {
                store.dispatch(updateCustomCursorStyle(CustomCursorStyle.MOVE));
                return;
            }
            else if (RenderEngineUtil.isMouseOverCanvas(data)) {
                if (!RenderEngineUtil.isMouseOverImage(data) && !!this.startCreateRectPoint)
                    store.dispatch(updateCustomCursorStyle(CustomCursorStyle.MOVE));
                else
                    RenderEngineUtil.wrapDefaultCursorStyleInCancel(data);
                this.canvas.style.cursor = 'none';
            } else {
                this.canvas.style.cursor = 'default';
            }
        }
    }

    // =================================================================================================================
    // HELPERS
    // =================================================================================================================

    public isInProgress(): boolean {
        return !!this.startCreateRectPoint || !!this.startResizeRectAnchor || !!this.startMoveRectPoint || this.isPolygonMoveInProgress();
    }

    private calculateRectRelativeToActiveImage(rect: IRect, data: EditorData):IRect {
        const scale: number = RenderEngineUtil.calculateImageScale(data);
        return RectUtil.scaleRect(rect, 1/scale);
    }

    private addRectLabel = (rect: IRect) => {
        const activeLabelId = LabelsSelector.getActiveLabelNameId();
        const imageData: ImageData = LabelsSelector.getActiveImageData();
        if (!imageData) return;
        const labelRect: LabelRect = LabelUtil.createLabelRect(activeLabelId, rect);
        imageData.labelRects.push(labelRect);
        store.dispatch(updateImageDataById(imageData.id, imageData));
        store.dispatch(updateFirstLabelCreatedFlag(true));
        store.dispatch(updateActiveLabelId(labelRect.id));
    };

    private getRectUnderMouse(data: EditorData): LabelRect {
        const activeRectLabel: LabelRect = LabelsSelector.getActiveRectLabel();
        if (!!activeRectLabel && activeRectLabel.isVisible && this.isMouseOverRectEdges(activeRectLabel.rect, data)) {
            return activeRectLabel;
        }

        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData || !imageData.labelRects) {
            return null;
        }
        
        const labelRects: LabelRect[] = imageData.labelRects;
        
        // 获取当前图片的AI标签显示状态（优化版）
        const aiState = store.getState().ai.imageAIStates.get(imageData.id);
        const aiLabelsVisible = aiState ? aiState.aiLabelsVisible : false;
        
        for (const labelRect of labelRects) {
            const shouldShow = labelRect.isVisible && 
                (labelRect.isCreatedByAI ? aiLabelsVisible : true);
                
            if (shouldShow && this.isMouseOverRectEdges(labelRect.rect, data)) {
                return labelRect;
            }
        }
        return null;
    }


    private getRectUnderMouseForDrag(data: EditorData): LabelRect {
        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData || !imageData.labelRects) {
            return null;
        }
        
        const labelRects: LabelRect[] = imageData.labelRects;
        
        // 从后往前检查（最上层优先）
        // 获取当前图片的AI标签显示状态
        const imageAIStates = store.getState().ai.imageAIStates;
        const currentImageAIState = imageAIStates.get(imageData.labelRects[0]?.id ? imageData.id : '');
        const aiLabelsVisible = currentImageAIState ? currentImageAIState.aiLabelsVisible : false;
        
        for (let i = labelRects.length - 1; i >= 0; i--) {
            const labelRect = labelRects[i];
            const shouldShow = labelRect.isVisible && 
                (labelRect.isCreatedByAI ? aiLabelsVisible : true);
                
            if (shouldShow && this.isMouseOverEntireRect(labelRect.rect, data)) {
                return labelRect;
            }
        }
        return null;
    }

    private isMouseOverEntireRect(rect: IRect, data: EditorData): boolean {
        if (!rect || !data.mousePositionOnViewPortContent || !data.viewPortContentImageRect) return false;
        
        try {
            // 使用与原有方法相同的坐标转换逻辑
            const rectRelativeToImage: IRect = this.calculateRectRelativeToActiveImage(rect, data);
            const rectOnImage: IRect = RectUtil.translate(rectRelativeToImage, data.viewPortContentImageRect);
            return RectUtil.isPointInside(rectOnImage, data.mousePositionOnViewPortContent);
        } catch (error) {
            console.warn('Rectangle coordinate conversion error:', error);
            return false;
        }
    }

    private isMouseOverRectEdges(rect: IRect, data: EditorData): boolean {
        if (!rect || !data.viewPortContentImageRect || !data.mousePositionOnViewPortContent) {
            return false;
        }
        
        const rectOnImage: IRect = RectUtil.translate(
            this.calculateRectRelativeToActiveImage(rect, data), data.viewPortContentImageRect);

        const outerRectDelta: IPoint = {
            x: RenderEngineSettings.anchorHoverSize.width / 2,
            y: RenderEngineSettings.anchorHoverSize.height / 2
        };
        const outerRect: IRect = RectUtil.expand(rectOnImage, outerRectDelta);

        const innerRectDelta: IPoint = {
            x: - RenderEngineSettings.anchorHoverSize.width / 2,
            y: - RenderEngineSettings.anchorHoverSize.height / 2
        };
        const innerRect: IRect = RectUtil.expand(rectOnImage, innerRectDelta);

        return (RectUtil.isPointInside(outerRect, data.mousePositionOnViewPortContent) &&
            !RectUtil.isPointInside(innerRect, data.mousePositionOnViewPortContent));
    }

    private getAnchorUnderMouseByRect(rect: IRect, mousePosition: IPoint, imageRect: IRect): RectAnchor {
        const rectAnchors: RectAnchor[] = RectUtil.mapRectToAnchors(rect);
        for (let i = 0; i < rectAnchors.length; i++) {
            const anchorRect: IRect = RectUtil.translate(RectUtil.getRectWithCenterAndSize(rectAnchors[i].position, RenderEngineSettings.anchorHoverSize), imageRect);
            if (!!mousePosition && RectUtil.isPointInside(anchorRect, mousePosition)) {
                return rectAnchors[i];
            }
        }
        return null;
    }

    private getAnchorUnderMouse(data: EditorData): RectAnchor {
        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData || !imageData.labelRects) {
            return null;
        }
        
        const labelRects: LabelRect[] = imageData.labelRects;
        
        // 获取当前图片的AI标签显示状态（优化版）
        const aiState = store.getState().ai.imageAIStates.get(imageData.id);
        const aiLabelsVisible = aiState ? aiState.aiLabelsVisible : false;
        
        for (let i = 0; i < labelRects.length; i++) {
            const labelRect = labelRects[i];
            const shouldShow = labelRect.isVisible && 
                (labelRect.isCreatedByAI ? aiLabelsVisible : true);
                
            if (shouldShow) {
                const rect: IRect = this.calculateRectRelativeToActiveImage(labelRect.rect, data);
                const rectAnchor = this.getAnchorUnderMouseByRect(rect, data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
                if (!!rectAnchor) return rectAnchor;
            }
        }
        return null;
    }

    private startRectCreation(mousePosition: IPoint) {
        this.startCreateRectPoint = mousePosition;
        store.dispatch(updateActiveLabelId(null));
        EditorActions.setViewPortActionsDisabledStatus(true);
    }

    private startRectResize(activatedAnchor: RectAnchor) {
        this.startResizeRectAnchor = activatedAnchor;
        EditorActions.setViewPortActionsDisabledStatus(true);
    }

    private startRectMove(mousePosition: IPoint, rectId: string) {
        this.startMoveRectPoint = mousePosition;
        this.moveRectId = rectId;
        EditorActions.setViewPortActionsDisabledStatus(true);
    }

    private endRectTransformation() {
        this.startCreateRectPoint = null;
        this.startResizeRectAnchor = null;
        this.startMoveRectPoint = null;
        this.moveRectId = null;
        
        // 清理多边形移动状态
        this.movePolygonId = null;
        this.startMovePolygonPoint = null;
        
        EditorActions.setViewPortActionsDisabledStatus(false);
    }

    // =================================================================================================================
    // AI LABEL TEXT DRAWING
    // =================================================================================================================
    
    private drawLabelText(labelRect: LabelRect, rectOnImage: IRect, data: EditorData): void {
        // 获取标签文字：优先使用已分配的标签名称，其次使用建议标签
        let labelText = '';
        if (labelRect.labelId) {
            const labelName = LabelsSelector.getLabelNameById(labelRect.labelId);
            if (labelName) {
                labelText = labelName.name;
            }
        } else if (labelRect.suggestedLabel) {
            labelText = labelRect.suggestedLabel;
        }
        
        if (!labelText) return;
        const labelPosition: IPoint = {
            x: rectOnImage.x,
            y: rectOnImage.y + 12  // 标签在标注框内部，上边缘对齐
        };
        
        // 绘制标签背景
        const textWidth = this.estimateTextWidth(labelText, 12);
        const labelBg: IRect = {
            x: labelPosition.x, // 与标注框左边缘完全对齐，不偏移
            y: rectOnImage.y, // 标签背景上边缘与标注框上边缘对齐
            width: textWidth + 8,
            height: 16
        };
        
        // 获取标签颜色：检查 perClassColoration 设置
        let bgColor = 'rgba(255, 255, 255, 0.8)'; // 默认白色背景
        const perClassColor = GeneralSelector.getEnablePerClassColorationStatus();
        if (perClassColor && labelRect.labelId) {
            const labelName = LabelsSelector.getLabelNameById(labelRect.labelId);
            if (labelName && labelName.color) {
                const hex = labelName.color.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);
                bgColor = `rgba(${r}, ${g}, ${b}, 0.8)`;
            }
        }

        DrawUtil.drawRectWithFill(this.canvas, labelBg, bgColor);

        // 绘制标签文字（在背景内完全居中）
        const textPosition: IPoint = {
            x: labelBg.x + labelBg.width / 2,
            y: labelBg.y + labelBg.height / 2
        };
        DrawUtil.drawText(
            this.canvas,
            labelText,
            12,
            textPosition,
            perClassColor ? '#FFFFFF' : '#000000',
            true,
            'center'
        );
    }
    
    private estimateTextWidth(text: string, fontSize: number): number {
        // 简单的文字宽度估算
        return text.length * fontSize * 0.6;
    }

    // =================================================================================================================
    // POLYGON SUPPORT (for ALL view)
    // =================================================================================================================

    private getPolygonUnderMouse(data: EditorData): any | null {
        const mouseOnCanvas = data.mousePositionOnViewPortContent;
        if (!mouseOnCanvas) return null;

        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData || !imageData.labelPolygons) return null;

        const labelPolygons = imageData.labelPolygons.filter((labelPolygon: any) => labelPolygon.isVisible);
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

    private startPolygonMove(mousePosition: IPoint, polygonId: string): void {
        this.startMovePolygonPoint = mousePosition;
        this.movePolygonId = polygonId;
        EditorActions.setViewPortActionsDisabledStatus(true);
    }

    private isPolygonMoveInProgress(): boolean {
        return this.movePolygonId !== null;
    }

    private updatePolygonMove(data: EditorData): void {
        if (!!this.startMovePolygonPoint) {
            const mousePositionSnapped: IPoint = RectUtil.snapPointToRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
            const moveDelta: IPoint = {
                x: mousePositionSnapped.x - this.startMovePolygonPoint.x,
                y: mousePositionSnapped.y - this.startMovePolygonPoint.y
            };

            // 将移动增量转换为图像坐标系
            const imageDelta: IPoint = RenderEngineUtil.transferPointFromViewPortContentToImage(moveDelta, data);
            
            // 获取当前多边形标签
            const imageData = LabelsSelector.getActiveImageData();
            const activePolygon = imageData.labelPolygons.find(polygon => polygon.id === this.movePolygonId);
            
            if (activePolygon) {
                // 计算新的顶点位置
                const newVertices: IPoint[] = activePolygon.vertices.map((vertex: IPoint) => ({
                    x: vertex.x + imageDelta.x,
                    y: vertex.y + imageDelta.y
                }));

                // 更新多边形位置
                const newImageData = {
                    ...imageData,
                    labelPolygons: imageData.labelPolygons.map((labelPolygon: any) =>
                        labelPolygon.id === this.movePolygonId ? { ...labelPolygon, vertices: newVertices } : labelPolygon
                    )
                };
                store.dispatch(updateImageDataById(imageData.id, newImageData));
                this.startMovePolygonPoint = mousePositionSnapped;
            }
        }
    }
}
