import classNames from "classnames";
import React from 'react';
import { connect } from "react-redux";
import { ClipLoader } from "react-spinners";
import { ImageLoadManager } from "../../../../logic/imageRepository/ImageLoadManager";
import { IRect } from "../../../../interfaces/IRect";
import { ISize } from "../../../../interfaces/ISize";
import { ImageRepository } from "../../../../logic/imageRepository/ImageRepository";
import { AppState } from "../../../../store";
import { updateImageDataById, deleteImageById, deleteSelectedImages } from "../../../../store/labels/actionCreators";
import { ImageData } from "../../../../store/labels/types";
import { FileUtil } from "../../../../utils/FileUtil";
import { RectUtil } from "../../../../utils/RectUtil";
import { EditorModel } from "../../../../staticModels/EditorModel";
import { FrameExtractorService } from "../../../../services/FrameExtractorService";
import './ImagePreview.scss';
import { CSSHelper } from "../../../../logic/helpers/CSSHelper";

interface IProps {
    imageData: ImageData;
    style: React.CSSProperties;
    size: ISize;
    isScrolling?: boolean;
    isChecked?: boolean;
    isInferred?: boolean;
    onClick?: () => any;
    isSelected?: boolean;
    isMultiSelected?: boolean;
    isFirstSelected?: boolean;
    updateImageDataById: (id: string, newImageData: ImageData) => any;
    deleteImageById: (id: string) => any;
    deleteSelectedImages: () => any;
}

interface IState {
    image: HTMLImageElement;
}

class ImagePreview extends React.Component<IProps, IState> {
    private isLoading: boolean = false;

    constructor(props) {
        super(props);

        this.state = {
            image: null,
        }
    }

    public componentDidMount(): void {
        ImageLoadManager.addAndRun(this.loadImage(this.props.imageData, this.props.isScrolling));
    }

    public UNSAFE_componentWillUpdate(nextProps: Readonly<IProps>, nextState: Readonly<IState>, nextContext: any): void {
        if (this.props.imageData.id !== nextProps.imageData.id) {
            this.setState({ image: null });
            ImageLoadManager.addAndRun(this.loadImage(nextProps.imageData, nextProps.isScrolling));
        }
        else if (!this.props.imageData.loadStatus && nextProps.imageData.loadStatus) {
            ImageLoadManager.addAndRun(this.loadImage(nextProps.imageData, nextProps.isScrolling));
        }
        // Evicted-detection: when LRU drops this image (src cleared) we still
        // hold the stale HTMLImageElement reference; on the NEXT re-render the
        // <img src=""> would render as broken. Drop our reference + reload.
        else if (this.state.image && !this.state.image.src && !this.isLoading) {
            this.setState({ image: null });
            ImageLoadManager.addAndRun(this.loadImage(nextProps.imageData, nextProps.isScrolling));
        }

        if (this.props.isScrolling && !nextProps.isScrolling) {
            ImageLoadManager.addAndRun(this.loadImage(nextProps.imageData, false));
        }
    }

    shouldComponentUpdate(nextProps: Readonly<IProps>, nextState: Readonly<IState>, nextContext: any): boolean {
        return (
            this.props.imageData.id !== nextProps.imageData.id ||
            this.props.imageData.loadStatus !== nextProps.imageData.loadStatus ||
            this.props.imageData.isSelected !== nextProps.imageData.isSelected ||
            this.props.imageData.isVisitedByRoboflowAPI !== nextProps.imageData.isVisitedByRoboflowAPI ||
            this.props.imageData.labelRects?.length !== nextProps.imageData.labelRects?.length ||
            this.props.imageData.labelPolygons?.length !== nextProps.imageData.labelPolygons?.length ||
            this.state.image !== nextState.image ||
            this.props.isSelected !== nextProps.isSelected ||
            this.props.isChecked !== nextProps.isChecked ||
            this.props.isMultiSelected !== nextProps.isMultiSelected
        )
    }

