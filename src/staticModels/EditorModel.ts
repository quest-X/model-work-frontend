import { PrimaryEditorRenderEngine } from "../logic/render/PrimaryEditorRenderEngine";
import { BaseRenderEngine } from "../logic/render/BaseRenderEngine";
import { IRect } from "../interfaces/IRect";
import { IPoint } from "../interfaces/IPoint";
import { ISize } from "../interfaces/ISize";
import Scrollbars from "react-custom-scrollbars-2";
import { ViewPortHelper } from "../logic/helpers/ViewPortHelper";

export class EditorModel {
    public static editor: HTMLDivElement;
    public static canvas: HTMLCanvasElement;
    public static mousePositionIndicator: HTMLDivElement;
    public static cursor: HTMLDivElement;
    public static viewPortScrollbars: Scrollbars;
    public static image: HTMLImageElement;

    public static primaryRenderingEngine: PrimaryEditorRenderEngine;
    public static supportRenderingEngine: BaseRenderEngine;

    public static viewPortHelper: ViewPortHelper;

    public static videoElement: HTMLVideoElement;
    public static videoFrameImage: HTMLImageElement; // 持久化的视频尺寸图像，用于坐标映射
    public static playbackImageData: any; // 播放时直接引用当前帧的 ImageData，绕过 Redux selector
    public static latestImagesData: any[] | null = null; // batchApplyResults dispatch 后直接缓存，避免 ref 滞后
    public static videoFrameFiles: File[] = []; // 全局帧文件池（小视频全量模式）
    public static videoSessionId: string = ''; // 后端视频会话 ID（大视频按需取帧模式）
    public static isLoading: boolean = false;
    public static viewPortActionsDisabled: boolean = false;
    public static mousePositionOnViewPortContent: IPoint;
    public static viewPortSize: ISize;

    // x and y describe the dimension of the margin that remains constant regardless of the scale of the image
    // width and height describes the render image size for 100% scale
    public static defaultRenderImageRect: IRect;
}