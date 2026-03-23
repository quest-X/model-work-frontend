import {LabelsActionTypes, LabelsState, ImageData} from './types';
import {Action} from '../Actions';
import {LabelType} from '../../data/enums/LabelType';

const initialState: LabelsState = {
    activeImageIndex: null,
    activeLabelNameId: null,
    activeLabelType: LabelType.ALL, // 默认使用全部标签工具
    activeLabelViewType: LabelType.ALL, // 默认显示全部标签视图
    activeLabelId: null,
    highlightedLabelId: null,
    imagesData: [],
    firstLabelCreatedFlag: false,
    labels: []
};

export function labelsReducer(
    state = initialState,
    action: LabelsActionTypes
): LabelsState {
    switch (action.type) {
        case Action.UPDATE_ACTIVE_IMAGE_INDEX: {
            return {
                ...state,
                activeImageIndex: action.payload.activeImageIndex
            }
        }
        case Action.UPDATE_ACTIVE_LABEL_NAME_ID: {
            return {
                ...state,
                activeLabelNameId: action.payload.activeLabelNameId
            }
        }
        case Action.UPDATE_ACTIVE_LABEL_ID: {
            return {
                ...state,
                activeLabelId: action.payload.activeLabelId
            }
        }
        case Action.UPDATE_HIGHLIGHTED_LABEL_ID: {
            return {
                ...state,
                highlightedLabelId: action.payload.highlightedLabelId
            }
        }
        case Action.UPDATE_ACTIVE_LABEL_TYPE: {
            return {
                ...state,
                activeLabelType: action.payload.activeLabelType
            }
        }
        case Action.UPDATE_ACTIVE_LABEL_VIEW_TYPE: {
            return {
                ...state,
                activeLabelViewType: action.payload.activeLabelViewType
            }
        }
        case Action.UPDATE_IMAGE_DATA_BY_ID: {
            return {
                ...state,
                imagesData: state.imagesData.map((imageData: ImageData) =>
                    imageData.id === action.payload.id ? action.payload.newImageData : imageData
                )
            }
        }
        case Action.ADD_IMAGES_DATA: {
            return {
                ...state,
                imagesData: state.imagesData.concat(action.payload.imageData)
            }
        }
        case Action.UPDATE_IMAGES_DATA: {
            return {
                ...state,
                imagesData: action.payload.imageData
            }
        }
        case Action.UPDATE_LABEL_NAMES: {
            return {
                ...state,
                labels: action.payload.labels
            }
        }
        case Action.UPDATE_FIRST_LABEL_CREATED_FLAG: {
            return {
                ...state,
                firstLabelCreatedFlag: action.payload.firstLabelCreatedFlag
            }
        }
        case Action.SELECT_ALL_IMAGES: {
            return {
                ...state,
                imagesData: state.imagesData.map((imageData: ImageData) => ({
                    ...imageData,
                    isSelected: action.payload.selectAll
                }))
            }
        }
        case Action.TOGGLE_IMAGE_SELECTION: {
            return {
                ...state,
                imagesData: state.imagesData.map((imageData: ImageData) =>
                    imageData.id === action.payload.imageId
                        ? { ...imageData, isSelected: !imageData.isSelected }
                        : imageData
                )
            }
        }
        case Action.SELECT_IMAGE_RANGE: {
            const { startIndex, endIndex } = action.payload;
            const minIndex = Math.min(startIndex, endIndex);
            const maxIndex = Math.max(startIndex, endIndex);
            
            return {
                ...state,
                imagesData: state.imagesData.map((imageData: ImageData, index: number) => ({
                    ...imageData,
                    isSelected: index >= minIndex && index <= maxIndex
                }))
            }
        }
        default:
            return state;
    }
}
