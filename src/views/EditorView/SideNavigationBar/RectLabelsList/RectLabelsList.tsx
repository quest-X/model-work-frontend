import React from 'react';
import {ISize} from '../../../../interfaces/ISize';
import Scrollbars from 'react-custom-scrollbars-2';
import {ImageData, LabelName, LabelRect} from '../../../../store/labels/types';
import './RectLabelsList.scss';
import {
    updateActiveLabelId,
    updateActiveLabelNameId,
    updateImageDataById
} from '../../../../store/labels/actionCreators';
import {AppState} from '../../../../store';
import {connect} from 'react-redux';
import LabelInputField from '../LabelInputField/LabelInputField';
import EmptyLabelList from '../EmptyLabelList/EmptyLabelList';
import {LabelActions} from '../../../../logic/actions/LabelActions';
import {LabelStatus} from '../../../../data/enums/LabelStatus';
import {findLast} from 'lodash';
import {Language, LanguageConfig} from '../../../../data/LanguageConfig';

interface IProps {
    size: ISize;
    imageData: ImageData;
    updateImageDataByIdAction: (id: string, newImageData: ImageData) => any;
    activeLabelId: string;
    highlightedLabelId: string;
    updateActiveLabelNameIdAction: (activeLabelId: string) => any;
    labelNames: LabelName[];
    updateActiveLabelIdAction: (activeLabelId: string) => any;
    language: Language;
}

const RectLabelsList: React.FC<IProps> = (
    {
        size,
        imageData,
        updateImageDataByIdAction,
        labelNames,
        updateActiveLabelNameIdAction,
        activeLabelId,
        highlightedLabelId,
        updateActiveLabelIdAction,
        language
    }
) => {
    const currentTexts = LanguageConfig[language];
    const labelInputFieldHeight = 40;
    const listStyle: React.CSSProperties = {
        width: size?.width || 0,
        height: size?.height || 0
    };
    const listStyleContent: React.CSSProperties = {
        width: size?.width || 0,
        height: (imageData?.labelRects?.length || 0) * labelInputFieldHeight
    };

    const deleteRectLabelById = (labelRectId: string) => {
        if (imageData?.id) {
            LabelActions.deleteRectLabelById(imageData.id, labelRectId);
        }
    };

    const toggleRectLabelVisibilityById = (labelRectId: string) => {
        if (imageData?.id) {
            LabelActions.toggleLabelVisibilityById(imageData.id, labelRectId);
        }
    };

    const updateRectLabel = (labelRectId: string, labelNameId: string) => {
        if (!imageData?.id || !imageData?.labelRects) return;
        
        const newImageData = {
            ...imageData,
            labelRects: imageData.labelRects
                .map((labelRect: LabelRect) => {
                    if (labelRect.id === labelRectId) {
                        return {
                            ...labelRect,
                            labelId: labelNameId,
                            status: LabelStatus.ACCEPTED
                        }
                    } else {
                        return labelRect
                    }
                })
        };
        updateImageDataByIdAction(imageData.id, newImageData);
        updateActiveLabelNameIdAction(labelNameId);
    };

    const onClickHandler = () => {
        updateActiveLabelIdAction(null);
    };

    const getChildren = () => {
        if (!imageData?.labelRects) return [];
        
        return imageData.labelRects
            .filter((labelRect: LabelRect) => labelRect.status === LabelStatus.ACCEPTED)
            .map((labelRect: LabelRect) => {
                return <LabelInputField
                    size={{
                        width: size?.width || 0,
                        height: labelInputFieldHeight
                    }}
                    isActive={labelRect.id === activeLabelId}
                    isHighlighted={labelRect.id === highlightedLabelId}
                    isVisible={labelRect.isVisible}
                    id={labelRect.id}
                    key={labelRect.id}
                    onDelete={deleteRectLabelById}
                    value={labelRect.labelId !== null ? findLast(labelNames, {id: labelRect.labelId}) : null}
                    options={labelNames}
                    onSelectLabel={updateRectLabel}
                    toggleLabelVisibility={toggleRectLabelVisibilityById}
                />
            });
    };

    return (
        <div
            className='RectLabelsList'
            style={listStyle}
            onClickCapture={onClickHandler}
        >
            {(!imageData?.labelRects || imageData.labelRects.filter((labelRect: LabelRect) => labelRect.status === LabelStatus.ACCEPTED).length === 0) ?
                <EmptyLabelList
                    labelBefore={currentTexts.drawFirstBoundingBox}
                    labelAfter={currentTexts.noLabelsCreated}
                /> :
                <Scrollbars>
                    <div
                        className='RectLabelsListContent'
                        style={listStyleContent}
                    >
                        {getChildren()}
                    </div>
                </Scrollbars>
            }
        </div>
    );
};

const mapDispatchToProps = {
    updateImageDataByIdAction: updateImageDataById,
    updateActiveLabelNameIdAction: updateActiveLabelNameId,
    updateActiveLabelIdAction: updateActiveLabelId
};

const mapStateToProps = (state: AppState) => ({
    activeLabelId: state.labels.activeLabelId,
    highlightedLabelId: state.labels.highlightedLabelId,
    labelNames : state.labels.labels,
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(RectLabelsList);
