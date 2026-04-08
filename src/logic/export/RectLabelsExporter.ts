import {AnnotationFormatType} from '../../data/enums/AnnotationFormatType';
import {ImageData, LabelName, LabelRect} from '../../store/labels/types';
import {ImageRepository} from '../imageRepository/ImageRepository';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {LabelsSelector} from '../../store/selectors/LabelsSelector';
import {XMLSanitizerUtil} from '../../utils/XMLSanitizerUtil';
import {ExporterUtil} from '../../utils/ExporterUtil';
import {GeneralSelector} from '../../store/selectors/GeneralSelector';
import {findIndex, findLast} from 'lodash';
import {ISize} from '../../interfaces/ISize';
import {NumberUtil} from '../../utils/NumberUtil';
import {RectUtil} from '../../utils/RectUtil';
import {Settings} from '../../settings/Settings';
import {DatasetSplitUtil} from '../../utils/DatasetSplitUtil';
import {ExportMode} from '../../views/PopupView/ExportLabelsPopup/ExportLabelPopup';

export class RectLabelsExporter {
    public static export(exportFormatType: AnnotationFormatType, mode: ExportMode = 'simple'): void {
        switch (exportFormatType) {
            case AnnotationFormatType.YOLO:
                RectLabelsExporter.exportAsYOLO(mode);
                break;
            case AnnotationFormatType.VOC:
                RectLabelsExporter.exportAsVOC(mode);
                break;
            case AnnotationFormatType.CSV:
                RectLabelsExporter.exportAsCSV(mode);
                break;
            default:
                return;
        }
    }

    private static exportAsYOLO(mode: ExportMode): void {
        const zip = new JSZip();
        const imagesData = LabelsSelector.getImagesData();

        if (mode === 'complete') {
            const split = DatasetSplitUtil.split(imagesData);
            const labelNames = LabelsSelector.getLabelNames();

            for (const [splitName, splitImages] of Object.entries(split)) {
                for (const imageData of splitImages) {
                    const fileContent = RectLabelsExporter.wrapRectLabelsIntoYOLO(imageData);
                    if (fileContent) {
                        const txtName = imageData.fileData.name.replace(/\.[^/.]+$/, '.txt');
                        zip.file(`labels/${splitName}/${txtName}`, fileContent);
                    }
                    if (imageData.fileData) {
                        zip.file(`images/${splitName}/${imageData.fileData.name}`, imageData.fileData);
                    }
                }
            }

            // data.yaml
            const classNames = labelNames.map(l => l.name);
            const yaml = [
                `train: images/train`,
                `val: images/val`,
                `test: images/test`,
                ``,
                `nc: ${classNames.length}`,
                `names: [${classNames.map(n => `'${n}'`).join(', ')}]`,
            ].join('\n');
            zip.file('data.yaml', yaml);
        } else {
            imagesData.forEach((imageData: ImageData) => {
                const fileContent = RectLabelsExporter.wrapRectLabelsIntoYOLO(imageData);
                if (fileContent) {
                    const fileName = imageData.fileData.name.replace(/\.[^/.]+$/, '.txt');
                    zip.file(fileName, fileContent);
                }
            });
        }

        zip.generateAsync({type:'blob'}).then((content: Blob) => {
            saveAs(content, `${ExporterUtil.getExportFileName()}.zip`);
        });
    }

    public static wrapRectLabelIntoYOLO(labelRect: LabelRect, labelNames: LabelName[], imageSize: ISize): string {
        const snapAndFix = (value: number) => NumberUtil.snapValueToRange(value,0, 1).toFixed(6)
        const classIdx: string = findIndex(labelNames, {id: labelRect.labelId}).toString()
        const rectCenter = RectUtil.getCenter(labelRect.rect)
        const rectSize = RectUtil.getSize(labelRect.rect)
        const rawBBox: number[] = [
            rectCenter.x / imageSize.width,
            rectCenter.y / imageSize.height,
            rectSize.width / imageSize.width,
            rectSize.height / imageSize.height
        ]

        let [x, y, width, height] = rawBBox.map((value: number) => parseFloat(snapAndFix(value)))

        if (x + width / 2 > 1) { width = 2 * (1 - x) }
        if (x - width / 2 < 0) { width = 2 * x }
        if (y + height / 2 > 1) { height = 2 * (1 - y) }
        if (y - height / 2 < 0) { height = 2 * y }

        const processedBBox = [x, y, width, height].map((value: number) => snapAndFix(value))

        return [classIdx, ...processedBBox].join(' ')
    }

