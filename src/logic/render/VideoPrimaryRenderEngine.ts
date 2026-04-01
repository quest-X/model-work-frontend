import {IRect} from '../../interfaces/IRect';
import {PrimaryEditorRenderEngine} from './PrimaryEditorRenderEngine';

/**
 * 视频模式的主渲染引擎
 * 继承自 PrimaryEditorRenderEngine，但不绘制背景图像（因为视频已经在下层显示）
 */
export class VideoPrimaryRenderEngine extends PrimaryEditorRenderEngine {

    public constructor(canvas: HTMLCanvasElement) {
        super(canvas);
    }

    /**
     * 重写 drawImage 方法，在视频模式下不绘制背景图像
     * 因为视频已经在下层的 VideoPlayer 中显示了
     */
    public drawImage(image: HTMLImageElement, imageRect: IRect) {
        // 在视频模式下不绘制背景图像，保持透明以显示下层的视频
        // 只渲染标注层
    }
}



























