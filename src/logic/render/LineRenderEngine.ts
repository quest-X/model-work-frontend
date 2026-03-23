import {BaseRenderEngine} from './BaseRenderEngine';
import {RenderEngineSettings} from '../../settings/RenderEngineSettings';
import {LabelType} from '../../data/enums/LabelType';
import {EditorData} from '../../data/EditorData';
import {RenderEngineUtil} from '../../utils/RenderEngineUtil';
import {ImageData, LabelLine} from '../../store/labels/types';
import {IPoint} from '../../interfaces/IPoint';
import {RectUtil} from '../../utils/RectUtil';
import {store} from '../../index';
import {
    updateActiveLabelId,
    updateFirstLabelCreatedFlag,
    updateHighlightedLabelId,
    updateImageDataById
} from '../../store/labels/actionCreators';
import {EditorActions} from '../actions/EditorActions';
import {LabelsSelector} from '../../store/selectors/LabelsSelector';
import {DrawUtil} from '../../utils/DrawUtil';
import {GeneralSelector} from '../../store/selectors/GeneralSelector';
import { v4 as uuidv4 } from 'uuid';
import {ILine} from '../../interfaces/ILine';
import {LineUtil} from '../../utils/LineUtil';
import {updateCustomCursorStyle} from '../../store/general/actionCreators';
import {CustomCursorStyle} from '../../data/enums/CustomCursorStyle';
import {LineAnchorType} from '../../data/enums/LineAnchorType';
import {Settings} from '../../settings/Settings';

export class LineRenderEngine extends BaseRenderEngine {

    // =================================================================================================================
    // STATE
    // =================================================================================================================

    private lineCreationStartPoint: IPoint;
    private lineUpdateAnchorType: LineAnchorType;

    public constructor(canvas: HTMLCanvasElement) {
        super(canvas);
        this.labelType = LabelType.LINE;
    }

    // =================================================================================================================
    // EVENT HANDLERS
    // =================================================================================================================

    public mouseDownHandler(data: EditorData): void {
        const isMouseOverImage: boolean = RenderEngineUtil.isMouseOverImage(data);
        const isMouseOverCanvas: boolean = RenderEngineUtil.isMouseOverCanvas(data);
        const anchorTypeUnderMouse = this.getAnchorTypeUnderMouse(data);
        const labelLineUnderMouse: LabelLine = this.getLineUnderMouse(data);
        const isInDragMode: boolean = GeneralSelector.getImageDragModeStatus();

        // 只处理左键点击 (button === 0)，忽略中键和右键
        const mouseEvent = data.event as MouseEvent;
        if (mouseEvent && mouseEvent.button !== 0) {
            return;
        }

        if (isMouseOverCanvas) {
            if (!!anchorTypeUnderMouse && !this.isResizeInProgress()) {
                this.startExistingLabelUpdate(labelLineUnderMouse.id, anchorTypeUnderMouse)
            } else if (labelLineUnderMouse !== null) {
                store.dispatch(updateActiveLabelId(labelLineUnderMouse.id));
            } else if (!this.isInProgress() && isMouseOverImage && !isInDragMode) {
                // 只有在非拖拽模式下才允许创建新线条
                this.startNewLabelCreation(data)
            } else if (this.isInProgress()) {
                this.finishNewLabelCreation(data);
            }
        }
    }

    public mouseUpHandler(data: EditorData): void {
        if (this.isResizeInProgress()) {
            this.endExistingLabelUpdate(data)
        }
    }

    public mouseMoveHandler(data: EditorData): void {
        const isOverImage: boolean = RenderEngineUtil.isMouseOverImage(data);
        if (isOverImage) {
            const labelLine: LabelLine = this.getLineUnderMouse(data);
            if (!!labelLine) {
                if (LabelsSelector.getHighlightedLabelId() !== labelLine.id) {
                    store.dispatch(updateHighlightedLabelId(labelLine.id))
                }
            } else {
                if (LabelsSelector.getHighlightedLabelId() !== null) {
                    store.dispatch(updateHighlightedLabelId(null));
                }
            }
        }
    }

    // =================================================================================================================
    // RENDERING
    // =================================================================================================================

    public render(data: EditorData): void {
        this.drawExistingLabels(data);
        this.drawActivelyCreatedLabel(data)
        this.drawActivelyResizeLabel(data)
        this.updateCursorStyle(data);
    }