    public static wrapRectLabelIntoCSV(
        labelRect: LabelRect,
        labelNames: LabelName[],
        imageSize: ISize,
        imageName: string
    ): string {
        const labelName: LabelName = findLast(labelNames, {id: labelRect.labelId});
        const labelFields = [
            !!labelName ? labelName.name: '',
            Math.round(labelRect.rect.x).toString(),
            Math.round(labelRect.rect.y).toString(),
            Math.round(labelRect.rect.width).toString(),
            Math.round(labelRect.rect.height).toString(),
            imageName,
            imageSize.width.toString(),
            imageSize.height.toString()
        ];
        return labelFields.join(Settings.CSV_SEPARATOR)
    }

    private static wrapRectLabelsIntoYOLO(imageData: ImageData): string {
        if (imageData.labelRects.length === 0 || !imageData.loadStatus)
            return null;

        const labelNames: LabelName[] = LabelsSelector.getLabelNames();
        const image: HTMLImageElement = ImageRepository.getById(imageData.id);
        const imageSize: ISize = {width: image.width, height: image.height}
        const labelRectsString: string[] = imageData.labelRects
            .filter((labelRect: LabelRect) => labelRect.labelId !== null)
            .map((labelRect: LabelRect) => {
                return RectLabelsExporter.wrapRectLabelIntoYOLO(labelRect, labelNames, imageSize)
            });
        return labelRectsString.join('\n');
    }

    private static exportAsVOC(mode: ExportMode): void {
        const zip = new JSZip();
        const imagesData = LabelsSelector.getImagesData();

        if (mode === 'complete') {
            const split = DatasetSplitUtil.split(imagesData);
            const allImages: ImageData[] = [];

            for (const [splitName, splitImages] of Object.entries(split)) {
                const fileNames: string[] = [];
                for (const imageData of splitImages) {
                    const fileContent = RectLabelsExporter.wrapImageIntoVOC(imageData);
                    if (fileContent) {
                        const xmlName = imageData.fileData.name.replace(/\.[^/.]+$/, '.xml');
                        zip.file(`Annotations/${xmlName}`, fileContent);
                        fileNames.push(imageData.fileData.name.replace(/\.[^/.]+$/, ''));
                    }
                    if (imageData.fileData) {
                        zip.file(`JPEGImages/${imageData.fileData.name}`, imageData.fileData);
                    }
                    allImages.push(imageData);
                }
                zip.file(`ImageSets/Main/${splitName}.txt`, fileNames.join('\n'));
            }
        } else {
            imagesData.forEach((imageData: ImageData) => {
                const fileContent = RectLabelsExporter.wrapImageIntoVOC(imageData);
                if (fileContent) {
                    const fileName = imageData.fileData.name.replace(/\.[^/.]+$/, '.xml');
                    zip.file(fileName, fileContent);
                }
            });
        }

        zip.generateAsync({type:'blob'}).then(content => {
            saveAs(content, `${ExporterUtil.getExportFileName()}.zip`);
        });
    }

