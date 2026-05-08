import { PrimaryEditorRenderEngine } from "../logic/render/PrimaryEditorRenderEngine";
import { BaseRenderEngine } from "../logic/render/BaseRenderEngine";
import { IRect } from "../interfaces/IRect";
import { IPoint } from "../interfaces/IPoint";
import { ISize } from "../interfaces/ISize";
import Scrollbars from "react-custom-scrollbars-2";
import { ViewPortHelper } from "../logic/helpers/ViewPortHelper";

export interface PendingPrompt {
    id: string;
    kind: 'point' | 'bbox';
    point?: IPoint;
    bbox?: IRect;
}

export class EditorModel {
    public static editor: HTMLDivElement;
    public static canvas: HTMLCanvasElement;
    public static mousePositionIndicator: HTMLDivElement;
    public static cursor: HTMLDivElement;
    public static viewPortScrollbars: Scrollbars;
    public static image: HTMLImageElement | VideoFrame; // v2.6.0: WebCodecs 路径下为 VideoFrame

    public static primaryRenderingEngine: PrimaryEditorRenderEngine;
    public static supportRenderingEngine: BaseRenderEngine;

    public static viewPortHelper: ViewPortHelper;

    public static videoElement: HTMLVideoElement; // raw_browser_mode: the native <video> element
    public static videoFrameImage: HTMLImageElement | VideoFrame | null; // v2.6.0: WebCodecs 路径下为 VideoFrame, 否则 HTMLImageElement
    public static playbackImageData: any; // During playback: direct ref to current frame ImageData, bypasses Redux selector
    public static latestImagesData: any[] | null = null; // Cache after batchApplyResults dispatch, avoids ref staleness
    public static videoFrameFiles: (File | undefined)[] = []; // fast_ffmpeg_mode (full-load): global frame file pool. Slot may be undefined after eviction (sparse array).
    public static videoSessionId: string = ''; // fast_ffmpeg_mode (on-demand): backend session ID
    public static preloadedImageCache: Map<number, HTMLImageElement> = new Map(); // Pre-decoded Image cache from parsing phase
    public static isLoading: boolean = false;
    public static lastLoadedModelService: 'detection' | 'segmentation' | null = null; // set by LoadDetectionModelPopup after model load
    public static lastBatchInferenceImageCount: number = 0; // set by detectBatch/segmentBatch on completion, read by EditorContainer to auto-show statistics
    public static viewPortActionsDisabled: boolean = false;
    public static mousePositionOnViewPortContent: IPoint;
    public static viewPortSize: ISize;

    // x and y describe the dimension of the margin that remains constant regardless of the scale of the image
    // width and height describes the render image size for 100% scale
    public static defaultRenderImageRect: IRect;

    // Smart annotation pending prompts (white blinking indicators while SAM is running)
    public static pendingPrompts: PendingPrompt[] = [];
    public static pendingPromptsRafId: number | null = null;
}