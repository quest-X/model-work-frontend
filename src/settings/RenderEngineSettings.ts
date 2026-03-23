import {ISize} from '../interfaces/ISize';
import {Settings} from './Settings';

export class RenderEngineSettings {
    public static readonly LINE_THICKNESS: number = 2;
    public static readonly lineActiveColor: string = Settings.PRIMARY_COLOR;
    public static readonly defaultLineColor: string = '#ffffff';
    public static readonly CROSS_HAIR_LINE_COLOR: string = '#ffffff';
    public static readonly crossHairPadding: number = 25;
    public static readonly anchorSize: ISize = {
        width: Settings.RESIZE_HANDLE_DIMENSION_PX,
        height: Settings.RESIZE_HANDLE_DIMENSION_PX
    };
    public static readonly anchorHoverSize: ISize = {
        width: Settings.RESIZE_HANDLE_HOVER_DIMENSION_PX,
        height: Settings.RESIZE_HANDLE_HOVER_DIMENSION_PX
    };
    public static readonly suggestedAnchorDetectionSize: ISize = {
        width: 100,
        height: 100
    };
    public static readonly defaultAnchorColor: string = '#ffffff';
    public static readonly inactiveAnchorColor: string = Settings.DARK_THEME_SECOND_COLOR;

    public static readonly DEFAULT_ANCHOR_COLOR: string = '#ffffff';
    public static readonly ACTIVE_ANCHOR_COLOR: string = Settings.SECONDARY_COLOR;
    public static readonly INACTIVE_ANCHOR_COLOR: string = Settings.DARK_THEME_SECOND_COLOR;

    public static readonly DEFAULT_LINE_COLOR: string = '#ffffff';
    public static readonly ACTIVE_LINE_COLOR: string = Settings.PRIMARY_COLOR;
    public static readonly INACTIVE_LINE_COLOR: string = '#ffffff';
    
    // Inference mode colors
    public static readonly INFERENCE_ACTIVE_LINE_COLOR: string = '#41E391';
    public static readonly INFERENCE_INACTIVE_LINE_COLOR: string = '#41E391';
    public static readonly INFERENCE_ANCHOR_COLOR: string = '#41E391';
    
    // Line snapping colors
    public static readonly LINE_SNAP_COLOR: string = '#2af598'; // 绿色表示吸附状态
    public static readonly LINE_SNAP_DASH_PATTERN: number[] = [8, 4]; // 虚线样式
}