    private drawExistingLabels(data: EditorData) {
        const activeLabelId: string = LabelsSelector.getActiveLabelId();
        const highlightedLabelId: string = LabelsSelector.getHighlightedLabelId();
        const imageData: ImageData = LabelsSelector.getActiveImageData();
        imageData.labelLines.forEach((labelLine: LabelLine) => {
            if (labelLine.isVisible) {
                const isActive: boolean = labelLine.id === activeLabelId || labelLine.id === highlightedLabelId;
                const lineOnCanvas = RenderEngineUtil.transferLineFromImageToViewPortContent(labelLine.line, data)
                if (!(labelLine.id === activeLabelId && this.isResizeInProgress())) {
                    this.drawLine(labelLine.labelId, lineOnCanvas, isActive, labelLine.isCreatedByAI)
                }
            }
        });
    }

    private drawActivelyCreatedLabel(data: EditorData) {
        if (this.isInProgress()) {
            const originalLine = {start: this.lineCreationStartPoint, end: data.mousePositionOnViewPortContent}
            
            // 应用磁性吸附
            const snapResult = LineUtil.snapLineToAxis(originalLine);
            const lineToRender = snapResult.snappedLine;
            
            // 根据吸附状态选择颜色和样式
            if (snapResult.isSnapped) {
                // 吸附状态：使用橙色虚线
                DrawUtil.drawDashedLine(
                    this.canvas, 
                    lineToRender.start, 
                    lineToRender.end, 
                    RenderEngineSettings.LINE_SNAP_COLOR, 
                    RenderEngineSettings.LINE_THICKNESS,
                    RenderEngineSettings.LINE_SNAP_DASH_PATTERN
                );
            } else {
                // 正常状态：使用绿色实线
                DrawUtil.drawLine(this.canvas, lineToRender.start, lineToRender.end, RenderEngineSettings.lineActiveColor, RenderEngineSettings.LINE_THICKNESS);
            }
            
            DrawUtil.drawCircleWithFill(this.canvas, this.lineCreationStartPoint, Settings.RESIZE_HANDLE_DIMENSION_PX/2, RenderEngineSettings.defaultAnchorColor)
            
            // 实时显示线条长度（使用吸附后的线条）
            const colorToUse = snapResult.isSnapped ? RenderEngineSettings.LINE_SNAP_COLOR : RenderEngineSettings.lineActiveColor;
            this.drawLengthLabel(lineToRender, colorToUse);
        }
    }

    private drawActivelyResizeLabel(data: EditorData) {
        const activeLabelLine: LabelLine = LabelsSelector.getActiveLineLabel();
        if (!!activeLabelLine && this.isResizeInProgress()) {
            const snappedMousePosition: IPoint =
                RectUtil.snapPointToRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
            const lineOnCanvas = RenderEngineUtil.transferLineFromImageToViewPortContent(activeLabelLine.line, data)
            const originalLineToDraw = {
                start: this.lineUpdateAnchorType === LineAnchorType.START ? snappedMousePosition : lineOnCanvas.start,
                end: this.lineUpdateAnchorType === LineAnchorType.END ? snappedMousePosition : lineOnCanvas.end
            }
            
            // 应用磁性吸附
            const snapResult = LineUtil.snapLineToAxis(originalLineToDraw);
            const finalLineToDraw = snapResult.snappedLine;
            
            // 根据吸附状态绘制不同样式的线条
            if (snapResult.isSnapped) {
                // 吸附状态：使用橙色虚线
                DrawUtil.drawDashedLine(
                    this.canvas, 
                    finalLineToDraw.start, 
                    finalLineToDraw.end, 
                    RenderEngineSettings.LINE_SNAP_COLOR, 
                    RenderEngineSettings.LINE_THICKNESS,
                    RenderEngineSettings.LINE_SNAP_DASH_PATTERN
                );
                
                // 绘制锚点
                const anchorColor = BaseRenderEngine.resolveLabelAnchorColor(true);
                LineUtil
                    .getPoints(finalLineToDraw)
                    .forEach((point: IPoint) => DrawUtil.drawCircleWithFill(this.canvas, point,
                        Settings.RESIZE_HANDLE_DIMENSION_PX/2, anchorColor));
                
                // 显示长度信息
                this.drawLengthLabel(finalLineToDraw, RenderEngineSettings.LINE_SNAP_COLOR);
            } else {
                // 正常状态：使用常规绘制
                this.drawLine(activeLabelLine.labelId, finalLineToDraw, true, activeLabelLine.isCreatedByAI)
                
                // 调整大小时也显示实时长度
                const lineColor = BaseRenderEngine.resolveLabelLineColor(activeLabelLine.labelId, true, activeLabelLine.isCreatedByAI);
                this.drawLengthLabel(finalLineToDraw, lineColor);
            }
        }
    }

