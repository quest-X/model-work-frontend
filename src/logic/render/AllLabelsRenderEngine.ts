import {EditorData} from '../../data/EditorData';
import {BaseRenderEngine} from './BaseRenderEngine';
import {LabelType} from '../../data/enums/LabelType';
import {RectRenderEngine} from './RectRenderEngine';
import {PointRenderEngine} from './PointRenderEngine';
import {LineRenderEngine} from './LineRenderEngine';
import {PolygonRenderEngine} from './PolygonRenderEngine';
import {LabelsSelector} from '../../store/selectors/LabelsSelector';
import {GeneralSelector} from '../../store/selectors/GeneralSelector';
import {EditorModel} from '../../staticModels/EditorModel';
import {store} from '../../index';
import {updateCustomCursorStyle} from '../../store/general/actionCreators';
import {CustomCursorStyle} from '../../data/enums/CustomCursorStyle';
import {RenderEngineUtil} from '../../utils/RenderEngineUtil';
import {LabelActions} from '../actions/LabelActions';
import {EditorActions} from '../actions/EditorActions';

/**
 * 全部标签渲染引擎
 * 组合使用所有专门的渲染引擎来显示和编辑所有类型的标签
 *
 * 橡皮擦状态机（由 TopNavBar 按钮控制，无画布双击检测）：
 *   eraserMode=false                → 普通 ALL 视图（hand 平移）
 *   eraserMode=true,  fine=false    → 整体擦除：单击删除整个多边形/矩形
 *   eraserMode=true,  fine=true     → 局部擦除：拖拽笔刷擦除任意多边形的顶点
 */
export class AllLabelsRenderEngine extends BaseRenderEngine {

    private rectEngine: RectRenderEngine;
    private pointEngine: PointRenderEngine;
    private lineEngine: LineRenderEngine;
    private polygonEngine: PolygonRenderEngine;

    /** 鼠标是否处于按下状态（局部擦除拖拽用） */
    private eraserMouseDown: boolean = false;
    /** 笔刷半径（canvas 像素） */
    private readonly BRUSH_RADIUS = 20;

    public constructor(canvas: HTMLCanvasElement) {
        super(canvas);
        this.labelType = LabelType.ALL;

        // 创建所有专门的渲染引擎实例
        this.rectEngine = new RectRenderEngine(canvas);
        this.pointEngine = new PointRenderEngine(canvas);
        this.lineEngine = new LineRenderEngine(canvas);
        this.polygonEngine = new PolygonRenderEngine(canvas);
    }

    // =================================================================================================================
    // EVENT HANDLERS
    // =================================================================================================================

    public update(data: EditorData): void {
        // 智能标注模式：事件路由到 rectEngine（保留 SAM prompt 劫持）
        if (GeneralSelector.getSmartAnnotationActiveStatus()) {
            this.rectEngine.update(data);
            return;
        }

        // 目标跟踪模式：同样路由到 rectEngine，让它的 mouseUpHandler 劫持 bbox 打开 popup
        if (GeneralSelector.getTrackingMode()) {
            this.rectEngine.update(data);
            return;
        }

        // 橡皮擦模式
        if (GeneralSelector.getEraserMode()) {
            if (!data.event) return;
            const type = (data.event as MouseEvent).type;
            const isFineMod = GeneralSelector.getEraserFineMode();

            if (type === 'mouseup') {
                this.eraserMouseDown = false;
                return;
            }

            // ── 局部擦除模式：拖拽笔刷擦除任意多边形的顶点
            if (isFineMod) {
                if (type === 'mousedown') {
                    const me = data.event as MouseEvent;
                    if (me.button !== 0) return;
                    this.eraserMouseDown = true;
                    this.polygonEngine.eraseVerticesNearPointAll(data, this.BRUSH_RADIUS);
                } else if (type === 'mousemove' && this.eraserMouseDown) {
                    this.polygonEngine.eraseVerticesNearPointAll(data, this.BRUSH_RADIUS);
                }
                return;
            }

            // ── 整体擦除模式：单击立即删除整个矩形或多边形
            if (type === 'mousedown') {
                const me = data.event as MouseEvent;
                if (me.button !== 0) return;
                const imageData = EditorModel.playbackImageData || LabelsSelector.getActiveImageData();
                if (!imageData) return;

                const erasedRect = this.rectEngine.eraserClick(data);
                if (!erasedRect) {
                    const polygonId = this.polygonEngine.getPolygonIdUnderMouse(data);
                    if (polygonId) {
                        LabelActions.deletePolygonLabelById(imageData.id, polygonId);
                        EditorActions.fullRender();
                    }
                }
            }
            return;
        }

        // 普通 ALL 视图：鼠标事件交给 ViewPortHelper 做拖拽平移（hand 工具）
        if (EditorModel.viewPortHelper) {
            EditorModel.viewPortHelper.update(data);
        }
    }