    private loadImage = async (imageData: ImageData, isScrolling: boolean) => {
        if (imageData.loadStatus) {
            const image = ImageRepository.getById(imageData.id);
            if (image && this.state.image !== image) {
                this.setState({ image });
            }
            // 如果 loadStatus 为 true 但 image 不在 repository（缓存丢失），尝试重新加载
            if (!image && imageData.fileData && !imageData.fileData.type.startsWith('video/')) {
                this.isLoading = true;
                FileUtil.loadImage(imageData.fileData)
                    .then((img: HTMLImageElement) => this.saveLoadedImage(img, imageData))
                    .catch(() => this.handleLoadImageError());
            }
        }
        else if (!isScrolling || !this.isLoading) {
            // 视频文件无法通过 FileUtil.loadImage 加载，跳过
            // 同时检查 MIME 类型和扩展名（IndexedDB 恢复后 type 可能丢失）
            if (imageData.fileData && (
                imageData.fileData.type.startsWith('video/') ||
                /\.(mp4|webm|mov|avi|mkv|m4v|ogg)$/i.test(imageData.fileData.name)
            )) {
                return;
            }
            // 0字节占位文件 = on-demand 视频帧 → 从后端按需拉取缩略图
            if (imageData.fileData && imageData.fileData.size === 0) {
                this.loadVideoFrameThumbnail(imageData);
                return;
            }
            this.isLoading = true;
            const saveLoadedImagePartial = (image: HTMLImageElement) => this.saveLoadedImage(image, imageData);
            FileUtil.loadImage(imageData.fileData)
                .then((image: HTMLImageElement) => saveLoadedImagePartial(image))
                .catch((error) => this.handleLoadImageError(imageData, error))
        }
    };

    private loadVideoFrameThumbnail = async (imageData: ImageData) => {
        const sessionId = EditorModel.videoSessionId;
        if (!sessionId || this.isLoading) return;

        const match = imageData.fileData?.name?.match(/frame_(\d+)/);
        if (!match) return;
        const frameIdx = parseInt(match[1], 10);

        this.isLoading = true;
        try {
            const frames = await FrameExtractorService.fetchFrameRange(sessionId, frameIdx, 1);
            if (!frames || frames.length === 0) { this.isLoading = false; return; }
            const blob = frames[0] as Blob;
            const fullUrl = URL.createObjectURL(blob);
            const fullImg = new Image();
            fullImg.onload = () => {
                // Downscale to thumbnail size (~200px) to save memory.
                // Full-size frames (e.g. 2560×1440 ≈ 15MB decoded) are wasteful
                // for sidebar thumbnails displayed at ~150×84px.
                const THUMB_MAX = 200;
                const scale = Math.min(THUMB_MAX / fullImg.naturalWidth, THUMB_MAX / fullImg.naturalHeight, 1);
                const tw = Math.round(fullImg.naturalWidth * scale);
                const th = Math.round(fullImg.naturalHeight * scale);
                const thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = tw;
                thumbCanvas.height = th;
                const ctx = thumbCanvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(fullImg, 0, 0, tw, th);
                }
                URL.revokeObjectURL(fullUrl); // Release full-size blob

                // Async toBlob instead of sync toDataURL to avoid blocking main thread
                thumbCanvas.toBlob((blob) => {
                    if (!blob) { this.handleLoadImageError(); return; }
                    const blobUrl = URL.createObjectURL(blob);
                    const thumbImg = new Image();
                    thumbImg.onload = () => {
                        URL.revokeObjectURL(blobUrl);
                        this.saveLoadedImage(thumbImg, imageData);
                    };
                    thumbImg.onerror = () => {
                        URL.revokeObjectURL(blobUrl);
                        this.handleLoadImageError();
                    };
                    thumbImg.src = blobUrl;
                }, 'image/jpeg', 0.6);
            };
            fullImg.onerror = () => {
                URL.revokeObjectURL(fullUrl);
                this.handleLoadImageError();
            };
            fullImg.src = fullUrl;
        } catch {
            this.isLoading = false;
        }
    };

    private saveLoadedImage = (image: HTMLImageElement, imageData: ImageData) => {
        const updated = { ...imageData, loadStatus: true };
        this.props.updateImageDataById(updated.id, updated);
        ImageRepository.storeImage(imageData.id, image);
        if (imageData.id === this.props.imageData.id) {
            this.setState({ image });
            this.isLoading = false;
        }
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

    private handleLoadImageError = (imageData?: ImageData, error?: any) => {
        this.isLoading = false;
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
        const hasManual = allLabels.some((l: any) => !l.isCreatedByAI);
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
            isChecked,
            style,
            onClick
        } = this.props;

        return (
            <div
                className={this.getClassName()}
                style={style}
                onClick={onClick ? onClick : undefined}
            >
                {(!!this.state.image) ?
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
                    <ClipLoader
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

const mapStateToProps = (state: AppState) => ({});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ImagePreview);