    private updateCursorStyle(data: EditorData) {
        if (!!this.canvas && !!data.mousePositionOnViewPortContent && !GeneralSelector.getImageDragModeStatus()) {
            const isMouseOverCanvas: boolean = RenderEngineUtil.isMouseOverCanvas(data);
            if (isMouseOverCanvas) {
                const anchorTypeUnderMouse = this.getAnchorTypeUnderMouse(data);
                if (!this.isInProgress() && !!anchorTypeUnderMouse) {
                    store.dispatch(updateCustomCursorStyle(CustomCursorStyle.MOVE));
                } else if (this.isResizeInProgress()) {
                    store.dispatch(updateCustomCursorStyle(CustomCursorStyle.MOVE));
                } else {
                    RenderEngineUtil.wrapDefaultCursorStyleInCancel(data);
                }
                this.canvas.style.cursor = 'none';
            } else {
                this.canvas.style.cursor = 'default';
            }
        }
    }

    private drawLine(labelId: string, line: ILine, isActive: boolean, isCreatedByAI: boolean = false) {
        const lineColor: string = BaseRenderEngine.resolveLabelLineColor(labelId, isActive, isCreatedByAI)
        const anchorColor = BaseRenderEngine.resolveLabelAnchorColor(isActive)
        const standardizedLine: ILine = {
            start: RenderEngineUtil.setPointBetweenPixels(line.start),
            end: RenderEngineUtil.setPointBetweenPixels(line.end)
        }
        DrawUtil.drawLine(this.canvas, standardizedLine.start, standardizedLine.end, lineColor, RenderEngineSettings.LINE_THICKNESS);
        
        // 显示长度标签（激活状态或正在调整大小时）
        if (isActive) {
            LineUtil
                .getPoints(line)
                .forEach((point: IPoint) => DrawUtil.drawCircleWithFill(this.canvas, point,
                    Settings.RESIZE_HANDLE_DIMENSION_PX/2, anchorColor));
            
            // 显示长度信息
            this.drawLengthLabel(standardizedLine, lineColor);
        }
    }

    /**
     * 绘制线条长度标签
     * @param line 线条对象
     * @param color 文本颜色
     */
    private drawLengthLabel(line: ILine, color: string) {
        const length = LineUtil.getPixelLength(line);
        
        // 只有当线条长度大于最小阈值时才显示长度
        if (length < 10) {
            return;
        }
        
        const lengthText = LineUtil.formatLengthText(length);
        const labelPosition = LineUtil.getLengthLabelPosition(line, 20);
        
        // 绘制半透明背景
        const textMetrics = this.canvas.getContext('2d');
        textMetrics.font = '12px Arial';
        const textWidth = textMetrics.measureText(lengthText).width;
        const padding = 4;
        
        DrawUtil.drawRectWithFill(this.canvas, {
            x: labelPosition.x - textWidth/2 - padding,
            y: labelPosition.y - 8 - padding,
            width: textWidth + 2 * padding,
            height: 16 + 2 * padding
        }, 'rgba(0, 0, 0, 0.7)');
        
        // 绘制长度文本
        DrawUtil.drawText(
            this.canvas,
            lengthText,
            12,
            labelPosition,
            color,
            false,
            'center'
        );
    }

    // =================================================================================================================
    // VALIDATORS
    // =================================================================================================================

    public isInProgress(): boolean {
        return !!this.lineCreationStartPoint
    }

    public isResizeInProgress(): boolean {
        return !!this.lineUpdateAnchorType;
    }

    // =================================================================================================================
    // CREATION
    // =================================================================================================================

    private startNewLabelCreation = (data: EditorData) => {
        this.lineCreationStartPoint = RenderEngineUtil.setPointBetweenPixels(data.mousePositionOnViewPortContent)
        EditorActions.setViewPortActionsDisabledStatus(true);
    }

    private finishNewLabelCreation = (data: EditorData) => {
        const mousePositionOnCanvasSnapped: IPoint = RectUtil.snapPointToRect(
            data.mousePositionOnViewPortContent, data.viewPortContentImageRect
        );
        const originalLineOnCanvas = {start: this.lineCreationStartPoint, end: mousePositionOnCanvasSnapped}
        
        // 应用磁性吸附
        const snapResult = LineUtil.snapLineToAxis(originalLineOnCanvas);
        const finalLineOnCanvas = snapResult.snappedLine;
        
        const lineOnImage = RenderEngineUtil.transferLineFromViewPortContentToImage(finalLineOnCanvas, data);
        const activeLabelId = LabelsSelector.getActiveLabelNameId();
        const imageData: ImageData = LabelsSelector.getActiveImageData();
        const labelLine: LabelLine = {
            id: uuidv4(),
            labelId: activeLabelId,
            line: lineOnImage,
            isVisible: true
        };
        imageData.labelLines.push(labelLine);
        store.dispatch(updateImageDataById(imageData.id, imageData));
        store.dispatch(updateFirstLabelCreatedFlag(true));
        store.dispatch(updateActiveLabelId(labelLine.id));
        this.lineCreationStartPoint = null
        EditorActions.setViewPortActionsDisabledStatus(false);
    };

