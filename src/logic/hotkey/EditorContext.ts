import {HotKeyAction} from "../../data/HotKeyAction";
import {EditorModel} from "../../staticModels/EditorModel";
import {LabelType} from "../../data/enums/LabelType";
import {EditorActions} from "../actions/EditorActions";
import {BaseContext} from "./BaseContext";
import {ImageActions} from "../actions/ImageActions";
import {ViewPortActions} from "../actions/ViewPortActions";
import {Direction} from "../../data/enums/Direction";
import {PlatformUtil} from "../../utils/PlatformUtil";
import {LabelActions} from "../actions/LabelActions";
import {LineRenderEngine} from "../render/LineRenderEngine";
import {PolygonRenderEngine} from "../render/PolygonRenderEngine";
import {RectRenderEngine} from "../render/RectRenderEngine";
import {AutoSaveService} from "../../services/AutoSaveService";
import {UndoActions} from "../actions/UndoActions";

const forceSave = (event: KeyboardEvent) => {
    event.preventDefault();
    void AutoSaveService.saveCurrentState(true);
};

const saveShortcuts: HotKeyAction[] = [
    {keyCombo: ["Control", "s"], action: forceSave},
    {keyCombo: ["Meta", "s"], action: forceSave},
];
const undoShortcut = PlatformUtil.isMac(window.navigator.userAgent) ? ["Meta", "z"] : ["Control", "z"];

export class EditorContext extends BaseContext {
    public static actions: HotKeyAction[] = [
        ...saveShortcuts,
        {
            keyCombo: undoShortcut,
            action: (event: KeyboardEvent) => {
                event.preventDefault();
                UndoActions.undo();
            }
        },
        {
            keyCombo: ["Enter"],
            action: () => {
                EditorActions.fullRender();
            }
        },
        {
            keyCombo: ["Escape"],
            action: () => {
                if (EditorModel.supportRenderingEngine) {
                    switch (EditorModel.supportRenderingEngine.labelType) {
                        case LabelType.RECT:
                            (EditorModel.supportRenderingEngine as RectRenderEngine).cancelLabelCreation();
                            break;
                        case LabelType.LINE:
                            (EditorModel.supportRenderingEngine as LineRenderEngine).cancelLabelCreation();
                            break;
                        case LabelType.POLYGON:
                            (EditorModel.supportRenderingEngine as PolygonRenderEngine).cancelLabelCreation();
                            break;
                    }
                }
                EditorActions.fullRender();
            }
        },
        {
            keyCombo: PlatformUtil.isMac(window.navigator.userAgent) ? ["Alt", "ArrowLeft"] : ["Control", "ArrowLeft"],
            action: () => {
                ImageActions.goToPreviousImage()
            }
        },
        {
            keyCombo: PlatformUtil.isMac(window.navigator.userAgent) ? ["Alt", "ArrowRight"] : ["Control", "ArrowRight"],
            action: () => {
                ImageActions.goToNextImage();
            }
        },
        {
            keyCombo: PlatformUtil.isMac(window.navigator.userAgent) ? ["Alt", "+"] : ["Control", "+"],
            action: () => {
                ViewPortActions.zoomIn();
            }
        },
        {
            keyCombo: PlatformUtil.isMac(window.navigator.userAgent) ? ["Alt", "-"] : ["Control", "-"],
            action: () => {
                ViewPortActions.zoomOut();
            }
        },
        {
            keyCombo: ["ArrowRight"],
            action: (event: KeyboardEvent) => {
                event.preventDefault();
                ImageActions.goToNextImage();
            }
        },
        {
            keyCombo: ["ArrowLeft"],
            action: (event: KeyboardEvent) => {
                event.preventDefault();
                ImageActions.goToPreviousImage();
            }
        },
        {
            keyCombo: ["ArrowUp"],
            action: (event: KeyboardEvent) => {
                event.preventDefault();
                ViewPortActions.translateViewPortPosition(Direction.BOTTOM);
            }
        },
        {
            keyCombo: ["ArrowDown"],
            action: (event: KeyboardEvent) => {
                event.preventDefault();
                ViewPortActions.translateViewPortPosition(Direction.TOP);
            }
        },
        {
            keyCombo: ["Backspace"],
            action: () => {
                LabelActions.deleteActiveLabel();
            }
        },
        {
            keyCombo: ["Delete"],
            action: () => {
                LabelActions.deleteActiveLabel();
            }
        },
        {
            keyCombo: PlatformUtil.isMac(window.navigator.userAgent) ? ["Alt", "0"] : ["Control", "0"],
            action: () => {
                ImageActions.setActiveLabelOnActiveImage(0);
                EditorActions.fullRender();
            }
        },
        {
            keyCombo: PlatformUtil.isMac(window.navigator.userAgent) ? ["Alt", "1"] : ["Control", "1"],
            action: () => {
                ImageActions.setActiveLabelOnActiveImage(1);
                EditorActions.fullRender();
            }
        },
        {
            keyCombo: PlatformUtil.isMac(window.navigator.userAgent) ? ["Alt", "2"] : ["Control", "2"],
            action: () => {
                ImageActions.setActiveLabelOnActiveImage(2);
                EditorActions.fullRender();
            }
        },
        {
            keyCombo: PlatformUtil.isMac(window.navigator.userAgent) ? ["Alt", "3"] : ["Control", "3"],
            action: () => {
                ImageActions.setActiveLabelOnActiveImage(3);
                EditorActions.fullRender();
            }
        },
        {
            keyCombo: PlatformUtil.isMac(window.navigator.userAgent) ? ["Alt", "4"] : ["Control", "4"],
            action: () => {
                ImageActions.setActiveLabelOnActiveImage(4);
                EditorActions.fullRender();
            }
        },
        {
            keyCombo: PlatformUtil.isMac(window.navigator.userAgent) ? ["Alt", "5"] : ["Control", "5"],
            action: () => {
                ImageActions.setActiveLabelOnActiveImage(5);
                EditorActions.fullRender();
            }
        },
        {
            keyCombo: PlatformUtil.isMac(window.navigator.userAgent) ? ["Alt", "6"] : ["Control", "6"],
            action: () => {
                ImageActions.setActiveLabelOnActiveImage(6);
                EditorActions.fullRender();
            }
        },
        {
            keyCombo: PlatformUtil.isMac(window.navigator.userAgent) ? ["Alt", "7"] : ["Control", "7"],
            action: () => {
                ImageActions.setActiveLabelOnActiveImage(7);
                EditorActions.fullRender();
            }
        },
        {
            keyCombo: PlatformUtil.isMac(window.navigator.userAgent) ? ["Alt", "8"] : ["Control", "8"],
            action: () => {
                ImageActions.setActiveLabelOnActiveImage(8);
                EditorActions.fullRender();
            }
        },
        {
            keyCombo: PlatformUtil.isMac(window.navigator.userAgent) ? ["Alt", "9"] : ["Control", "9"],
            action: () => {
                ImageActions.setActiveLabelOnActiveImage(9);
                EditorActions.fullRender();
            }
        }
    ];
}
