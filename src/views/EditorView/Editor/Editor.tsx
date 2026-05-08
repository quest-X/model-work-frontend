import React from 'react';
import './Editor.scss';
import {ISize} from '../../../interfaces/ISize';
import {ImageData, LabelPoint, LabelRect} from '../../../store/labels/types';
import {FileUtil} from '../../../utils/FileUtil';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {updateImageDataById} from '../../../store/labels/actionCreators';
import {ImageRepository} from '../../../logic/imageRepository/ImageRepository';
import {LabelType} from '../../../data/enums/LabelType';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {CanvasUtil} from '../../../utils/CanvasUtil';
import {CustomCursorStyle} from '../../../data/enums/CustomCursorStyle';
import {ImageLoadManager} from '../../../logic/imageRepository/ImageLoadManager';
import {EventType} from '../../../data/enums/EventType';
import {EditorData} from '../../../data/EditorData';
import {EditorModel} from '../../../staticModels/EditorModel';
import {EditorActions} from '../../../logic/actions/EditorActions';
import {EditorUtil} from '../../../utils/EditorUtil';
import {ContextManager} from '../../../logic/hotkey/ContextManager';
import {ContextType} from '../../../data/enums/ContextType';
import Scrollbars from 'react-custom-scrollbars-2';
import {ViewPortActions} from '../../../logic/actions/ViewPortActions';
import {PlatformModel} from '../../../staticModels/PlatformModel';
import LabelControlPanel from '../LabelControlPanel/LabelControlPanel';
import {IPoint} from '../../../interfaces/IPoint';
import {RenderEngineUtil} from '../../../utils/RenderEngineUtil';
import {LabelStatus} from '../../../data/enums/LabelStatus';
import {isEqual} from 'lodash';
import {AIActions} from '../../../logic/actions/AIActions';
import {VideoSelector} from '../../../store/selectors/VideoSelector';

interface IProps {
    size: ISize;
    imageData: ImageData;
    activeLabelType: LabelType;
    updateImageDataById: (id: string, newImageData: ImageData) => any;
    activePopupType: PopupWindowType;
    activeLabelId: string;
    customCursorStyle: CustomCursorStyle;
    imageDragMode: boolean;
    zoom: number;
}

interface IState {
    viewPortSize: ISize;
    isMiddleMouseDragging: boolean;
    lastMiddleMousePosition: IPoint | null;
}

class Editor extends React.Component<IProps, IState> {

    constructor(props) {
        super(props);
        this.state = {
            viewPortSize: {
                width: 0,
                height: 0
            },
            isMiddleMouseDragging: false,
            lastMiddleMousePosition: null
        };
    }

    // =================================================================================================================
    // LIFE CYCLE
    // =================================================================================================================

    public componentDidMount(): void {
        this.mountEventListeners();

        const {imageData, activeLabelType} = this.props;

        ContextManager.switchCtx(ContextType.EDITOR);
        // 初始化时使用当前的绘制工具类型
        EditorActions.mountRenderEnginesAndHelpers(activeLabelType);
        ImageLoadManager.addAndRun(this.loadImage(imageData));
        ViewPortActions.resizeCanvas(this.props.size);

        // 视频模式下隐藏光标和坐标指示器
        if (VideoSelector.isVideoMode()) {
            if (EditorModel.cursor) EditorModel.cursor.style.display = "none";
            if (EditorModel.mousePositionIndicator) EditorModel.mousePositionIndicator.style.display = "none";
        }
    }

    public componentWillUnmount(): void {
        this.unmountEventListeners();
    }

    public componentDidUpdate(prevProps: Readonly<IProps>, prevState: Readonly<{}>, snapshot?: any): void {
        const {imageData, activeLabelType} = this.props;

        if (prevProps.imageData.id !== imageData.id) {
            // 视频播放中：画布已由 VideoEditor.handleVideoTimeUpdate 中的
            // EditorActions.fullRender() 直接重绘，无需再次渲染。
            // 跳过 loadImage 和 updateModelAndRender 以避免冗余开销。
            if (VideoSelector.isVideoPlaying() && EditorModel.videoFrameImage) {
                return;
            }
            EditorActions.setLoadingStatus(false);
            ImageLoadManager.addAndRun(this.loadImage(imageData));
        }

        if (prevProps.activeLabelType !== activeLabelType) {
            // 绘制工具改变时，始终切换渲染引擎到对应的工具类型
            EditorActions.swapSupportRenderingEngine(activeLabelType);
            AIActions.detect(imageData.id, ImageRepository.getById(imageData.id));
        }

        this.updateModelAndRender();
    }

