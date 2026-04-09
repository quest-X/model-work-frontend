import React, { useState } from 'react';
import './ImportLabelPopup.scss';
import { LabelType } from '../../../data/enums/LabelType';
import { PopupActions } from '../../../logic/actions/PopupActions';
import { AppState } from '../../../store';
import { connect } from 'react-redux';
import { useDropzone } from 'react-dropzone';
import { ImageData, LabelName } from '../../../store/labels/types';
import { updateActiveLabelType, updateImageData, updateLabelNames } from '../../../store/labels/actionCreators';
import { ImporterSpecData } from '../../../data/ImporterSpecData';
import { AnnotationFormatType } from '../../../data/enums/AnnotationFormatType';
import { submitNewNotification } from '../../../store/notifications/actionCreators';
import { NotificationUtil } from '../../../utils/NotificationUtil';
import { NotificationsDataMap } from '../../../data/info/NotificationsData';
import { DocumentParsingError } from '../../../logic/import/voc/VOCImporter';
import { Notification } from '../../../data/enums/Notification';
import { LabelNamesNotUniqueError } from '../../../logic/import/yolo/YOLOErrors';
import { Language, LanguageConfig } from '../../../data/LanguageConfig';
import { GenericYesNoPopup } from '../GenericYesNoPopup/GenericYesNoPopup';
import JSZip from 'jszip';

interface IProps {
    activeLabelType: LabelType;
    updateImageDataAction: (imageData: ImageData[]) => any;
    updateLabelNamesAction: (labels: LabelName[]) => any;
    updateActiveLabelTypeAction: (activeLabelType: LabelType) => any;
    language: Language;
}

