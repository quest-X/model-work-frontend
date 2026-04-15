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

/**
 * 全部标签渲染引擎
 * 组合使用所有专门的渲染引擎来显示和编辑所有类型的标签
 */
export class AllLabelsRenderEngine extends BaseRenderEngine {

    private rectEngine: RectRenderEngine;
    private pointEngine: PointRenderEngine;
    private lineEngine: LineRenderEngine;
    private polygonEngine: PolygonRenderEngine;

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
        // 普通 ALL 视图：鼠标事件交给 ViewPortHelper 做拖拽平移（hand 工具）
        if (EditorModel.viewPortHelper) {
            EditorModel.viewPortHelper.update(data);
        }
    }

    public render(data: EditorData): void {
        const isSmart = GeneralSelector.getSmartAnnotationActiveStatus();

        if (isSmart) {
            // 智能标注模式：完整 rectEngine.render（带 cursor 逻辑 + in-progress 矩形）
            this.rectEngine.render(data);
        } else {
            // 非智能标注 ALL 视图：纯绘制 rect + polygon，不 dispatch cursor
            // —— 避免 rectEngine.updateCursorStyle 与 hand-cursor dispatch 互相翻转造成无限循环
            this.rectEngine.drawExistingRects(data);
        }

        // 只读绘制多边形（不 dispatch 任何 action），保证 SAM / 全图分割结果在 ALL 视图下可见
        if (LabelsSelector.getActiveImageData()) {
            this.polygonEngine.drawExistingLabels(data);
        }

        // 非智能标注 ALL 视图下光标设为 hand（GRAB）—— 表示可以拖拽平移画布
        if (!isSmart
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
