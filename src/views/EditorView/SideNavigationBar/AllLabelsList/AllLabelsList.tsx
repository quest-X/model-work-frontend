import React from 'react';
import {ISize} from '../../../../interfaces/ISize';
import Scrollbars from 'react-custom-scrollbars-2';
import {ImageData, LabelName, LabelRect, LabelPoint, LabelPolygon, LabelLine} from '../../../../store/labels/types';
import './AllLabelsList.scss';
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
import {LabelType} from '../../../../data/enums/LabelType';
import {AISelector} from '../../../../store/selectors/AISelector';

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
    imageAIStates: Map<string, { aiLabelsVisible: boolean; segmentationLabelsVisible: boolean; inferenceHistory: Array<any> }>;
}

interface LabelItem {
    id: string;
    type: LabelType;
    labelId: string | null;
    isCreatedByAI: boolean;
    status: LabelStatus;
    suggestedLabel: string | null;
    isVisible?: boolean;
}

const AllLabelsList: React.FC<IProps> = (
    {
        size,
        imageData,
        updateImageDataByIdAction,
        activeLabelId,
        highlightedLabelId,
        updateActiveLabelNameIdAction,
        labelNames,
        updateActiveLabelIdAction,
        language,
        imageAIStates
    }) => {

    const currentTexts = LanguageConfig[language] || LanguageConfig.en;

    const getAllLabels = (): LabelItem[] => {
        if (!imageData) return [];
        
        // 获取AI标签的可见性状态
        const imageAIState = imageAIStates.get(imageData.id);
        const aiLabelsVisible = imageAIState ? imageAIState.aiLabelsVisible : false;
        const segmentationLabelsVisible = imageAIState ? imageAIState.segmentationLabelsVisible : false;
        
        // 调试信息已移除
        
        const allLabels: LabelItem[] = [];
        
        // 添加矩形框标签（显示所有已接受的标签，AI标签始终显示但标记隐藏状态）
        if (imageData.labelRects) {
            imageData.labelRects
                .filter((rect: LabelRect) => rect.status === LabelStatus.ACCEPTED)
                .forEach((rect: LabelRect) => {
                    allLabels.push({
                        id: rect.id,
                        type: LabelType.RECT,
                        labelId: rect.labelId,
                        isCreatedByAI: rect.isCreatedByAI,
                        status: rect.status,
                        suggestedLabel: rect.suggestedLabel,
                        isVisible: rect.isCreatedByAI ? aiLabelsVisible : true
                    });
                });
        }
        
        // 添加点标签（显示所有已接受的标签，AI标签始终显示但标记隐藏状态）
        if (imageData.labelPoints) {
            imageData.labelPoints
                .filter((point: LabelPoint) => point.status === LabelStatus.ACCEPTED)
                .forEach((point: LabelPoint) => {
                    allLabels.push({
                        id: point.id,
                        type: LabelType.POINT,
                        labelId: point.labelId,
                        isCreatedByAI: point.isCreatedByAI,
                        status: point.status,
                        suggestedLabel: point.suggestedLabel,
                        isVisible: point.isCreatedByAI ? aiLabelsVisible : true
                    });
                });
        }
        
        // 添加多边形标签（显示所有已接受的标签，AI标签始终显示但标记隐藏状态）
        if (imageData.labelPolygons) {
            imageData.labelPolygons
                .filter((polygon: LabelPolygon) => polygon.status === LabelStatus.ACCEPTED)
                .forEach((polygon: LabelPolygon) => {
                    allLabels.push({
                        id: polygon.id,
                        type: LabelType.POLYGON,
                        labelId: polygon.labelId,
                        isCreatedByAI: polygon.isCreatedByAI,
                        status: polygon.status,
                        suggestedLabel: polygon.suggestedLabel,
                        isVisible: polygon.isCreatedByAI ? segmentationLabelsVisible : true
                    });
                });
        }
        
        // 添加线条标签（显示所有已接受的标签，AI标签始终显示但标记隐藏状态）
        if (imageData.labelLines) {
            imageData.labelLines
                .filter((line: LabelLine) => line.status === LabelStatus.ACCEPTED)
                .forEach((line: LabelLine) => {
                    allLabels.push({
                        id: line.id,
                        type: LabelType.LINE,
                        labelId: line.labelId,
                        isCreatedByAI: line.isCreatedByAI,
                        status: line.status,
                        suggestedLabel: line.suggestedLabel,
                        isVisible: line.isCreatedByAI ? aiLabelsVisible : true
                    });
                });
        }
        
        // 最终结果日志已移除
        
        return allLabels;
    };

    // getLabelText函数已移除，因为LabelInputField会自己处理显示文本

    const deleteAllLabelById = (labelItem: LabelItem) => {
        switch (labelItem.type) {
            case LabelType.RECT:
                LabelActions.deleteRectLabelById(imageData.id, labelItem.id);
                break;
            case LabelType.POINT:
                LabelActions.deletePointLabelById(imageData.id, labelItem.id);
                break;
            case LabelType.POLYGON:
                LabelActions.deletePolygonLabelById(imageData.id, labelItem.id);
                break;
            case LabelType.LINE:
                LabelActions.deleteLineLabelById(imageData.id, labelItem.id);
                break;
        }
    };

    const updateAllLabelById = (labelItem: LabelItem, labelNameId: string) => {
        if (!imageData?.id) return;
        
        let newImageData = { ...imageData };
        
        switch (labelItem.type) {
            case LabelType.RECT:
                if (imageData.labelRects) {
                    newImageData.labelRects = imageData.labelRects.map((labelRect: LabelRect) => {
                        if (labelRect.id === labelItem.id) {
                            return { ...labelRect, labelId: labelNameId, status: LabelStatus.ACCEPTED };
                        }
                        return labelRect;
                    });
                }
                break;
            case LabelType.POINT:
                if (imageData.labelPoints) {
                    newImageData.labelPoints = imageData.labelPoints.map((labelPoint: LabelPoint) => {
                        if (labelPoint.id === labelItem.id) {
                            return { ...labelPoint, labelId: labelNameId, status: LabelStatus.ACCEPTED };
                        }
                        return labelPoint;
                    });
                }
                break;
            case LabelType.POLYGON:
                if (imageData.labelPolygons) {
                    newImageData.labelPolygons = imageData.labelPolygons.map((labelPolygon: LabelPolygon) => {
                        if (labelPolygon.id === labelItem.id) {
                            return { ...labelPolygon, labelId: labelNameId, status: LabelStatus.ACCEPTED };
                        }
                        return labelPolygon;
                    });
                }
                break;
            case LabelType.LINE:
                if (imageData.labelLines) {
                    newImageData.labelLines = imageData.labelLines.map((labelLine: LabelLine) => {
                        if (labelLine.id === labelItem.id) {
                            return { ...labelLine, labelId: labelNameId, status: LabelStatus.ACCEPTED };
                        }
                        return labelLine;
                    });
                }
                break;
        }
        
        updateImageDataByIdAction(imageData.id, newImageData);
        updateActiveLabelNameIdAction(labelNameId);
    };

    const getActualVisibility = (labelItem: LabelItem): boolean => {
        if (!imageData) return false;
        
        // 根据标签类型获取实际的可见性状态
        switch (labelItem.type) {
            case LabelType.RECT:
                const rect = imageData.labelRects?.find(r => r.id === labelItem.id);
                return rect ? rect.isVisible : false;
            case LabelType.POINT:
                const point = imageData.labelPoints?.find(p => p.id === labelItem.id);
                return point ? point.isVisible : false;
            case LabelType.POLYGON:
                const polygon = imageData.labelPolygons?.find(p => p.id === labelItem.id);
                return polygon ? polygon.isVisible : false;
            case LabelType.LINE:
                const line = imageData.labelLines?.find(l => l.id === labelItem.id);
                return line ? line.isVisible : false;
            default:
                return false;
        }
    };

    const toggleAllLabelVisibilityById = (labelItem: LabelItem) => {
        if (!imageData?.id) return;
        
        // 使用LabelActions的通用可见性切换方法
        LabelActions.toggleLabelVisibilityById(imageData.id, labelItem.id);
    };

    const onClickHandler = () => {
        updateActiveLabelIdAction(null);
    };

    const getChildren = () => {
        const allLabels = getAllLabels();
        
        return allLabels.map((labelItem: LabelItem) => {
            // 获取当前标签的LabelName对象
            const currentLabelName = labelItem.labelId ? 
                labelNames.find(label => label.id === labelItem.labelId) : null;
            
            return <LabelInputField
                size={{
                    width: size.width,
                    height: 40
                }}
                isActive={labelItem.id === activeLabelId}
                isHighlighted={labelItem.id === highlightedLabelId}
                isVisible={labelItem.isVisible !== undefined ? labelItem.isVisible : getActualVisibility(labelItem)}
                id={labelItem.id}
                key={labelItem.id}
                onDelete={() => deleteAllLabelById(labelItem)}
                value={currentLabelName}
                options={labelNames}
                onSelectLabel={(labelRectId: string, labelNameId: string) => updateAllLabelById(labelItem, labelNameId)}
                toggleLabelVisibility={() => toggleAllLabelVisibilityById(labelItem)}
            />
        })
    };

    const getAllLabelsCount = (): number => {
        return getAllLabels().length;
    };

    const listStyle: React.CSSProperties = {
        width: size?.width || 0,
        height: size?.height || 0
    };
    const listStyleContent: React.CSSProperties = {
        width: size?.width || 0,
        height: getAllLabelsCount() * 40
    };

    return(
        <div
            className='AllLabelsList'
            style={listStyle}
            onClickCapture={onClickHandler}
        >
            {(!imageData || getAllLabelsCount() === 0) ?
                <EmptyLabelList
                    labelBefore={currentTexts?.drawFirstLabel || 'draw your first label'}
                    labelAfter={currentTexts?.noLabelsCreated || 'no labels created for this image yet'}
                /> :
                <Scrollbars>
                    <div
                        className='AllLabelsListContent'
                        style={listStyleContent}
                    >
                        {getChildren()}
                    </div>
                </Scrollbars>
            }
        </div>
    )
};

const mapDispatchToProps = {
    updateImageDataByIdAction: updateImageDataById,
    updateActiveLabelNameIdAction: updateActiveLabelNameId,
    updateActiveLabelIdAction: updateActiveLabelId
};

const mapStateToProps = (state: AppState) => ({
    activeLabelId: state.labels.activeLabelId,
    highlightedLabelId: state.labels.highlightedLabelId,
    labelNames: state.labels.labels,
    imageAIStates: state.ai.imageAIStates,
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(AllLabelsList);