    // =================================================================================================================
    // EVENT HANDLERS
    // =================================================================================================================

    private mountedCanvas: HTMLCanvasElement | null = null;

    private mountEventListeners() {
        // 先清理可能残留的旧 listener（防止 React 18 StrictMode 双重 mount 泄漏）
        this.unmountEventListeners();

        this.mountedCanvas = EditorModel.canvas;
        window.addEventListener(EventType.MOUSE_MOVE, this.update);
        window.addEventListener(EventType.MOUSE_UP, this.update);
        this.mountedCanvas.addEventListener(EventType.MOUSE_DOWN, this.update);
        this.mountedCanvas.addEventListener(EventType.MOUSE_WHEEL, this.handleWheelEvent);

        // 中键拖拽事件监听器
        this.mountedCanvas.addEventListener(EventType.MOUSE_DOWN, this.handleMiddleMouseDown);
        window.addEventListener(EventType.MOUSE_MOVE, this.handleMiddleMouseMove);
        window.addEventListener(EventType.MOUSE_UP, this.handleMiddleMouseUp);
    }

    private unmountEventListeners() {
        window.removeEventListener(EventType.MOUSE_MOVE, this.update);
        window.removeEventListener(EventType.MOUSE_UP, this.update);
        window.removeEventListener(EventType.MOUSE_MOVE, this.handleMiddleMouseMove);
        window.removeEventListener(EventType.MOUSE_UP, this.handleMiddleMouseUp);

        const cvs = this.mountedCanvas || EditorModel.canvas;
        if (cvs) {
            cvs.removeEventListener(EventType.MOUSE_DOWN, this.update);
            cvs.removeEventListener(EventType.MOUSE_WHEEL, this.handleWheelEvent);
            cvs.removeEventListener(EventType.MOUSE_DOWN, this.handleMiddleMouseDown);
        }
        this.mountedCanvas = null;
    }

    // =================================================================================================================
    // LOAD IMAGE
    // =================================================================================================================

    private loadImage = async (imageData: ImageData): Promise<any> => {
        if (imageData.loadStatus) {
            // 视频模式：复用缓存的 videoFrameImage（尺寸与视频一致），同步设置，零延迟
            if (VideoSelector.isVideoMode() && EditorModel.videoFrameImage) {
                EditorActions.setActiveImage(EditorModel.videoFrameImage);
                this.updateModelAndRender();
            } else {
                EditorActions.setActiveImage(ImageRepository.getById(imageData.id));
                AIActions.detect(imageData.id, ImageRepository.getById(imageData.id));
                this.updateModelAndRender();
            }
        }
        else {
            // 0-byte placeholder = on-demand video frame; skip FileUtil.loadImage
            // (it will be drawn by FramePlayer via backend fetch instead)
            if (imageData.fileData && imageData.fileData.size === 0) return;
            if (!EditorModel.isLoading) {
                EditorActions.setLoadingStatus(true);
                const saveLoadedImagePartial = (image: HTMLImageElement) => this.saveLoadedImage(image, imageData);
                FileUtil.loadImage(imageData.fileData)
                    .then((image:HTMLImageElement) => saveLoadedImagePartial(image))
                    .catch((error) => this.handleLoadImageError(error))
            }
        }
    };

    private saveLoadedImage = (image: HTMLImageElement, imageData: ImageData) => {
        imageData.loadStatus = true;
        this.props.updateImageDataById(imageData.id, imageData);
        ImageRepository.storeImage(imageData.id, image);
        EditorActions.setActiveImage(image);
        AIActions.detect(imageData.id, image);
        EditorActions.setLoadingStatus(false);
        this.updateModelAndRender()
    };

    private handleLoadImageError = (error?: any) => {
        EditorActions.setLoadingStatus(false);
        console.error(`[Editor] 图像加载失败: ${this.props.imageData?.fileData?.name} (size=${this.props.imageData?.fileData?.size})`, error);
    };

