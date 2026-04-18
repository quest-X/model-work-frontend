import {IRect} from '../../interfaces/IRect';
import {PrimaryEditorRenderEngine} from './PrimaryEditorRenderEngine';
import {VideoSelector} from '../../store/selectors/VideoSelector';
import {EditorModel} from '../../staticModels/EditorModel';

/**
 * 视频模式的主渲染引擎：播放时改用 videoFrameImage 作为底图源，让画布在 zoom>1 时也能正确渲染当前帧
 */
export class VideoPrimaryRenderEngine extends PrimaryEditorRenderEngine {

    public constructor(canvas: HTMLCanvasElement) {
        super(canvas);
    }

    public drawImage(image: HTMLImageElement, imageRect: IRect) {
        if (!imageRect) return;
        const src = VideoSelector.isVideoPlaying()
            ? (EditorModel.videoFrameImage || image)
            : image;
        super.drawImage(src, imageRect);
    }
}



























