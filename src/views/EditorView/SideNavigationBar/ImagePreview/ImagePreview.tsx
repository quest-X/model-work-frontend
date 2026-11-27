import classNames from "classnames";
import React from 'react';
import { connect } from "react-redux";
import { ClipLoader } from "react-spinners";
import { ImageLoadManager } from "../../../../logic/imageRepository/ImageLoadManager";
import { IRect } from "../../../../interfaces/IRect";
import { ISize } from "../../../../interfaces/ISize";
import { ImageRepository } from "../../../../logic/imageRepository/ImageRepository";
import { updateImageDataById, deleteImageById, deleteSelectedImages } from "../../../../store/labels/actionCreators";
import { ImageData } from "../../../../store/labels/types";
import { FileUtil } from "../../../../utils/FileUtil";
import { RectUtil } from "../../../../utils/RectUtil";
import { EditorModel } from "../../../../staticModels/EditorModel";
import { FrameExtractorService } from "../../../../services/FrameExtractorService";
import './ImagePreview.scss';
import { CSSHelper } from "../../../../logic/helpers/CSSHelper";
import {getVideoThumbnailSize} from "../../../../utils/VideoThumbnailUtil";
import {store} from "../../../../index";
import {AppState} from '../../../../store';
import {Language} from '../../../../data/LanguageConfig';
import {VideoThumbnailService} from '../../../../services/VideoThumbnailService';

interface IProps {
    imageData: ImageData;
    imageIndex?: number;
    style: React.CSSProperties;
    size: ISize;
    isScrolling?: boolean;
    isChecked?: boolean;
    isInferred?: boolean;
    onClick?: () => void;
    isSelected?: boolean;
    isMultiSelected?: boolean;
    isFirstSelected?: boolean;
    updateImageDataById: typeof updateImageDataById;
    deleteImageById: typeof deleteImageById;
    deleteSelectedImages: typeof deleteSelectedImages;
    language?: Language;
}

interface IState {
    image: HTMLImageElement;
    loadFailed: boolean;
}

export class ImagePreview extends React.Component<IProps, IState> {
    private isLoading: boolean = false;
    private loadingImageId: string | null = null;
    private loadingGeneration: number = 0;
    private requestGeneration: number = 0;
    private mounted: boolean = false;
    private thumbnailAbort: AbortController | null = null;

    constructor(props: IProps) {
        super(props);

        this.state = {
            image: null,
            loadFailed: false,
        }
    }

    public componentDidMount(): void {
        this.mounted = true;
        ImageLoadManager.addAndRun(this.loadImage(this.props.imageData));
    }

    public componentWillUnmount(): void {
        this.mounted = false;
        this.requestGeneration++;
        this.thumbnailAbort?.abort();
        this.isLoading = false;
        this.loadingImageId = null;
    }

    public componentDidUpdate(prevProps: Readonly<IProps>): void {
        if (prevProps.imageData.id !== this.props.imageData.id) {
            this.setState({ image: null });
            ImageLoadManager.addAndRun(this.loadImage(this.props.imageData));
        }
        else if (!prevProps.imageData.loadStatus && this.props.imageData.loadStatus) {
            ImageLoadManager.addAndRun(this.loadImage(this.props.imageData));
        }
        // Evicted-detection: when LRU drops this image (src cleared) we still
        // hold the stale HTMLImageElement reference; on the NEXT re-render the
        // <img src=""> would render as broken. Drop our reference + reload.
        else if (
            this.state.image &&
            !this.state.image.getAttribute('src') &&
            this.loadingImageId !== this.props.imageData.id
        ) {
            this.setState({ image: null });
            ImageLoadManager.addAndRun(this.loadImage(this.props.imageData));
        }

        if (prevProps.isScrolling && !this.props.isScrolling) {
            ImageLoadManager.addAndRun(this.loadImage(this.props.imageData));
        }
    }

