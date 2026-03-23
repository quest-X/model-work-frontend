import React, { useState } from 'react';
import './ImportLabelPopup.scss';
import { LabelType } from '../../../data/enums/LabelType';
import { PopupActions } from '../../../logic/actions/PopupActions';
import GenericLabelTypePopup from '../GenericLabelTypePopup/GenericLabelTypePopup';
import { getImportFormatData } from '../../../data/ImportFormatData';
import FeatureInProgress from '../../EditorView/FeatureInProgress/FeatureInProgress';
import { AppState } from '../../../store';
import { connect } from 'react-redux';
import { useDropzone } from 'react-dropzone';
import { ImageData, LabelName } from '../../../store/labels/types';
import { updateActiveLabelType, updateImageData, updateLabelNames } from '../../../store/labels/actionCreators';
import { ImporterSpecData } from '../../../data/ImporterSpecData';
import { AnnotationFormatType } from '../../../data/enums/AnnotationFormatType';
import { ILabelFormatData } from '../../../interfaces/ILabelFormatData';
import { submitNewNotification } from '../../../store/notifications/actionCreators';
import { NotificationUtil } from '../../../utils/NotificationUtil';
import { NotificationsDataMap } from '../../../data/info/NotificationsData';
import { DocumentParsingError } from '../../../logic/import/voc/VOCImporter';
import { Notification } from '../../../data/enums/Notification';
import {LabelNamesNotUniqueError} from '../../../logic/import/yolo/YOLOErrors';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';

interface IProps {
    activeLabelType: LabelType,
    updateImageDataAction: (imageData: ImageData[]) => any,
    updateLabelNamesAction: (labels: LabelName[]) => any,
    updateActiveLabelTypeAction: (activeLabelType: LabelType) => any;
    language: Language;
}

