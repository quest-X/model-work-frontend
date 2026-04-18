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
 */
export class AllLabelsRenderEngine extends BaseRenderEngine {

    private rectEngine: RectRenderEngine;
    private pointEngine: PointRenderEngine;
    private lineEngine: LineRenderEngine;
    private polygonEngine: PolygonRenderEngine;

    // ---- 精细擦除状态 ----
    /** 当前正在精细擦除的多边形 ID；null 表示未进入精细模式 */
    private eraserFinePolygonId: string | null = null;
    /** 上次单击（mousedown）的时间戳，用于双击检测 */
    private lastClickTime: number = 0;
    /** 上次单击命中的多边形 ID */
    private lastClickPolygonId: string | null = null;
    /** 鼠标是否处于按下状态（精细模式下拖拽擦除用） */
    private eraserMouseDown: boolean = false;
    /** 待执行的延迟单击删除 timer */
    private pendingDeleteTimer: ReturnType<typeof setTimeout> | null = null;
    /** 笔刷半径（canvas 像素） */
    private readonly BRUSH_RADIUS = 20;
    /** 双击判定时间窗口（ms） */
    private readonly DBLCLICK_MS = 350;

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

        // 橡皮擦模式
        if (GeneralSelector.getEraserMode()) {
            if (!data.event) return;
            const type = (data.event as MouseEvent).type;

            // ── mouseup：结束拖拽
            if (type === 'mouseup') {
                this.eraserMouseDown = false;
                return;
            }

            // ── mousemove：精细模式下按住拖拽擦除顶点
            if (type === 'mousemove') {
                if (this.eraserMouseDown && this.eraserFinePolygonId) {
                    const stillExists = this.polygonEngine.eraseVerticesNearPoint(
                        data, this.eraserFinePolygonId, this.BRUSH_RADIUS
                    );
                    if (!stillExists) {
                        this.eraserFinePolygonId = null;
                        this.eraserMouseDown = false;
                    }
                }
                return;
            }

            // ── mousedown：核心逻辑
            if (type === 'mousedown') {
                const me = data.event as MouseEvent;
                if (me.button !== 0) return;

                // 精细模式已激活
                if (this.eraserFinePolygonId) {
                    const polygonId = this.polygonEngine.getPolygonIdUnderMouse(data);
                    if (polygonId === this.eraserFinePolygonId) {
                        // 在精细模式多边形上按下：开始拖拽擦除
                        this.eraserMouseDown = true;
                        // 立即擦除一次（点击不移动也能删顶点）
                        const stillExists = this.polygonEngine.eraseVerticesNearPoint(
                            data, this.eraserFinePolygonId, this.BRUSH_RADIUS
                        );
                        if (!stillExists) {
                            this.eraserFinePolygonId = null;
                            this.eraserMouseDown = false;
                        }
                    } else {
                        // 点击到精细多边形之外 → 退出精细模式
                        this.eraserFinePolygonId = null;
                        this.eraserMouseDown = false;
                        // 若点击到其他矩形或多边形，执行普通删除
                        const erasedRect = this.rectEngine.eraserClick(data);
                        if (!erasedRect) {
                            const otherPolygonId = this.polygonEngine.getPolygonIdUnderMouse(data);
                            if (otherPolygonId) {
                                this.schedulePolygonDelete(data, otherPolygonId);
                            }
                        }
                    }
                    return;
                }

                // 未在精细模式：先检测矩形
                const erasedRect = this.rectEngine.eraserClick(data);
                if (erasedRect) {
                    // 矩形已删除，清空双击状态
                    this.clearClickTracking();
                    return;
                }

                // 检测多边形
                const polygonId = this.polygonEngine.getPolygonIdUnderMouse(data);
                if (!polygonId) {
                    // 点击空白区域，清空追踪
                    this.clearClickTracking();
                    return;
                }

                const now = Date.now();
                if (
                    polygonId === this.lastClickPolygonId &&
                    now - this.lastClickTime < this.DBLCLICK_MS
                ) {
                    // ── 双击：取消待执行的删除，进入精细模式
                    this.cancelPendingDelete();
                    this.eraserFinePolygonId = polygonId;
                    this.clearClickTracking();
                } else {
                    // ── 单击（第一次或不同多边形）：延迟删除（等待可能的第二击）
                    this.cancelPendingDelete(); // 取消对前一个多边形的待删除
                    this.lastClickTime = now;
                    this.lastClickPolygonId = polygonId;
                    const imageData = LabelsSelector.getActiveImageData();
                    if (imageData) {
                        const imageId = imageData.id;
                        this.pendingDeleteTimer = setTimeout(() => {
                            this.pendingDeleteTimer = null;
                            LabelActions.deletePolygonLabelById(imageId, polygonId);
                            // 如果刚好在精细模式下操作的是同一个多边形，退出精细模式
                            if (this.eraserFinePolygonId === polygonId) {
                                this.eraserFinePolygonId = null;
                            }
                            this.clearClickTracking();
                            // 触发重绘
                            EditorActions.fullRender();
                        }, this.DBLCLICK_MS);
                    }
                }
                return;
            }

            return;
        }