    shouldComponentUpdate(nextProps: Readonly<IProps>, nextState: Readonly<IState>): boolean {
        return (
            this.props.imageData !== nextProps.imageData ||
            this.state.image !== nextState.image ||
            this.state.loadFailed !== nextState.loadFailed ||
            this.props.language !== nextProps.language ||
            this.props.isSelected !== nextProps.isSelected ||
            this.props.isChecked !== nextProps.isChecked ||
            this.props.isMultiSelected !== nextProps.isMultiSelected ||
            this.props.isFirstSelected !== nextProps.isFirstSelected ||
            this.props.isScrolling !== nextProps.isScrolling ||
            this.props.size.width !== nextProps.size.width ||
            this.props.size.height !== nextProps.size.height ||
            this.props.style.left !== nextProps.style.left ||
            this.props.style.top !== nextProps.style.top ||
            this.props.style.width !== nextProps.style.width ||
            this.props.style.height !== nextProps.style.height
        )
    }

    private loadImage = async (imageData: ImageData) => {
        const cachedImage = ImageRepository.getById(imageData.id);
        if (cachedImage) {
            // Playback may publish this thumbnail while an older sidebar fetch is pending.
            // Let the cache win immediately and invalidate the older request.
            ++this.requestGeneration;
            this.thumbnailAbort?.abort();
            this.isLoading = false;
            this.loadingImageId = null;
            if (this.state.image !== cachedImage) this.setState({ image: cachedImage });
            return;
        }
        if (this.isLoading && this.loadingImageId === imageData.id) return;
        this.thumbnailAbort?.abort();
        if (this.state.loadFailed) this.setState({loadFailed: false});
        const generation = ++this.requestGeneration;
        this.loadMissingImage(imageData, generation);
    };

