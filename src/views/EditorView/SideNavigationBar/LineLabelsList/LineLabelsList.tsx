import React from 'react';
import './LineLabelsList.scss';
import {ISize} from '../../../../interfaces/ISize';
import {ImageData, LabelLine, LabelName} from '../../../../store/labels/types';
import {LabelActions} from '../../../../logic/actions/LabelActions';
import LabelInputField from '../LabelInputField/LabelInputField';
import {findLast} from 'lodash';
import EmptyLabelList from '../EmptyLabelList/EmptyLabelList';
import Scrollbars from 'react-custom-scrollbars-2';
import {
    updateActiveLabelId,
    updateActiveLabelNameId,
    updateImageDataById
} from '../../../../store/labels/actionCreators';
import {AppState} from '../../../../store';
import {connect} from 'react-redux';
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

const LineLabelsList: React.FC<IProps> = (
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
        height: (imageData?.labelLines?.length || 0) * labelInputFieldHeight
    };

    const deleteLineLabelById = (labelLineId: string) => {
        if (imageData?.id) {
            LabelActions.deleteLineLabelById(imageData.id, labelLineId);
        }
    };

    const toggleLineLabelVisibilityById = (labelLineId: string) => {
        if (imageData?.id) {
            LabelActions.toggleLabelVisibilityById(imageData.id, labelLineId);
        }
    };

    const updateLineLabel = (labelLineId: string, labelNameId: string) => {
        if (!imageData?.id || !imageData?.labelLines) return;
        
        const newImageData = {
            ...imageData,
            labelLines: imageData.labelLines.map((labelLine: LabelLine) => {
                if (labelLine.id === labelLineId) {
                    return {
                        ...labelLine,
                        labelId: labelNameId
                    }
                }
                return labelLine
            })
        };
        updateImageDataByIdAction(imageData.id, newImageData);
        updateActiveLabelNameIdAction(labelNameId);
    };

    const onClickHandler = () => {
        updateActiveLabelIdAction(null);
    };

    const getChildren = () => {
        if (!imageData?.labelLines) return [];
        
        return imageData.labelLines
            .map((labelLine: LabelLine) => {
                return <LabelInputField
                    size={{
                        width: size?.width || 0,
                        height: labelInputFieldHeight
                    }}
                    isActive={labelLine.id === activeLabelId}
                    isHighlighted={labelLine.id === highlightedLabelId}
                    isVisible={labelLine.isVisible}
                    id={labelLine.id}
                    key={labelLine.id}
                    onDelete={deleteLineLabelById}
                    value={labelLine.labelId !== null ? findLast(labelNames, {id: labelLine.labelId}) : null}
                    options={labelNames}
                    onSelectLabel={updateLineLabel}
                    toggleLabelVisibility={toggleLineLabelVisibilityById}
                />
            });
    };

    return (
        <div
            className='LineLabelsList'
            style={listStyle}
            onClickCapture={onClickHandler}
        >
            {(!imageData?.labelLines || imageData.labelLines.length === 0) ?
                <EmptyLabelList
                    labelBefore={currentTexts.drawFirstLine}
                    labelAfter={currentTexts.noLabelsCreated}
                /> :
                <Scrollbars>
                    <div
                        className='LineLabelsListContent'
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
)(LineLabelsList);
