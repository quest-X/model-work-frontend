import {GeneralActionTypes, GeneralState} from './types';
import {Action} from '../Actions';
import {CustomCursorStyle} from '../../data/enums/CustomCursorStyle';
import {ViewPointSettings} from '../../settings/ViewPointSettings';
import {ProjectType} from '../../data/enums/ProjectType';
import {Language} from '../../data/LanguageConfig';

const initialState: GeneralState = {
    windowSize: null,
    activePopupType: null,
    customCursorStyle: CustomCursorStyle.DEFAULT,
    activeContext: null,
    preventCustomCursor: false,
    imageDragMode: false,
    smartAnnotationActive: false,
    trackingMode: false,
    trackingInProgress: false,
    eraserMode: false,
    eraserFineMode: false,
    enablePerClassColoration: true,
    projectData: {
        type: ProjectType.OBJECT_DETECTION, // 默认设置为目标检测项目
        name: 'default-project',
    },
    zoom: ViewPointSettings.MIN_ZOOM,
    language: Language.CHINESE // 默认中文
};

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
            return {
                ...state,
                activePopupType: action.payload.activePopupType
            }
        }
        case Action.UPDATE_CUSTOM_CURSOR_STYLE: {
            return {
                ...state,
                customCursorStyle: action.payload.customCursorStyle
            }
        }
        case Action.UPDATE_CONTEXT: {
            return {
                ...state,
                activeContext: action.payload.activeContext
            }
        }
        case Action.UPDATE_PREVENT_CUSTOM_CURSOR_STATUS: {
            return {
                ...state,
                preventCustomCursor: action.payload.preventCustomCursor
            }
        }
        case Action.UPDATE_IMAGE_DRAG_MODE_STATUS: {
            return {
                ...state,
                imageDragMode: action.payload.imageDragMode
            }
        }
        case Action.UPDATE_SMART_ANNOTATION_ACTIVE_STATUS: {
            return {
                ...state,
                smartAnnotationActive: action.payload.smartAnnotationActive
            }
        }
        case Action.UPDATE_TRACKING_MODE_STATUS: {
            return {
                ...state,
                trackingMode: action.payload.trackingMode
            }
        }
        case Action.UPDATE_TRACKING_IN_PROGRESS_STATUS: {
            return {
                ...state,
                trackingInProgress: action.payload.trackingInProgress
            }
        }
        case Action.UPDATE_ERASER_MODE: {
            return {
                ...state,
                eraserMode: action.payload.eraserMode,
                // 保留 eraserFineMode，使橡皮擦记住上次模式（整体/局部）
                // 这样从局部擦除切换到其他工具再切回，仍恢复局部擦除
            }
        }
        case Action.UPDATE_ERASER_FINE_MODE: {
            return {
                ...state,
                eraserFineMode: action.payload.eraserFineMode
            }
        }
        case Action.UPDATE_PROJECT_DATA: {
            return {
                ...state,
                projectData: action.payload.projectData
            }
        }
        case Action.UPDATE_ZOOM: {
            return {
                ...state,
                zoom: action.payload.zoom
            }
        }
        case Action.UPDATE_ENABLE_PER_CLASS_COLORATION_STATUS: {
            return {
                ...state,
                enablePerClassColoration: action.payload.enablePerClassColoration
            }
        }
        case Action.UPDATE_LANGUAGE: {
            return {
                ...state,
                language: action.payload.language
            }
        }
        default:
            return state;
    }
}