    public render(data: EditorData): void {
        const isSmart = GeneralSelector.getSmartAnnotationActiveStatus();
        const isTracking = GeneralSelector.getTrackingMode();
        const isEraser = GeneralSelector.getEraserMode();
        const isFineMod = GeneralSelector.getEraserFineMode();

        // 橡皮擦关闭时重置拖拽状态
        if (!isEraser) {
            this.eraserMouseDown = false;
        }

        // 按 viewType 过滤：检测标签只画矩形，分割标签只画多边形，查看全部都画
        const viewType = LabelsSelector.getActiveLabelViewType();
        const showRects = viewType === LabelType.ALL || viewType === LabelType.RECT;
        const showPolygons = viewType === LabelType.ALL || viewType === LabelType.POLYGON;

        if (showRects) {
            if (isSmart) {
                // 智能标注：完整 rectEngine.render（带 cursor 逻辑 + in-progress 矩形）
                this.rectEngine.render(data);
            } else if (isTracking) {
                // 目标跟踪：绘制已存在矩形 + 在建 bbox，跳过 cursor dispatch 避免无限渲染循环
                this.rectEngine.drawRectsAndInProgress(data);
            } else {
                // 非劫持 ALL 视图：纯绘制 rect，不 dispatch cursor
                this.rectEngine.drawExistingRects(data);
            }
        }

        // 只读绘制多边形（不 dispatch 任何 action），保证 SAM / 全图分割结果在 ALL 视图下可见
        if (showPolygons && (EditorModel.playbackImageData || LabelsSelector.getActiveImageData())) {
            this.polygonEngine.drawExistingLabels(data);
        }

        // 局部擦除模式：在所有标签之上绘制笔刷圆圈
        if (isEraser && isFineMod) {
            this.polygonEngine.drawFineEraserBrush(data, this.BRUSH_RADIUS);
        }

        // 橡皮擦模式光标（走 CustomCursor overlay 系统，与 GRAB 光标同一套机制）：
        //   整体擦除 → ERASER（eraser.png 图标）
        //   局部擦除 → ERASER_FINE（eraser-fine.png 图标）
        if (isEraser && !!this.canvas && !!data.mousePositionOnViewPortContent && RenderEngineUtil.isMouseOverCanvas(data)) {
            const target = isFineMod ? CustomCursorStyle.ERASER : CustomCursorStyle.ERASER_FINE;
            const current = GeneralSelector.getCustomCursorStyle();
            if (current !== target) {
                store.dispatch(updateCustomCursorStyle(target));
            }
            return;
        }

        // 非智能标注 ALL 视图下光标设为 hand（GRAB）—— 表示可以拖拽平移画布
        if (!isSmart && !isEraser
            && !!this.canvas
            && !!data.mousePositionOnViewPortContent
            && RenderEngineUtil.isMouseOverCanvas(data)) {
            const current = GeneralSelector.getCustomCursorStyle();
            // 只在当前不是 GRAB/GRABBING 时 dispatch，防止循环
            if (current !== CustomCursorStyle.GRAB && current !== CustomCursorStyle.GRABBING) {
                store.dispatch(updateCustomCursorStyle(CustomCursorStyle.GRAB));
            }
            this.canvas.style.cursor = 'none';
        }
    }

    public isInProgress(): boolean {
        return this.rectEngine.isInProgress() ||
               this.pointEngine.isInProgress() ||
               this.lineEngine.isInProgress();
    }
}
