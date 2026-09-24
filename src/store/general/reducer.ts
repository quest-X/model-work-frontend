import {GeneralActionTypes, GeneralState} from './types';
import {Action} from '../Actions';
import {CustomCursorStyle} from '../../data/enums/CustomCursorStyle';
import {ViewPointSettings} from '../../settings/ViewPointSettings';
import {ProjectType} from '../../data/enums/ProjectType';
import {Language} from '../../data/LanguageConfig';

const initialState: GeneralState = {
    windowSize: null,
    activePopupType: null,
    activePopupNodeId: null,
    activePopupNodeName: null,
    activePopupNodeRemote: false,
    customCursorStyle: CustomCursorStyle.DEFAULT,
    activeContext: null,
    preventCustomCursor: false,
    imageDragMode: false,
    smartAnnotationActive: false,
    samNegativeMode: false,
    trackingMode: false,
    trackingInProgress: false,
    eraserMode: true, // 默认激活橡皮擦工具
    eraserFineMode: true, // 默认局部擦除
    enablePerClassColoration: true,
    projectData: {
        type: ProjectType.OBJECT_DETECTION, // 默认设置为目标检测项目
        name: 'default-project',
    },
    zoom: ViewPointSettings.MIN_ZOOM,
    language: Language.CHINESE // 默认中文
};

function updateGeneralField<Key extends keyof GeneralState>(
    state: GeneralState, field: Key, value: GeneralState[Key],
): GeneralState {
    return state[field] === value ? state : {...state, [field]: value};
}

function reduceEditorTools(state: GeneralState, action: GeneralActionTypes): GeneralState {
    switch (action.type) {
        case Action.UPDATE_IMAGE_DRAG_MODE_STATUS: {
            return updateGeneralField(state, 'imageDragMode', action.payload.imageDragMode);
        }
        case Action.UPDATE_SMART_ANNOTATION_ACTIVE_STATUS: {
            return updateGeneralField(state, 'smartAnnotationActive', action.payload.smartAnnotationActive);
        }
        case Action.UPDATE_TRACKING_MODE_STATUS: {
            return updateGeneralField(state, 'trackingMode', action.payload.trackingMode);
        }
        case Action.UPDATE_TRACKING_IN_PROGRESS_STATUS: {
            return updateGeneralField(state, 'trackingInProgress', action.payload.trackingInProgress);
        }
        case Action.UPDATE_ERASER_MODE: {
            return updateGeneralField(state, 'eraserMode', action.payload.eraserMode);
        }
        case Action.UPDATE_ERASER_FINE_MODE: {
            return updateGeneralField(state, 'eraserFineMode', action.payload.eraserFineMode);
        }
        case Action.UPDATE_SAM_NEGATIVE_MODE: {
            return updateGeneralField(state, 'samNegativeMode', action.payload.samNegativeMode);
        }
        case Action.UPDATE_ENABLE_PER_CLASS_COLORATION_STATUS: {
            return updateGeneralField(state, 'enablePerClassColoration', action.payload.enablePerClassColoration);
        }
        default:
            return state;
    }
}

// Idempotency guard for scalar-assignment cases: if the dispatched value
// equals the current state, return the same reference so React-Redux's
// shallow compare short-circuits the re-render. Without this, render-time
// dispatches from canvas render engines (e.g. cursor style) can trigger
// componentDidUpdate → fullRender → dispatch loops that hit React's
// "Maximum update depth exceeded" guard.
export function generalReducer(
    state = initialState,
    action: GeneralActionTypes
): GeneralState {
    switch (action.type) {
        case Action.UPDATE_WINDOW_SIZE: {
            return {
                ...state,
                windowSize: action.payload.windowSize
            }
        }
        case Action.UPDATE_ACTIVE_POPUP_TYPE: {
            if (
                state.activePopupType === action.payload.activePopupType
                && state.activePopupNodeId === action.payload.activePopupNodeId
                && state.activePopupNodeName === action.payload.activePopupNodeName
                && state.activePopupNodeRemote === action.payload.activePopupNodeRemote
            ) return state;
            return {
                ...state,
                activePopupType: action.payload.activePopupType,
                activePopupNodeId: action.payload.activePopupNodeId,
                activePopupNodeName: action.payload.activePopupNodeName,
                activePopupNodeRemote: action.payload.activePopupNodeRemote,
            }
        }
        case Action.UPDATE_CUSTOM_CURSOR_STYLE: {
            return updateGeneralField(state, 'customCursorStyle', action.payload.customCursorStyle);
        }
        case Action.UPDATE_CONTEXT: {
            return updateGeneralField(state, 'activeContext', action.payload.activeContext);
        }
        case Action.UPDATE_PREVENT_CUSTOM_CURSOR_STATUS: {
            return updateGeneralField(state, 'preventCustomCursor', action.payload.preventCustomCursor);
        }
        case Action.UPDATE_PROJECT_DATA: {
            return {
                ...state,
                projectData: action.payload.projectData
            }
        }
        case Action.UPDATE_ZOOM: {
            return updateGeneralField(state, 'zoom', action.payload.zoom);
        }
        case Action.UPDATE_LANGUAGE: {
            return updateGeneralField(state, 'language', action.payload.language);
        }
        default:
            return reduceEditorTools(state, action);
    }
}
