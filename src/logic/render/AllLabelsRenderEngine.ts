import {EditorData} from '../../data/EditorData';
import {BaseRenderEngine} from './BaseRenderEngine';
import {LabelType} from '../../data/enums/LabelType';
import {RectRenderEngine} from './RectRenderEngine';
import {PointRenderEngine} from './PointRenderEngine';
import {LineRenderEngine} from './LineRenderEngine';

/**
 * 全部标签渲染引擎
 * 组合使用所有专门的渲染引擎来显示和编辑所有类型的标签
 */
export class AllLabelsRenderEngine extends BaseRenderEngine {

    private rectEngine: RectRenderEngine;
    private pointEngine: PointRenderEngine;
    private lineEngine: LineRenderEngine;

    public constructor(canvas: HTMLCanvasElement) {
        super(canvas);
        this.labelType = LabelType.ALL;

        // 创建所有专门的渲染引擎实例
        this.rectEngine = new RectRenderEngine(canvas);
        this.pointEngine = new PointRenderEngine(canvas);
        this.lineEngine = new LineRenderEngine(canvas);
    }

    // =================================================================================================================
    // EVENT HANDLERS
    // =================================================================================================================

    public update(data: EditorData): void {
        // 按优先级顺序检查各种标签的交互
        // 1. 先检查矩形框（因为ALL工具主要用于绘制矩形框）
        this.rectEngine.update(data);

        // 2. 如果矩形框没有处理，检查点
        if (!this.rectEngine.isInProgress()) {
            this.pointEngine.update(data);
        }

        // 3. 如果点没有处理，检查线条
        if (!this.rectEngine.isInProgress() && !this.pointEngine.isInProgress()) {
            this.lineEngine.update(data);
        }
    }

    public render(data: EditorData): void {
        // 渲染所有类型的标签
        this.rectEngine.render(data);
        this.pointEngine.render(data);
        this.lineEngine.render(data);
    }

    public isInProgress(): boolean {
        return this.rectEngine.isInProgress() ||
               this.pointEngine.isInProgress() ||
               this.lineEngine.isInProgress();
    }
}
