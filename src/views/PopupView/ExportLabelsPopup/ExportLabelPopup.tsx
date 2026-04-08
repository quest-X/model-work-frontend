import React, { useState } from 'react';
import './ExportLabelPopup.scss';
import { AnnotationFormatType } from '../../../data/enums/AnnotationFormatType';
import { RectLabelsExporter } from '../../../logic/export/RectLabelsExporter';
import { LabelType } from '../../../data/enums/LabelType';
import { ILabelFormatData } from '../../../interfaces/ILabelFormatData';
import { PointLabelsExporter } from '../../../logic/export/PointLabelsExport';
import { PopupActions } from '../../../logic/actions/PopupActions';
import { LineLabelsExporter } from '../../../logic/export/LineLabelExport';
import { PolygonLabelsExporter } from '../../../logic/export/polygon/PolygonLabelsExporter';
import { TagLabelsExporter } from '../../../logic/export/TagLabelsExport';
import GenericLabelTypePopup from '../GenericLabelTypePopup/GenericLabelTypePopup';
import { getExportFormatData } from '../../../data/ExportFormatData';
import { AppState } from '../../../store';
import { connect } from 'react-redux';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';

interface IProps {
    activeLabelType: LabelType,
    language: Language;
}

const ExportLabelPopup: React.FC<IProps> = ({ activeLabelType, language }) => {
    const currentTexts = LanguageConfig[language];
    const effectiveLabelType = activeLabelType === LabelType.ALL ? LabelType.RECT : activeLabelType;
    const [labelType, setLabelType] = useState(effectiveLabelType);
    const [exportFormatType, setExportFormatType] = useState(null);

    const onAccept = (type: LabelType) => {
        switch (type) {
            case LabelType.RECT:
                RectLabelsExporter.export(exportFormatType);
                break;
            case LabelType.POINT:
                PointLabelsExporter.export(exportFormatType);
                break;
            case LabelType.LINE:
                LineLabelsExporter.export(exportFormatType);
                break;
            case LabelType.POLYGON:
                PolygonLabelsExporter.export(exportFormatType);
                break;
            case LabelType.IMAGE_RECOGNITION:
                TagLabelsExporter.export(exportFormatType);
                break;
        }
        PopupActions.close();
    };

    const onReject = (type: LabelType) => {
        PopupActions.close();
    };

    const onSelect = (type: AnnotationFormatType) => {
        setExportFormatType(type);
    };

    const getOptions = (exportFormatData: ILabelFormatData[]) => {
        return exportFormatData.map((entry: ILabelFormatData) => {
            return <div
                className='OptionsItem'
                onClick={() => onSelect(entry.type)}
                key={entry.type}
            >
                {entry.type === exportFormatType ?
                    <img
                        draggable={false}
                        src={'ico/checkbox-checked.png'}
                        alt={'checked'}
                    /> :
                    <img
                        draggable={false}
                        src={'ico/checkbox-unchecked.png'}
                        alt={'unchecked'}
                    />}
                {entry.label}
            </div>;
        });
    };

    const renderInternalContent = (type: LabelType) => {
        return <>
            <div className='Message'>
                {currentTexts.popups.exportAnnotations.selectFormat}
            </div>,
            <div className='Options'>
                {getOptions(getExportFormatData(language)[type])}
            </div>
        </>;
    };

    const onLabelTypeChange = (type: LabelType) => {
        setLabelType(type);
        setExportFormatType(null);
    };

    return (
        <GenericLabelTypePopup
            activeLabelType={labelType}
            title={currentTexts.popups.exportAnnotations.title}
            onLabelTypeChange={onLabelTypeChange}
            acceptLabel={currentTexts.popups.exportAnnotations.acceptButton}
            onAccept={onAccept}
            disableAcceptButton={!exportFormatType}
            rejectLabel={currentTexts.popups.exportAnnotations.rejectButton}
            onReject={onReject}
            renderInternalContent={renderInternalContent}
        />
    );
};

const mapDispatchToProps = {};

const mapStateToProps = (state: AppState) => ({
    activeLabelType: state.labels.activeLabelType,
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ExportLabelPopup);