    public cancelLabelCreation() {
        this.lineCreationStartPoint = null
        EditorActions.setViewPortActionsDisabledStatus(false);
    }

    // =================================================================================================================
    // UPDATE
    // =================================================================================================================

    private startExistingLabelUpdate(labelId: string, anchorType: LineAnchorType) {
        store.dispatch(updateActiveLabelId(labelId));
        this.lineUpdateAnchorType = anchorType;
        EditorActions.setViewPortActionsDisabledStatus(true);
    }

    private endExistingLabelUpdate(data: EditorData) {
        this.applyUpdateToLineLabel(data);
        this.lineUpdateAnchorType = null;
        EditorActions.setViewPortActionsDisabledStatus(false);
    }

    private applyUpdateToLineLabel(data: EditorData) {
        const imageData: ImageData = LabelsSelector.getActiveImageData();
        const activeLabel: LabelLine = LabelsSelector.getActiveLineLabel();
        if (!imageData || !activeLabel) return;
        imageData.labelLines = imageData.labelLines.map((lineLabel: LabelLine) => {
            if (lineLabel.id !== activeLabel.id) {
                return lineLabel
            } else {
                const snappedMousePosition: IPoint =
                    RectUtil.snapPointToRect(data.mousePositionOnViewPortContent, data.viewPortContentImageRect);
                
                // 构建调整后的线条（在画布坐标系）
                const lineOnCanvas = RenderEngineUtil.transferLineFromImageToViewPortContent(lineLabel.line, data);
                const originalUpdatedLine = {
                    start: this.lineUpdateAnchorType === LineAnchorType.START ? snappedMousePosition : lineOnCanvas.start,
                    end: this.lineUpdateAnchorType === LineAnchorType.END ? snappedMousePosition : lineOnCanvas.end
                };
                
                // 应用磁性吸附
                const snapResult = LineUtil.snapLineToAxis(originalUpdatedLine);
                const finalUpdatedLine = snapResult.snappedLine;
                
                // 转换回图像坐标系
                const finalLineOnImage = RenderEngineUtil.transferLineFromViewPortContentToImage(finalUpdatedLine, data);
                
                return {
                    ...lineLabel,
                    line: finalLineOnImage
                }
            }
        });

        store.dispatch(updateImageDataById(imageData.id, imageData));
        store.dispatch(updateActiveLabelId(activeLabel.id));
    }

    // =================================================================================================================
    // GETTERS
    // =================================================================================================================

    private getLineUnderMouse(data: EditorData): LabelLine | null {
        const mouseOnCanvas = data.mousePositionOnViewPortContent;
        if (!mouseOnCanvas) return null;

        const labelLines: LabelLine[] = LabelsSelector
            .getActiveImageData()
            .labelLines
            .filter((labelLine: LabelLine) => labelLine.isVisible);
        const radius = RenderEngineSettings.anchorHoverSize.width / 2;

        for (const labelLine of labelLines) {
            const lineOnCanvas: ILine = RenderEngineUtil.transferLineFromImageToViewPortContent(labelLine.line, data);
            if (RenderEngineUtil.isMouseOverLine(mouseOnCanvas, lineOnCanvas, radius)) return labelLine;
        }
        return null;
    }

    private getAnchorTypeUnderMouse(data: EditorData): LineAnchorType | null {
        const mouseOnCanvas = data.mousePositionOnViewPortContent;
        if (!mouseOnCanvas) return null;

        const labelLines: LabelLine[] = LabelsSelector
            .getActiveImageData()
            .labelLines
            .filter((labelLine: LabelLine) => labelLine.isVisible);
        const radius = RenderEngineSettings.anchorHoverSize.width / 2;

        for (const labelLine of labelLines) {
            const lineOnCanvas: ILine = RenderEngineUtil.transferLineFromImageToViewPortContent(labelLine.line, data);
            if (RenderEngineUtil.isMouseOverAnchor(mouseOnCanvas, lineOnCanvas.start, radius)) {
                return LineAnchorType.START
            }
            if (RenderEngineUtil.isMouseOverAnchor(mouseOnCanvas, lineOnCanvas.end, radius)) {
                return LineAnchorType.END
            }
        }
        return null;
    }
}
