import {IRect} from '../../interfaces/IRect';
import {PrimaryEditorRenderEngine} from './PrimaryEditorRenderEngine';
import {VideoSelector} from '../../store/selectors/VideoSelector';
import {EditorModel} from '../../staticModels/EditorModel';
import {ViewPortActions} from '../actions/ViewPortActions';

/**
 * Native playback stays on the compositor; the canvas renders annotations and paused frames.
 */
export class VideoPrimaryRenderEngine extends PrimaryEditorRenderEngine {
    private nativeGeometry = '';
    private nativeVideo: HTMLVideoElement | null = null;

    public constructor(canvas: HTMLCanvasElement) {
        super(canvas);
    }

    private positionNativeVideo(video: HTMLVideoElement, imageRect: IRect): boolean {
        const host = video.parentElement;
        if (!host) return false;
        const geometry = JSON.stringify([imageRect, EditorModel.viewPortSize, ViewPortActions.getAbsoluteScrollPosition()]);
        if (geometry !== this.nativeGeometry || video !== this.nativeVideo || video.style.position !== 'absolute') {
            const canvasBounds = this.canvas.getBoundingClientRect();
            const hostBounds = host.getBoundingClientRect();
            Object.assign(video.style, {
                position: 'absolute',
                left: `${canvasBounds.left - hostBounds.left + imageRect.x}px`,
                top: `${canvasBounds.top - hostBounds.top + imageRect.y}px`,
                width: `${imageRect.width}px`,
                height: `${imageRect.height}px`,
                maxWidth: 'none', maxHeight: 'none',
            });
            this.nativeGeometry = geometry;
            this.nativeVideo = video;
        }
        return true;
    }

    public drawImage(image: HTMLImageElement, imageRect: IRect) {
        if (!imageRect) return;
        const video = EditorModel.videoElement;
        if (VideoSelector.isVideoPlaying() && video && !video.paused && video.readyState >= 2) {
            if (this.positionNativeVideo(video, imageRect)) return;
            this.canvas.getContext('2d')?.drawImage(video, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
            return;
        }
        if (video && EditorModel.videoFrameCanvas) {
            this.canvas.getContext('2d')?.drawImage(EditorModel.videoFrameCanvas, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
            return;
        }
        const src = VideoSelector.isVideoPlaying()
            ? (EditorModel.videoFrameImage || image)
            : image;
        super.drawImage(src, imageRect);
    }
}



