    // =================================================================================================================
    // HELPER METHODS
    // =================================================================================================================

    private updateModelAndRender = () => {
        ViewPortActions.updateViewPortSize();
        ViewPortActions.updateDefaultViewPortImageRect();
        ViewPortActions.resizeViewPortContent();
        EditorActions.fullRender();
    };

    private update = (event: MouseEvent) => {
        // 视频模式下隐藏光标和坐标指示器
        if (VideoSelector.isVideoMode()) {
            if (EditorModel.cursor) {
                EditorModel.cursor.style.display = "none";
            }
            if (EditorModel.mousePositionIndicator) {
                EditorModel.mousePositionIndicator.style.display = "none";
            }
            if (VideoSelector.isVideoPlaying()) {
                return;
            }
        }

        const editorData: EditorData = EditorActions.getEditorData(event);
        EditorModel.mousePositionOnViewPortContent = CanvasUtil.getMousePositionOnCanvasFromEvent(event, EditorModel.canvas);
        EditorModel.primaryRenderingEngine.update(editorData);

        EditorModel.supportRenderingEngine && EditorModel.supportRenderingEngine.update(editorData);

        if (EditorModel.cursor && EditorModel.mousePositionIndicator) {
            !this.props.activePopupType && EditorActions.updateMousePositionIndicator(event);
        }
        EditorActions.fullRender();
    };

    private handleWheelEvent = (event: WheelEvent) => {
        event.preventDefault();

        if (event.ctrlKey || event.metaKey) {
            // 触控板捏合缩放 (pinch) — 浏览器将 pinch 转换为 ctrlKey + wheel
            const zoomDelta = -event.deltaY * 0.01;
            ViewPortActions.zoomByDelta(zoomDelta);
            EditorModel.mousePositionOnViewPortContent =
                CanvasUtil.getMousePositionOnCanvasFromEvent(event, EditorModel.canvas);
        } else {
            // 双指滑动 — 平移画布
            if (EditorModel.viewPortScrollbars) {
                const currentScrollLeft = EditorModel.viewPortScrollbars.getScrollLeft();
                const currentScrollTop = EditorModel.viewPortScrollbars.getScrollTop();
                EditorModel.viewPortScrollbars.scrollLeft(currentScrollLeft + event.deltaX);
                EditorModel.viewPortScrollbars.scrollTop(currentScrollTop + event.deltaY);
            }
        }
    };

    private handleMiddleMouseDown = (event: MouseEvent) => {
        // 只处理中键（button = 1）
        if (event.button === 1) {
            event.preventDefault();
            this.setState({
                isMiddleMouseDragging: true,
                lastMiddleMousePosition: { x: event.clientX, y: event.clientY }
            });
            // Show grab cursor via DOM (bypass Redux to avoid circular import)
            if (EditorModel.cursor) {
                EditorModel.cursor.className = 'Cursor grabbing';
                const img = EditorModel.cursor.querySelector('img');
                if (img) img.src = 'ico/hand-fill-grab.png';
            }
        }
    };

    private handleMiddleMouseMove = (event: MouseEvent) => {
        if (this.state.isMiddleMouseDragging && this.state.lastMiddleMousePosition) {
            event.preventDefault();
            
            // 计算鼠标移动的距离
            const deltaX = event.clientX - this.state.lastMiddleMousePosition.x;
            const deltaY = event.clientY - this.state.lastMiddleMousePosition.y;
            
            // 获取当前滚动位置并应用偏移
            if (EditorModel.viewPortScrollbars) {
                const currentScrollLeft = EditorModel.viewPortScrollbars.getScrollLeft();
                const currentScrollTop = EditorModel.viewPortScrollbars.getScrollTop();
                
                EditorModel.viewPortScrollbars.scrollLeft(currentScrollLeft - deltaX);
                EditorModel.viewPortScrollbars.scrollTop(currentScrollTop - deltaY);
            }
            
            // 更新最后的鼠标位置
            this.setState({
                lastMiddleMousePosition: { x: event.clientX, y: event.clientY }
            });
        }
    };

