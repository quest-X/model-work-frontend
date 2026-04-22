import React, { useState } from 'react';
import './ImportLabelPopup.scss';
import { LabelType } from '../../../data/enums/LabelType';
import { PopupActions } from '../../../logic/actions/PopupActions';
import { AppState } from '../../../store';
import { connect } from 'react-redux';
import { useDropzone } from 'react-dropzone';
import { ImageData, LabelName } from '../../../store/labels/types';
import { addImageData, updateActiveImageIndex, updateActiveLabelType, updateImageData, updateLabelNames } from '../../../store/labels/actionCreators';
import { ImporterSpecData } from '../../../data/ImporterSpecData';
import { ImageDataUtil } from '../../../utils/ImageDataUtil';
import { YOLOUtils } from '../../../logic/import/yolo/YOLOUtils';
import { FileUtil } from '../../../utils/FileUtil';
import { LabelsSelector } from '../../../store/selectors/LabelsSelector';
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
import { v4 as uuidv4 } from 'uuid';
import { ArrayUtil } from '../../../utils/ArrayUtil';
import { Settings } from '../../../settings/Settings';
import { LabelUtil } from '../../../utils/LabelUtil';

interface IProps {
    activeLabelType: LabelType;
    addImageDataAction: (imageData: ImageData[]) => any;
    updateImageDataAction: (imageData: ImageData[]) => any;
    updateLabelNamesAction: (labels: LabelName[]) => any;
    updateActiveLabelTypeAction: (activeLabelType: LabelType) => any;
    updateActiveImageIndexAction: (index: number) => any;
    language: Language;
}