const ImportLabelPopup: React.FC<IProps> = ({
    activeLabelType,
    updateImageDataAction,
    updateLabelNamesAction,
    updateActiveLabelTypeAction,
    language
}) => {
    const currentTexts = LanguageConfig[language];
    const labelType = activeLabelType === LabelType.ALL ? LabelType.RECT : activeLabelType;

    const [loadedLabelNames, setLoadedLabelNames] = useState<LabelName[]>([]);
    const [loadedImageData, setLoadedImageData] = useState<ImageData[]>([]);
    const [annotationsLoadedError, setAnnotationsLoadedError] = useState<Error | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    const resolveNotification = (error: Error): Notification => {
        if (error instanceof DocumentParsingError) return Notification.ANNOTATION_FILE_PARSE_ERROR;
        if (error instanceof LabelNamesNotUniqueError) return Notification.NON_UNIQUE_LABEL_NAMES_ERROR;
        return Notification.ANNOTATION_IMPORT_ASSERTION_ERROR;
    };

    const onAnnotationLoadSuccess = (imagesData: ImageData[], labelNames: LabelName[]) => {
        setLoadedLabelNames(labelNames);
        setLoadedImageData(imagesData);
        setAnnotationsLoadedError(null);
        setIsProcessing(false);
    };

    const onAnnotationsLoadFailure = (error?: Error) => {
        setLoadedLabelNames([]);
        setLoadedImageData([]);
        setAnnotationsLoadedError(error);
        setIsProcessing(false);
        const notification = resolveNotification(error);
        submitNewNotification(NotificationUtil.createErrorNotification(NotificationsDataMap[notification]));
    };

    // Detect format from zip filename prefix: yolo_labels_*.zip → YOLO
    const detectFormatFromZipName = (name: string): AnnotationFormatType | null => {
        const lower = name.toLowerCase();
        if (lower.startsWith('yolo_')) return AnnotationFormatType.YOLO;
        if (lower.startsWith('voc_')) return AnnotationFormatType.VOC;
        if (lower.startsWith('coco_')) return AnnotationFormatType.COCO;
        if (lower.startsWith('vgg_')) return AnnotationFormatType.VGG;
        return null;
    };

    // Detect format from file contents/extensions
    const detectFormatFromFiles = (files: File[]): AnnotationFormatType | null => {
        const names = files.map(f => f.name.toLowerCase());
        if (names.some(n => n === 'labels.txt')) return AnnotationFormatType.YOLO;
        const exts = names.map(n => n.split('.').pop());
        if (exts.some(e => e === 'xml')) return AnnotationFormatType.VOC;
        if (exts.some(e => e === 'json')) return AnnotationFormatType.COCO;
        if (exts.some(e => e === 'txt')) return AnnotationFormatType.YOLO;
        return null;
    };

    const doImport = (files: File[], format: AnnotationFormatType) => {
        if (!ImporterSpecData[format]) {
            onAnnotationsLoadFailure(new Error('Unsupported file format'));
            return;
        }
        const importer = new (ImporterSpecData[format])([labelType]);
        importer.import(files, onAnnotationLoadSuccess, onAnnotationsLoadFailure);
    };

    const { acceptedFiles, getRootProps, getInputProps } = useDropzone({
        accept: {
            'application/json': ['.json'],
            'text/plain': ['.txt'],
            'application/xml': ['.xml'],
            'text/xml': ['.xml'],
            'application/zip': ['.zip'],
            'application/x-zip-compressed': ['.zip'],
            'application/octet-stream': ['.zip'],
        },
        multiple: true,
        onDrop: (accepted) => {
            if (accepted.length === 0) return;
            setIsProcessing(true);
            setAnnotationsLoadedError(null);

            const zipFile = accepted.find(f => f.name.toLowerCase().endsWith('.zip'));
            if (zipFile) {
                const zipFormat = detectFormatFromZipName(zipFile.name);
                JSZip.loadAsync(zipFile)
                    .then((zip) => {
                        const validExts = ['.json', '.txt', '.xml'];
                        const mimeMap: Record<string, string> = {
                            '.json': 'application/json',
                            '.txt': 'text/plain',
                            '.xml': 'application/xml',
                        };
                        const promises: Promise<File>[] = [];
                        zip.forEach((path, entry) => {
                            if (entry.dir) return;
                            const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
                            if (!validExts.includes(ext)) return;
                            promises.push(
                                entry.async('arraybuffer').then(buf => {
                                    const fileName = path.split('/').pop();
                                    return new File([buf], fileName, { type: mimeMap[ext] || 'text/plain' });
                                })
                            );
                        });
                        return Promise.all(promises).then(files => {
                            const format = zipFormat || detectFormatFromFiles(files);
                            if (!format) {
                                onAnnotationsLoadFailure(new Error('Cannot detect annotation format'));
                                return;
                            }
                            doImport(files, format);
                        });
                    })
                    .catch(err => {
                        onAnnotationsLoadFailure(err instanceof Error ? err : new Error(String(err)));
                    });
            } else {
                const format = detectFormatFromFiles(accepted);
                if (!format) {
                    onAnnotationsLoadFailure(new Error('Cannot detect annotation format'));
                    return;
                }
                doImport(accepted, format);
            }
        }
    });

    const onAccept = () => {
        if (loadedLabelNames.length !== 0 && loadedImageData.length !== 0) {
            updateImageDataAction(loadedImageData);
            updateLabelNamesAction(loadedLabelNames);
            updateActiveLabelTypeAction(labelType);
            PopupActions.close();
        }
    };

    const onReject = () => {
        PopupActions.close();
    };

    const getDropZoneContent = () => {
        if (isProcessing) {
            return <>
                <img draggable={false} alt={'processing'} src={'ico/box-opened.png'} />
                <p className='extraBold'>{language === Language.CHINESE ? '正在解析...' : 'Processing...'}</p>
            </>;
        } else if (annotationsLoadedError) {
            return <>
                <input {...getInputProps()} />
                <img draggable={false} alt={'error'} src={'ico/box-opened.png'} />
                <p className='extraBold'>{currentTexts.popups.importAnnotations.importError}</p>
                <p className='errorMessage'>{annotationsLoadedError.message}</p>
                <p className='extraBold'>{currentTexts.popups.importAnnotations.tryAgain}</p>
            </>;
        } else if (loadedImageData.length !== 0 && loadedLabelNames.length !== 0) {
            return <>
                <img draggable={false} alt={'success'} src={'ico/box-closed.png'} />
                <p className='extraBold'>{currentTexts.popups.importAnnotations.importReady}</p>
                <p>{currentTexts.popups.importAnnotations.importWarning}</p>
            </>;
        } else {
            return <>
                <input {...getInputProps()} />
                <img draggable={false} alt={'upload'} src={'ico/box-opened.png'} />
                <p className='extraBold'>{currentTexts.popups.importAnnotations.dropZoneMessage}</p>
                <p>{currentTexts.or}</p>
                <p className='extraBold'>{currentTexts.popups.importAnnotations.dropZoneActive}</p>
            </>;
        }
    };

    const renderContent = () => {
        return (<div className='ImportLabelPopupContent'>
            <div {...getRootProps({ className: 'DropZone' })}>
                {getDropZoneContent()}
            </div>
        </div>);
    };

    return (
        <GenericYesNoPopup
            title={currentTexts.popups.importAnnotations.title}
            renderContent={renderContent}
            acceptLabel={currentTexts.popups.importAnnotations.acceptButton}
            disableAcceptButton={loadedImageData.length === 0 || loadedLabelNames.length === 0 || !!annotationsLoadedError || isProcessing}
            onAccept={onAccept}
            rejectLabel={currentTexts.popups.importAnnotations.rejectButton}
            onReject={onReject}
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
