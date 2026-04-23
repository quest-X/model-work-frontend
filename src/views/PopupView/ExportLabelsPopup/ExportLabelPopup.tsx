import React, { useState } from 'react';
import './ExportLabelPopup.scss';
import { AnnotationFormatType } from '../../../data/enums/AnnotationFormatType';
import { RectLabelsExporter } from '../../../logic/export/RectLabelsExporter';
import { LabelType } from '../../../data/enums/LabelType';
import { ILabelFormatData } from '../../../interfaces/ILabelFormatData';
import { PointLabelsExporter } from '../../../logic/export/PointLabelsExporter';
import { PopupActions } from '../../../logic/actions/PopupActions';
import { LineLabelsExporter } from '../../../logic/export/LineLabelsExporter';
import { TagLabelsExporter } from '../../../logic/export/TagLabelsExporter';
import GenericLabelTypePopup from '../GenericLabelTypePopup/GenericLabelTypePopup';
import { getExportFormatData } from '../../../data/ExportFormatData';
import { AppState } from '../../../store';
import { connect } from 'react-redux';
import { Language, LanguageConfig } from '../../../data/LanguageConfig';
import { LabelMeExporter } from '../../../logic/export/labelme/LabelMeExporter';
import { YOLOPackExporter } from '../../../logic/export/yolo/YOLOPackExporter';
import { ImageData } from '../../../store/labels/types';

export type ExportMode = 'simple' | 'complete';
type ExportTarget = 'labelme' | 'yolo';

interface IProps {
    activeLabelType: LabelType;
    language: Language;
    imagesData: ImageData[];
}

const ExportLabelPopup: React.FC<IProps> = ({ activeLabelType, language, imageData }) => {
    const currentTexts = LanguageConfig[language];
    const exportTexts = currentTexts.popups.exportAnnotations;

    const hasRects = imagesData.some(img => img.labelRects.length > 0);
    const hasPolygons = imagesData.some(img => img.labelPolygons.length > 0);
    const allowedLabelTypes: LabelType[] = [];
    if (hasRects) allowedLabelTypes.push(LabelType.RECT);
    if (hasPolygons) allowedLabelTypes.push(LabelType.POLYGON);

    const resolveInitialType = (): LabelType => {
        if (activeLabelType !== LabelType.ALL && activeLabelType !== LabelType.RECT && activeLabelType !== LabelType.POLYGON)
            return activeLabelType;
        if (hasPolygons && !hasRects) return LabelType.POLYGON;
        if (hasRects || !hasPolygons) return LabelType.RECT;
        return activeLabelType === LabelType.ALL ? LabelType.RECT : activeLabelType;
    };

    const [labelType, setLabelType] = useState(resolveInitialType());
    const [exportFormatType, setExportFormatType] = useState<AnnotationFormatType>(null);
    const [exportTarget, setExportTarget] = useState<ExportTarget>('labelme');
    const [exportMode, setExportMode] = useState<ExportMode>('complete');

    const isDetectionOrSegmentation = labelType === LabelType.RECT || labelType === LabelType.POLYGON;
    const zh = language === Language.CHINESE;

    const onAccept = (type: LabelType) => {
        if (type === LabelType.RECT || type === LabelType.POLYGON) {
            if (exportTarget === 'labelme') {
                LabelMeExporter.export(exportMode);
            } else {
                YOLOPackExporter.export(exportMode);
            }
        } else {
            switch (type) {
                case LabelType.POINT:
                    PointLabelsExporter.export(exportFormatType);
                    break;
                case LabelType.LINE:
                    LineLabelsExporter.export(exportFormatType);
                    break;
                case LabelType.IMAGE_RECOGNITION:
                    TagLabelsExporter.export(exportFormatType);
                    break;
            }
        }
        PopupActions.close();
    };

    const onReject = () => {
        PopupActions.close();
    };

    const onSelect = (type: AnnotationFormatType) => {
        setExportFormatType(type);
    };

    const getOptions = (exportFormatData: ILabelFormatData[]) => {
        return exportFormatData.map((entry: ILabelFormatData) => (
            <div className='OptionsItem' onClick={() => onSelect(entry.type)} key={entry.type}>
                {entry.type === exportFormatType
                    ? <img draggable={false} src={'ico/checkbox-checked.png'} alt={'checked'} />
                    : <img draggable={false} src={'ico/checkbox-unchecked.png'} alt={'unchecked'} />}
                {entry.label}
            </div>
        ));
    };

    const renderInternalContent = (type: LabelType) => {
        if (type === LabelType.RECT || type === LabelType.POLYGON) {
            const check = (active: boolean) => (
                <img draggable={false} src={active ? 'ico/checkbox-checked.png' : 'ico/checkbox-unchecked.png'} alt={active ? 'checked' : 'unchecked'} />
            );
            return <>
                <div className='Message'>{exportTexts.selectFormat}</div>
                <div className='ModeToggle'>
                    <div
                        className={`ModeButton${exportTarget === 'labelme' ? ' active' : ''}`}
                        onClick={() => setExportTarget('labelme')}
                    >
                        {exportTexts.labelmePackageButton}
                        <span className='ModeDesc'>{exportTexts.labelmePackageDesc}</span>
                    </div>
                    <div
                        className={`ModeButton${exportTarget === 'yolo' ? ' active' : ''}`}
                        onClick={() => setExportTarget('yolo')}
                    >
                        {exportTexts.yoloPackageButton}
                        <span className='ModeDesc'>{exportTexts.yoloPackageDesc}</span>
                    </div>
                </div>
                <div className='Options'>
                    <div className='OptionsItem' onClick={() => setExportMode('simple')}>
                        {check(exportMode === 'simple')}{zh ? '简单（仅标签文件）' : 'Simple (labels only)'}
                    </div>
                    <div className='OptionsItem' onClick={() => setExportMode('complete')}>
                        {check(exportMode === 'complete')}{zh ? '完整（标签 + 图像）' : 'Complete (labels + images)'}
                    </div>
                </div>
            </>;
        }

        return <>
            <div className='Message'>{exportTexts.selectFormat}</div>
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
            title={exportTexts.title}
            onLabelTypeChange={onLabelTypeChange}
            acceptLabel={exportTexts.acceptButton}
            onAccept={onAccept}
            disableAcceptButton={isDetectionOrSegmentation ? false : !exportFormatType}
            rejectLabel={exportTexts.rejectButton}
            onReject={onReject}
            renderInternalContent={renderInternalContent}
            allowedLabelTypes={allowedLabelTypes.length > 0 ? allowedLabelTypes : undefined}
        />
    );
};

const mapStateToProps = (state: AppState) => ({
    activeLabelType: state.labels.activeLabelType,
    language: state.general.language,
    imageData: state.labels.imagesData,
});

export default connect(mapStateToProps, {})(ExportLabelPopup);