const ImportLabelPopup: React.FC<IProps> = ({
    activeLabelType,
    addImageDataAction,
    updateImageDataAction,
    updateLabelNamesAction,
    updateActiveLabelTypeAction,
    updateActiveImageIndexAction,
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

    // Detect format and mode from zip filename prefix
    const detectFromZipName = (name: string): { format: AnnotationFormatType | null; isFull: boolean } => {
        const lower = name.toLowerCase();
        const isFull = lower.includes('_full');
        if (lower.startsWith('yolo_')) return { format: AnnotationFormatType.YOLO, isFull };
        if (lower.startsWith('voc_')) return { format: AnnotationFormatType.VOC, isFull };
        if (lower.startsWith('coco_')) return { format: AnnotationFormatType.COCO, isFull };
        if (lower.startsWith('vgg_')) return { format: AnnotationFormatType.VGG, isFull };
        if (lower.startsWith('csv_')) return { format: AnnotationFormatType.CSV, isFull };
        if (lower.startsWith('labelme_')) return { format: AnnotationFormatType.LABELME, isFull };
        return { format: null, isFull: false };
    };

    // Detect format from file extensions (synchronous; JSON defaults to COCO for zip-internal use)
    const detectFormatFromFiles = (files: File[]): AnnotationFormatType | null => {
        const names = files.map(f => f.name.toLowerCase());
        if (names.some(n => n === 'labels.txt')) return AnnotationFormatType.YOLO;
        const exts = names.map(n => n.split('.').pop());
        if (exts.some(e => e === 'xml')) return AnnotationFormatType.VOC;
        if (exts.some(e => e === 'json')) return AnnotationFormatType.COCO;
        if (exts.some(e => e === 'txt')) return AnnotationFormatType.YOLO;
        return null;
    };

    // Async JSON format detection: peek inside to distinguish LabelMe vs COCO
    const detectJsonFormat = (jsonFiles: File[]): Promise<AnnotationFormatType> => {
        if (jsonFiles.length > 1) return Promise.resolve(AnnotationFormatType.LABELME);
        return FileUtil.readFile(jsonFiles[0]).then(text => {
            try {
                const obj = JSON.parse(text);
                if (obj.shapes !== undefined && obj.imagePath !== undefined) {
                    return AnnotationFormatType.LABELME;
                }
            } catch {}
            return AnnotationFormatType.COCO;
        });
    };

    const loadImageDimensions = (file: File): Promise<{ file: File; width: number; height: number }> => {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve({ file, width: img.width, height: img.height });
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error(`Failed to load image: ${file.name}`));
            };
            img.src = url;
        });
    };

    const doFullYOLOImport = (imageFiles: File[], annotationFiles: File[]) => {
        // 1. Find labels.txt
        const labelsFile = annotationFiles.find(f => f.name.toLowerCase() === 'labels.txt');
        if (!labelsFile) {
            onAnnotationsLoadFailure(new Error('labels.txt not found in zip'));
            return;
        }

        // 2. Read labels.txt + load all image dimensions in parallel
        const labelsPromise = FileUtil.readFile(labelsFile).then(content => YOLOUtils.parseLabelsNamesFromString(content));
        const imagesPromise = Promise.all(imageFiles.map(f => loadImageDimensions(f)));

        // 3. Read all annotation .txt files (excluding labels.txt)
        const txtFiles = annotationFiles.filter(f => f.name.toLowerCase() !== 'labels.txt' && f.name.endsWith('.txt'));
        const txtContentsPromise = Promise.all(txtFiles.map(f => FileUtil.readFile(f)));

        Promise.all([labelsPromise, imagesPromise, txtContentsPromise])
            .then(([labelNames, loadedImages, txtContents]) => {
                // Build annotation map: basename → content
                const annotationMap: Record<string, string> = {};
                txtFiles.forEach((f, i) => {
                    const baseName = f.name.replace(/\.[^/.]+$/, '');
                    annotationMap[baseName] = txtContents[i];
                });

                // Create ImageData with annotations for each image
                const resultImageData: ImageData[] = loadedImages.map(({ file, width, height }) => {
                    const imageData = ImageDataUtil.createImageDataFromFileData(file);
                    const baseName = file.name.replace(/\.[^/.]+$/, '');
                    const annotationContent = annotationMap[baseName];
                    if (annotationContent) {
                        imageData.labelRects = YOLOUtils.parseYOLOAnnotationsFromString(
                            annotationContent, labelNames, { width, height }, file.name
                        );
                    }
                    return imageData;
                });
                resultImageData.sort((a, b) => a.fileData.name.localeCompare(b.fileData.name, undefined, { numeric: true }));
                onAnnotationLoadSuccess(resultImageData, labelNames);
            })
            .catch(err => onAnnotationsLoadFailure(err instanceof Error ? err : new Error(String(err))));
    };

    const doFullLabelMeImport = (imageFiles: File[], annotationFiles: File[]) => {
        const jsonFiles = annotationFiles.filter(f => f.name.toLowerCase().endsWith('.json'));
        const annotationsPromise = Promise.all(jsonFiles.map(f =>
            FileUtil.readFile(f).then(text => JSON.parse(text))
        ));

        annotationsPromise.then(annotations => {
            const allLabels = new Set<string>();
            annotations.forEach((ann: any) => (ann.shapes || []).forEach((s: any) => allLabels.add(s.label)));

            let colorIdx = 0;
            const labelNameMap: Record<string, LabelName> = {};
            allLabels.forEach(name => {
                labelNameMap[name] = {
                    id: uuidv4(),
                    name,
                    color: ArrayUtil.getByInfiniteIndex(Settings.LABEL_COLORS_PALETTE, colorIdx++)
                };
            });

            const imageDataByName: Record<string, ImageData> = {};
            const resultImageData: ImageData[] = imageFiles.map(file => {
                const imgData = ImageDataUtil.createImageDataFromFileData(file);
                imageDataByName[file.name] = imgData;
                return imgData;
            });

            const pushRect = (imgData: ImageData, labelId: string, points: [number, number][]) => {
                const [[x1, y1], [x2, y2]] = points;
                imgData.labelRects.push(LabelUtil.createLabelRect(labelId, {
                    x: Math.min(x1, x2), y: Math.min(y1, y2),
                    width: Math.abs(x2 - x1), height: Math.abs(y2 - y1)
                }));
            };

            for (const ann of annotations) {
                const baseName = ann.imagePath?.split('/').pop() || ann.imagePath;
                const imgData = imageDataByName[baseName];
                if (!imgData) continue;

                for (const shape of (ann.shapes || [])) {
                    const labelId = labelNameMap[shape.label]?.id;
                    if (!labelId) continue;

                    if (shape.shape_type === 'rectangle') {
                        pushRect(imgData, labelId, shape.points);
                    } else if (shape.shape_type === 'polygon') {
                        imgData.labelPolygons.push(LabelUtil.createLabelPolygon(
                            labelId, shape.points.map(([x, y]: [number, number]) => ({ x, y }))
                        ));
                    } else if (shape.shape_type === 'mask' && shape.points.length >= 2) {
                        pushRect(imgData, labelId, shape.points);
                    }
                }
            }

            resultImageData.sort((a, b) => a.fileData.name.localeCompare(b.fileData.name, undefined, { numeric: true }));
            onAnnotationLoadSuccess(resultImageData, Object.values(labelNameMap));
        }).catch(err => onAnnotationsLoadFailure(err instanceof Error ? err : new Error(String(err))));
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
                const { format: zipFormat, isFull } = detectFromZipName(zipFile.name);
                JSZip.loadAsync(zipFile)
                    .then((zip) => {
                        const annotationExts = ['.json', '.txt', '.xml'];
                        const imageExts = ['.jpg', '.jpeg', '.png', '.bmp', '.webp'];
                        const mimeMap: Record<string, string> = {
                            '.json': 'application/json',
                            '.txt': 'text/plain',
                            '.xml': 'application/xml',
                        };
                        const imageMimeMap: Record<string, string> = {
                            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                            '.png': 'image/png', '.bmp': 'image/bmp', '.webp': 'image/webp',
                        };

                        const annotationPromises: Promise<File>[] = [];
                        const imagePromises: Promise<File>[] = [];

                        zip.forEach((path, entry) => {
                            if (entry.dir) return;
                            const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
                            const fileName = path.split('/').pop();

                            if (annotationExts.includes(ext)) {
                                annotationPromises.push(
                                    entry.async('arraybuffer').then(buf =>
                                        new File([buf], fileName, { type: mimeMap[ext] || 'text/plain' })
                                    )
                                );
                            } else if (isFull && imageExts.includes(ext)) {
                                imagePromises.push(
                                    entry.async('arraybuffer').then(buf =>
                                        new File([buf], fileName, { type: imageMimeMap[ext] || 'image/jpeg' })
                                    )
                                );
                            }
                        });

                        return Promise.all([
                            Promise.all(annotationPromises),
                            Promise.all(imagePromises)
                        ]).then(([annotationFiles, imageFiles]) => {
                            if (isFull && imageFiles.length > 0 && zipFormat === AnnotationFormatType.YOLO) {
                                // Full YOLO import: load images, parse annotations, build ImageData with labels in one pass
                                doFullYOLOImport(imageFiles, annotationFiles);
                            } else if (isFull && imageFiles.length > 0 && zipFormat === AnnotationFormatType.LABELME) {
                                doFullLabelMeImport(imageFiles, annotationFiles);
                            } else if (isFull && imageFiles.length > 0) {
                                // Full non-YOLO (non-LabelMe): add images first, then import labels
                                const newImageData = imageFiles.map(f => ImageDataUtil.createImageDataFromFileData(f));
                                addImageDataAction(newImageData);
                                const format = zipFormat || detectFormatFromFiles(annotationFiles);
                                if (!format) {
                                    onAnnotationsLoadFailure(new Error('Cannot detect annotation format'));
                                    return;
                                }
                                setTimeout(() => doImport(annotationFiles, format), 500);
                            } else {
                                const format = zipFormat || detectFormatFromFiles(annotationFiles);
                                if (!format) {
                                    onAnnotationsLoadFailure(new Error('Cannot detect annotation format'));
                                    return;
                                }
                                doImport(annotationFiles, format);
                            }
                        });
                    })
                    .catch(err => {
                        onAnnotationsLoadFailure(err instanceof Error ? err : new Error(String(err)));
                    });
            } else {
                const jsonFiles = accepted.filter(f => f.name.toLowerCase().endsWith('.json'));
                if (jsonFiles.length > 0) {
                    detectJsonFormat(jsonFiles).then(format => {
                        doImport(accepted, format);
                    }).catch(() => onAnnotationsLoadFailure(new Error('Cannot read annotation file')));
                } else {
                    const format = detectFormatFromFiles(accepted);
                    if (!format) {
                        onAnnotationsLoadFailure(new Error('Cannot detect annotation format'));
                        return;
                    }
                    doImport(accepted, format);
                }
            }
        }
    });

    const onAccept = () => {
        if (loadedLabelNames.length !== 0 && loadedImageData.length !== 0) {
            // If loaded images have fileData (from full import), add them; otherwise update existing
            const hasNewImages = loadedImageData.some(d => d.fileData && d.id && !LabelsSelector.getImagesData().find(e => e.id === d.id));
            if (hasNewImages) {
                addImageDataAction(loadedImageData);
                updateActiveImageIndexAction(0);
            } else {
                updateImageDataAction(loadedImageData);
            }
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
    addImageDataAction: addImageData,
    updateImageDataAction: updateImageData,
    updateLabelNamesAction: updateLabelNames,
    updateActiveLabelTypeAction: updateActiveLabelType,
    updateActiveImageIndexAction: updateActiveImageIndex
};

const mapStateToProps = (state: AppState) => ({
    activeLabelType: state.labels.activeLabelType,
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ImportLabelPopup);