    private loadMissingImage = (imageData: ImageData, generation: number) => {
        const file = imageData.fileData;
        if (!file) { this.handleLoadImageError(imageData, generation, new Error('Image file unavailable')); return; }
        // 0字节占位文件 = on-demand 视频帧；即使 Redux 仍标记 loadStatus=true，
        // LRU 淘汰后也必须从后端重新生成缩略图。
        if (file.size === 0) {
            this.loadVideoFrameThumbnail(imageData, generation);
            return;
        }
        // 视频文件无法通过 FileUtil.loadImage 加载；同时检查扩展名以兼容
        // IndexedDB 恢复后 MIME type 丢失的情况。
        if (file.type.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv|m4v|ogg)$/i.test(file.name)) {
            this.handleLoadImageError(imageData, generation, new Error('Video frame file unavailable'));
            return;
        }
        this.startLoading(imageData.id, generation);
        FileUtil.loadImage(file)
            .then((image: HTMLImageElement) => this.saveLoadedImage(image, imageData, generation))
            .catch((error) => this.handleLoadImageError(imageData, generation, error));
    };

    private loadVideoFrameThumbnail = async (imageData: ImageData, generation: number) => {
        const sessionId = EditorModel.videoSessionId;
        this.startLoading(imageData.id, generation);
        try {
            const match = imageData.fileData?.name?.match(/frame_(\d+)/);
            if (!match) throw new Error('Video frame index unavailable');
            const frameIdx = parseInt(match[1], 10);
            const state = store.getState();
            const activeVideo = state.labels.imagesData[frameIdx]?.id === imageData.id ? state.video.activeVideo : null;
            let frameFile = EditorModel.videoFrameFiles[frameIdx] || activeVideo?.preExtractedFrames?.[frameIdx];
            if (!frameFile?.size && activeVideo?.fileData?.size) {
                const controller = new AbortController();
                this.thumbnailAbort = controller;
                try {
                    const blob = await VideoThumbnailService.capture(activeVideo.fileData, frameIdx / activeVideo.fps, controller.signal);
                    if (!this.isCurrentRequest(imageData.id, generation)) return;
                    const image = await FileUtil.loadImage(new File([blob], imageData.fileData.name, {type: blob.type}));
                    this.saveLoadedImage(image, imageData, generation);
                    return;
                } catch (error) {
                    if (controller.signal.aborted || !sessionId) throw error;
                }
            }
            if (!frameFile?.size) {
                if (!sessionId) throw new Error('Video source unavailable');
                const frames = await FrameExtractorService.fetchFrameRange(sessionId, frameIdx, 1);
                frameFile = frames?.[0];
            }
            if (!this.isCurrentRequest(imageData.id, generation)) return;
            if (!frameFile?.size) throw new Error('Video frame unavailable');
            const blob = frameFile as Blob;
            const fullUrl = URL.createObjectURL(blob);
            const fullImg = new Image();
            fullImg.onload = () => {
                if (!this.isCurrentRequest(imageData.id, generation)) {
                    URL.revokeObjectURL(fullUrl);
                    return;
                }
                // Downscale to thumbnail size (~200px) to save memory.
                // Full-size frames (e.g. 2560×1440 ≈ 15MB decoded) are wasteful
                // for sidebar thumbnails displayed at ~150×84px.
                const thumbnailSize = getVideoThumbnailSize(fullImg.naturalWidth, fullImg.naturalHeight);
                const thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = thumbnailSize.width;
                thumbCanvas.height = thumbnailSize.height;
                const ctx = thumbCanvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(fullImg, 0, 0, thumbnailSize.width, thumbnailSize.height);
                }
                URL.revokeObjectURL(fullUrl); // Release full-size blob

                // Async toBlob instead of sync toDataURL to avoid blocking main thread
                thumbCanvas.toBlob((thumbBlob) => {
                    if (!this.isCurrentRequest(imageData.id, generation)) return;
                    if (!thumbBlob) { this.handleLoadImageError(imageData, generation); return; }
                    const blobUrl = URL.createObjectURL(thumbBlob);
                    const thumbImg = new Image();
                    // 不撤销 blobUrl：<img src={image.src}> 渲染仍指向它，撤销会变破图
                    thumbImg.onload = () => this.saveLoadedImage(thumbImg, imageData, generation);
                    thumbImg.onerror = () => {
                        URL.revokeObjectURL(blobUrl);
                        this.handleLoadImageError(imageData, generation);
                    };
                    thumbImg.src = blobUrl;
                }, 'image/jpeg', 0.6);
            };
            fullImg.onerror = () => {
                URL.revokeObjectURL(fullUrl);
                this.handleLoadImageError(imageData, generation);
            };
            fullImg.src = fullUrl;
        } catch (error) {
            this.handleLoadImageError(imageData, generation, error);
        }
    };

    private startLoading = (imageId: string, generation: number) => {
        this.isLoading = true;
        this.loadingImageId = imageId;
        this.loadingGeneration = generation;
    };

    private finishLoading = (imageId: string, generation: number) => {
        if (this.loadingImageId !== imageId || this.loadingGeneration !== generation) return;
        this.isLoading = false;
        this.loadingImageId = null;
    };

    private isCurrentRequest = (imageId: string, generation: number): boolean =>
        this.mounted && generation === this.requestGeneration && imageId === this.props.imageData.id;

    private discardLoadedImage = (image: HTMLImageElement) => {
        const source = image.getAttribute('src');
        if (source?.startsWith('blob:')) URL.revokeObjectURL(source);
        image.src = '';
    };

    private saveLoadedImage = (image: HTMLImageElement, imageData: ImageData, generation: number) => {
        if (!this.isCurrentRequest(imageData.id, generation)) {
            this.discardLoadedImage(image);
            return;
        }
        // Inference may have added annotations since this thumbnail request started.
        const images = store.getState().labels.imagesData;
        const indexed = images[this.props.imageIndex ?? -1];
        const latest = indexed?.id === imageData.id ? indexed :
            images.find(frame => frame.id === imageData.id) || this.props.imageData;
        ImageRepository.storeImage(imageData.id, image);
        if (!latest.loadStatus) {
            this.props.updateImageDataById(latest.id, { ...latest, loadStatus: true });
        }
        if (imageData.id === this.props.imageData.id) {
            this.setState({ image });
        }
        this.finishLoading(imageData.id, generation);
    };

    private getStyle = () => {
        const { size } = this.props;

        const containerRect: IRect = {
            x: 0.15 * size.width,
            y: 0.15 * size.height,
            width: 0.7 * size.width,
            height: 0.7 * size.height
        };

        const imageRect: IRect = {
            x: 0,
            y: 0,
            width: this.state.image.width,
            height: this.state.image.height
        };

        const imageRatio = RectUtil.getRatio(imageRect);
        const imagePosition: IRect = RectUtil.fitInsideRectWithRatio(containerRect, imageRatio);

        return {
            width: imagePosition.width,
            height: imagePosition.height,
            left: imagePosition.x,
            top: imagePosition.y
        }
    };

    private handleLoadImageError = (imageData?: ImageData, generation?: number, error?: unknown) => {
        if (imageData && generation !== undefined && !this.isCurrentRequest(imageData.id, generation)) return;
        if (imageData && generation !== undefined) this.finishLoading(imageData.id, generation);
        else {
            this.isLoading = false;
            this.loadingImageId = null;
        }
        this.setState({loadFailed: true});
        if (imageData) {
            console.error(`[ImagePreview] 图像加载失败: ${imageData.fileData?.name} (size=${imageData.fileData?.size})`, error);
        }
    };

    private hasAnyLabels = (): boolean => {
        const { imageData } = this.props;
        return (imageData.labelRects?.length > 0) ||
               (imageData.labelPoints?.length > 0) ||
               (imageData.labelPolygons?.length > 0) ||
               (imageData.labelLines?.length > 0);
    };

    // 返回 'manual' | 'ai' | 'none'
    // 混合标注优先 manual（蓝色）
    private getLabelOrigin = (): 'manual' | 'ai' | 'none' => {
        const { imageData } = this.props;
        const allLabels = [
            ...(imageData.labelRects || []),
            ...(imageData.labelPoints || []),
            ...(imageData.labelPolygons || []),
            ...(imageData.labelLines || []),
        ];
        if (allLabels.length === 0) return 'none';
        const hasManual = allLabels.some((l) => !l.isCreatedByAI);
        if (hasManual) return 'manual';
        return 'ai';
    };

    private isAIProcessedImage = (): boolean => {
        const { imageData } = this.props;
        return imageData.isVisitedByRoboflowAPI;
    };

    private getClassName = () => {
        return classNames(
            "ImagePreview",
            {
                "selected": this.props.isSelected || this.props.isMultiSelected,
            }
        );
    };

    public render() {
        const {
            style,
            onClick
        } = this.props;
        const imageReady = Boolean(
            this.state.image?.getAttribute('src') &&
            this.state.image.width > 0 &&
            this.state.image.height > 0
        );

        return (
            <div
                className={this.getClassName()}
                style={style}
                onClick={onClick ? onClick : undefined}
            >
                {imageReady ?
                    [
                        <div
                            className="Foreground"
                            key={"Foreground"}
                            style={this.getStyle()}
                        >
                            <img
                                className="Image"
                                draggable={false}
                                src={this.state.image.src}
                                alt={this.state.image.alt}
                                style={{ ...this.getStyle(), left: 0, top: 0 }}
                            />
                            <div
                                className="DeleteButton"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (this.props.isMultiSelected && this.props.isFirstSelected) {
                                        this.props.deleteSelectedImages();
                                    } else {
                                        this.props.deleteImageById(this.props.imageData.id);
                                    }
                                }}
                            >
                                ✕
                            </div>
                            {this.getLabelOrigin() !== 'none' && (
                                <div className={
                                    this.getLabelOrigin() === 'manual' ? "ManualLabelIndicator" : "AILabelIndicator"
                                }>
                                    ✓
                                </div>
                            )}
                        </div>,
                        <div
                            className={`Background${this.getLabelOrigin() === 'manual' ? ' has-manual-labels' : this.getLabelOrigin() === 'ai' ? ' has-ai-labels' : ''}`}
                            key={"Background"}
                            style={this.getStyle()}
                        />
                    ] :
                    this.state.loadFailed ? <button
                        type="button"
                        className="ThumbnailRetry"
                        onClick={event => { event.stopPropagation(); this.loadImage(this.props.imageData); }}
                    >{this.props.language === Language.ENGLISH ? 'Load failed · Retry' : '加载失败 · 重试'}</button> : <ClipLoader
                        size={30}
                        color={CSSHelper.getLeadingColor()}
                        loading={true}
                    />}
            </div>)
    }
}

const mapDispatchToProps = {
    updateImageDataById,
    deleteImageById,
    deleteSelectedImages
};

const mapStateToProps = (state: AppState) => ({language: state.general.language});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ImagePreview);