const ImportLabelPopup: React.FC<IProps> = (
    {
        activeLabelType,
        updateImageDataAction,
        updateLabelNamesAction,
        updateActiveLabelTypeAction,
        language
    }) => {
    const currentTexts = LanguageConfig[language];
    const resolveFormatType = (labelType: LabelType): AnnotationFormatType => {
        const possibleImportFormats = getImportFormatData(language)[labelType];
        return possibleImportFormats.length === 1 ? possibleImportFormats[0].type : null;
    };

    const [labelType, setLabelType] = useState(activeLabelType);
    const [formatType, setFormatType] = useState(resolveFormatType(activeLabelType));
    const [loadedLabelNames, setLoadedLabelNames] = useState([]);
    const [loadedImageData, setLoadedImageData] = useState([]);
    const [annotationsLoadedError, setAnnotationsLoadedError] = useState(null);

    const resolveNotification = (error: Error): Notification => {
        if (error instanceof DocumentParsingError) {
            return Notification.ANNOTATION_FILE_PARSE_ERROR
        }
        if (error instanceof LabelNamesNotUniqueError) {
            return Notification.NON_UNIQUE_LABEL_NAMES_ERROR
        }
        return Notification.ANNOTATION_IMPORT_ASSERTION_ERROR
    }

    const onLabelTypeChange = (type: LabelType) => {
        setLabelType(type);
        setFormatType(resolveFormatType(type));
        setLoadedLabelNames([]);
        setLoadedImageData([]);
        setAnnotationsLoadedError(null);
    };

    const onAnnotationLoadSuccess = (imagesData: ImageData[], labelNames: LabelName[]) => {
        setLoadedLabelNames(labelNames);
        setLoadedImageData(imagesData);
        setAnnotationsLoadedError(null);
    };

    const onAnnotationsLoadFailure = (error?: Error) => {
        setLoadedLabelNames([]);
        setLoadedImageData([]);
        setAnnotationsLoadedError(error);
        const notification = resolveNotification(error)
        submitNewNotification(NotificationUtil.createErrorNotification(NotificationsDataMap[notification]));
    };

    const { getRootProps, getInputProps } = useDropzone({
        accept: {
            "application/json": [".json" ],
            "text/plain": [".txt"],
            "application/xml": [".xml"],
        },
        multiple: true,
        onDrop: (acceptedFiles) => {
            const importer = new (ImporterSpecData[formatType])([labelType]);
            importer.import(acceptedFiles, onAnnotationLoadSuccess, onAnnotationsLoadFailure);
        }
    });

    const onAccept = (type: LabelType) => {
        if (loadedLabelNames.length !== 0 && loadedImageData.length !== 0) {
            updateImageDataAction(loadedImageData);
            updateLabelNamesAction(loadedLabelNames);
            updateActiveLabelTypeAction(type);
            PopupActions.close();
        }
    };

    const onReject = (_: LabelType) => {
        PopupActions.close();
    };

    const onAnnotationFormatChange = (format: AnnotationFormatType) => {
        setFormatType(format);
    };

    const getDropZoneContent = () => {
        if (annotationsLoadedError) {
            return <>
                <input {...getInputProps()} />
                <img
                    draggable={false}
                    alt={'upload'}
                    src={'ico/box-opened.png'}
                />
                <p className='extraBold'>{currentTexts.popups.importAnnotations.importError}</p>
                {annotationsLoadedError.message}
                <p className='extraBold'>{currentTexts.popups.importAnnotations.tryAgain}</p>
            </>;
        } else if (loadedImageData.length !== 0 && loadedLabelNames.length !== 0) {
            return <>
                <img
                    draggable={false}
                    alt={'uploaded'}
                    src={'ico/box-closed.png'}
                />
                <p className='extraBold'>{currentTexts.popups.importAnnotations.importReady}</p>
                {currentTexts.popups.importAnnotations.importWarning}
            </>;
        } else {
            return <>
                <input {...getInputProps()} />
                <img
                    draggable={false}
                    alt={'upload'}
                    src={'ico/box-opened.png'}
                />
                <p className='extraBold'>{currentTexts.popups.importAnnotations.dropZoneMessage}</p>
                <p>{currentTexts.or}</p>
                <p className='extraBold'>{currentTexts.popups.importAnnotations.dropZoneActive}</p>
            </>;
        }
    };

    const getOptions = (exportFormatData: ILabelFormatData[]) => {
        return exportFormatData.map((entry: ILabelFormatData) => {
            return <div
                className='OptionsItem'
                onClick={() => onAnnotationFormatChange(entry.type)}
                key={entry.type}
            >
                {entry.type === formatType ?
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
        if (!formatType && getImportFormatData(language)[type].length !== 0) {
            return <>
                <div className='Message'>
                    {currentTexts.popups.importAnnotations.selectFileFormat}
                </div>,
                <div className='Options'>
                    {getOptions(getImportFormatData(language)[type])}
                </div>
            </>;
        }
        const importFormatData = getImportFormatData(language)[type];
        return importFormatData.length === 0 ?
            <FeatureInProgress language={language} /> :
            <div {...getRootProps({ className: 'DropZone' })}>
                {getDropZoneContent()}
            </div>;
    };

    return (
        <GenericLabelTypePopup
            activeLabelType={labelType}
            title={currentTexts.popups.importAnnotations.title}
            onLabelTypeChange={onLabelTypeChange}
            acceptLabel={currentTexts.popups.importAnnotations.acceptButton}
            onAccept={onAccept}
            skipAcceptButton={getImportFormatData(language)[labelType].length === 0}
            disableAcceptButton={loadedImageData.length === 0 || loadedLabelNames.length === 0 || !!annotationsLoadedError}
            rejectLabel={currentTexts.popups.importAnnotations.rejectButton}
            onReject={onReject}
            renderInternalContent={renderInternalContent}
        />
    );
};

const mapDispatchToProps = {
    updateImageDataAction: updateImageData,
    updateLabelNamesAction: updateLabelNames,
    updateActiveLabelTypeAction: updateActiveLabelType
};

const mapStateToProps = (state: AppState) => ({
    activeLabelType: state.labels.activeLabelType,
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ImportLabelPopup);