        // 普通 ALL 视图：鼠标事件交给 ViewPortHelper 做拖拽平移（hand 工具）
        if (EditorModel.viewPortHelper) {
            EditorModel.viewPortHelper.update(data);
        }
    }

    private clearClickTracking() {
        this.lastClickTime = 0;
        this.lastClickPolygonId = null;
    }

    private cancelPendingDelete() {
        if (this.pendingDeleteTimer !== null) {
            clearTimeout(this.pendingDeleteTimer);
            this.pendingDeleteTimer = null;
        }
    }

    private schedulePolygonDelete(_data: EditorData, polygonId: string) {
        const imageData = LabelsSelector.getActiveImageData();
        if (!imageData) return;
        const imageId = imageData.id;
        this.lastClickTime = Date.now();
        this.lastClickPolygonId = polygonId;
        this.pendingDeleteTimer = setTimeout(() => {
            this.pendingDeleteTimer = null;
            LabelActions.deletePolygonLabelById(imageId, polygonId);
            this.clearClickTracking();
            EditorActions.fullRender();
        }, this.DBLCLICK_MS);
    }

    public render(data: EditorData): void {
        const isSmart = GeneralSelector.getSmartAnnotationActiveStatus();
        // 按 viewType 过滤：检测标签只画矩形，分割标签只画多边形，查看全部都画
        const viewType = LabelsSelector.getActiveLabelViewType();
        const showRects = viewType === LabelType.ALL || viewType === LabelType.RECT;
        const showPolygons = viewType === LabelType.ALL || viewType === LabelType.POLYGON;

        if (showRects) {
            if (isSmart) {
                // 智能标注模式：完整 rectEngine.render（带 cursor 逻辑 + in-progress 矩形）
                this.rectEngine.render(data);
            } else {
                // 非智能标注 ALL 视图：纯绘制 rect，不 dispatch cursor
                // —— 避免 rectEngine.updateCursorStyle 与 hand-cursor dispatch 互相翻转造成无限循环
                this.rectEngine.drawExistingRects(data);
            }
        }

        // 只读绘制多边形（不 dispatch 任何 action），保证 SAM / 全图分割结果在 ALL 视图下可见
        if (showPolygons && (EditorModel.playbackImageData || LabelsSelector.getActiveImageData())) {
            this.polygonEngine.drawExistingLabels(data);
        }

        const isEraser = GeneralSelector.getEraserMode();

        // 精细擦除模式叠加层（在普通标签之上绘制高亮 + 笔刷圆圈）
        if (isEraser && this.eraserFinePolygonId) {
            this.polygonEngine.drawFineEraserOverlay(data, this.eraserFinePolygonId, this.BRUSH_RADIUS);
        }

        // 橡皮擦模式：crosshair 光标
        if (isEraser && !!this.canvas && !!data.mousePositionOnViewPortContent && RenderEngineUtil.isMouseOverCanvas(data)) {
            this.canvas.style.cursor = 'crosshair';
            const current = GeneralSelector.getCustomCursorStyle();
            if (current !== CustomCursorStyle.DEFAULT) {
                store.dispatch(updateCustomCursorStyle(CustomCursorStyle.DEFAULT));
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
