import {IRect} from '../../interfaces/IRect';
import {PrimaryEditorRenderEngine} from './PrimaryEditorRenderEngine';
import {VideoSelector} from '../../store/selectors/VideoSelector';

/**
 * 视频模式的主渲染引擎
 * 继承自 PrimaryEditorRenderEngine
 * - 播放时不绘制背景图像（由下层 VideoPlayer 高帧率显示）
 * - 暂停时绘制背景图像（使缩放时视频帧与标注框同步缩放）
 */
export class VideoPrimaryRenderEngine extends PrimaryEditorRenderEngine {

    public constructor(canvas: HTMLCanvasElement) {
        super(canvas);
    }

    public drawImage(image: HTMLImageElement, imageRect: IRect) {
        if (VideoSelector.isVideoPlaying()) {
            // 播放中：保持透明，让下层 VideoPlayer 显示视频帧
            return;
        }
        // 暂停时：在标注画布上绘制视频帧，使其跟随缩放
        super.drawImage(image, imageRect);
    }
}



