    private static wrapRectLabelsIntoVOC(imageData: ImageData): string {
        if (imageData.labelRects.length === 0 || !imageData.loadStatus)
            return null;

        const labelNamesList: LabelName[] = LabelsSelector.getLabelNames();
        const labelRectsString: string[] = imageData.labelRects.map((labelRect: LabelRect) => {
            const labelName: LabelName = findLast(labelNamesList, {id: labelRect.labelId});
            const labelFields = !!labelName ? [
                `\t<object>`,
                `\t\t<name>${labelName.name}</name>`,
                `\t\t<pose>Unspecified</pose>`,
                `\t\t<truncated>0</truncated>`,
                `\t\t<difficult>0</difficult>`,
                `\t\t<bndbox>`,
                `\t\t\t<xmin>${Math.round(labelRect.rect.x)}</xmin>`,
                `\t\t\t<ymin>${Math.round(labelRect.rect.y)}</ymin>`,
                `\t\t\t<xmax>${Math.round(labelRect.rect.x + labelRect.rect.width)}</xmax>`,
                `\t\t\t<ymax>${Math.round(labelRect.rect.y + labelRect.rect.height)}</ymax>`,
                `\t\t</bndbox>`,
                `\t</object>`
            ] : [];
            return labelFields.join('\n')
        });
        return labelRectsString.join('\n');
    }

    private static wrapImageIntoVOC(imageData: ImageData): string {
        const labels: string = RectLabelsExporter.wrapRectLabelsIntoVOC(imageData);
        const projectName: string = XMLSanitizerUtil.sanitize(GeneralSelector.getProjectName());

        if (labels) {
            const image: HTMLImageElement = ImageRepository.getById(imageData.id);
            return [
                `<annotation>`,
                `\t<folder>${projectName}</folder>`,
                `\t<filename>${imageData.fileData.name}</filename>`,
                `\t<path>/${projectName}/${imageData.fileData.name}</path>`,
                `\t<source>`,
                `\t\t<database>Unspecified</database>`,
                `\t</source>`,
                `\t<size>`,
                `\t\t<width>${image.width}</width>`,
                `\t\t<height>${image.height}</height>`,
                `\t\t<depth>3</depth>`,
                `\t</size>`,
                labels,
                `</annotation>`
            ].join('\n');
        }
        return null;
    }


    private static exportAsCSV(mode: ExportMode): void {
        const imagesData = LabelsSelector.getImagesData();

        if (mode === 'complete') {
            const zip = new JSZip();
            const split = DatasetSplitUtil.split(imagesData);

            for (const [splitName, splitImages] of Object.entries(split)) {
                const entries: string[] = splitImages
                    .map(d => RectLabelsExporter.wrapRectLabelsIntoCSV(d))
                    .filter(Boolean);
                entries.unshift(Settings.RECT_LABELS_EXPORT_CSV_COLUMN_NAMES);
                zip.file(`${splitName}.csv`, entries.join('\n'));

                for (const imageData of splitImages) {
                    if (imageData.fileData) {
                        zip.file(`images/${splitName}/${imageData.fileData.name}`, imageData.fileData);
                    }
                }
            }

            zip.generateAsync({type:'blob'}).then((content: Blob) => {
                saveAs(content, `${ExporterUtil.getExportFileName()}.zip`);
            });
        } else {
            const contentEntries: string[] = imagesData
                .map((imageData: ImageData) => RectLabelsExporter.wrapRectLabelsIntoCSV(imageData))
                .filter(Boolean);
            contentEntries.unshift(Settings.RECT_LABELS_EXPORT_CSV_COLUMN_NAMES);
            const content: string = contentEntries.join('\n');
            const fileName: string = `${ExporterUtil.getExportFileName()}.csv`;
            ExporterUtil.saveAs(content, fileName);
        }
    }

    private static wrapRectLabelsIntoCSV(imageData: ImageData): string {
        if (imageData.labelRects.length === 0 || !imageData.loadStatus)
            return null;

        const image: HTMLImageElement = ImageRepository.getById(imageData.id);
        const labelNames: LabelName[] = LabelsSelector.getLabelNames();
        const imageSize: ISize = {width: image.width, height: image.height}
        const labelRectsString: string[] = imageData.labelRects
            .filter((labelRect: LabelRect) => labelRect.labelId !== null)
            .map((labelRect: LabelRect) => RectLabelsExporter.wrapRectLabelIntoCSV(
                labelRect, labelNames, imageSize, imageData.fileData.name));
        return labelRectsString.join('\n');
    }
}