    private handleMiddleMouseUp = (event: MouseEvent) => {
        if (event.button === 1 && this.state.isMiddleMouseDragging) {
            event.preventDefault();
            this.setState({
                isMiddleMouseDragging: false,
                lastMiddleMousePosition: null
            });
            // Restore default cursor
            if (EditorModel.cursor) {
                EditorModel.cursor.className = 'Cursor';
                const img = EditorModel.cursor.querySelector('img');
                if (img) img.src = '';
            }
        }
    };

    private getOptionsPanels = () => {
        const editorData: EditorData = EditorActions.getEditorData();
        if (this.props.activeLabelType === LabelType.RECT || this.props.activeLabelType === LabelType.ALL) {
            return this.props.imageData.labelRects
                .filter((labelRect: LabelRect) => labelRect.isCreatedByAI && labelRect.status !== LabelStatus.ACCEPTED)
                .map((labelRect: LabelRect) => {
                    const positionOnImage: IPoint = {x: labelRect.rect.x, y: labelRect.rect.y};
                    const positionOnViewPort: IPoint = RenderEngineUtil.transferPointFromImageToViewPortContent(positionOnImage, editorData);
                    return <LabelControlPanel
                        position={positionOnViewPort}
                        labelData={labelRect}
                        imageData={this.props.imageData}
                        key={labelRect.id}
                    />
                })
        }
        else if (this.props.activeLabelType === LabelType.POINT) {
            return this.props.imageData.labelPoints
                .filter((labelPoint: LabelPoint) => labelPoint.isCreatedByAI && labelPoint.status !== LabelStatus.ACCEPTED)
                .map((labelPoint: LabelPoint) => {
                    const positionOnImage: IPoint = {x: labelPoint.point.x, y: labelPoint.point.y};
                    const positionOnViewPort: IPoint = RenderEngineUtil.transferPointFromImageToViewPortContent(positionOnImage, editorData);
                    return <LabelControlPanel
                        position={positionOnViewPort}
                        labelData={labelPoint}
                        imageData={this.props.imageData}
                        key={labelPoint.id}
                    />
                })
        }
        else return null;
    };

    private onScrollbarsUpdate = (scrollbarContent)=>{
        const newViewPortContentSize = {
            width: scrollbarContent.scrollWidth,
            height: scrollbarContent.scrollHeight
        };
        if(!isEqual(newViewPortContentSize, this.state.viewPortSize)) {
            this.setState({viewPortSize: newViewPortContentSize})
        }
    };

    public render() {
        return (
            <div
                className='Editor'
                ref={ref => EditorModel.editor = ref}
                draggable={false}
            >
                <Scrollbars
                    ref={ref => EditorModel.viewPortScrollbars = ref}
                    renderTrackHorizontal={props => <div {...props} className='track-horizontal'/>}
                    renderTrackVertical={props => <div {...props} className='track-vertical'/>}
                    onUpdate={this.onScrollbarsUpdate}
                >
                    <div
                        className='ViewPortContent'
                    >
                        <canvas
                            className='ImageCanvas'
                            ref={ref => EditorModel.canvas = ref}
                            draggable={false}
                            onContextMenu={(event: React.MouseEvent<HTMLCanvasElement>) => event.preventDefault()}
                            onMouseDown={(event: React.MouseEvent<HTMLCanvasElement>) => {
                                // 阻止中键的默认行为（如打开新标签页）
                                if (event.button === 1) {
                                    event.preventDefault();
                                }
                            }}
                        />
                        {this.getOptionsPanels()}
                    </div>
                </Scrollbars>
                <div
                    className='MousePositionIndicator'
                    ref={ref => EditorModel.mousePositionIndicator = ref}
                    draggable={false}
                />
                <div
                    className={EditorUtil.getCursorStyle(this.props.customCursorStyle)}
                    ref={ref => EditorModel.cursor = ref}
                    draggable={false}
                >
                    <img
                        draggable={false}
                        alt={'indicator'}
                        src={EditorUtil.getIndicator(this.props.customCursorStyle)}
                    />
                </div>
            </div>
        );
    }
}

const mapDispatchToProps = {
    updateImageDataById
};

const mapStateToProps = (state: AppState) => ({
    activeLabelType: state.labels.activeLabelType,
    activePopupType: state.general.activePopupType,
    activeLabelId: state.labels.activeLabelId,
    customCursorStyle: state.general.customCursorStyle,
    imageDragMode: state.general.imageDragMode,
    zoom: state.general.zoom
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(Editor);
