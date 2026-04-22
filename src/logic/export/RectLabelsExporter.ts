import {AnnotationFormatType} from '../../data/enums/AnnotationFormatType';
import {ImageData, LabelName, LabelRect} from '../../store/labels/types';
import {ImageRepository} from '../imageRepository/ImageRepository';
import {LabelMeExporter} from './labelme/LabelMeExporter';
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
import {VideoSelector} from '../../store/selectors/VideoSelector';
import {FrameExtractorService} from '../../services/FrameExtractorService';

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
            case AnnotationFormatType.LABELME:
                LabelMeExporter.export(mode);
                break;
            default:
                return;
        }
    }

    // On-demand frames are placeholders (size=0). Fetch real data from backend when needed.
    private static async resolveFileData(imageData: ImageData, sessionId?: string): Promise<File> {
        if (!imageData.fileData || imageData.fileData.size > 0 || !sessionId) {
            return imageData.fileData;
        }
        const match = imageData.fileData.name.match(/(\d+)\.jpg$/);
        const frameIdx = match ? parseInt(match[1], 10) : 0;
        const frames = await FrameExtractorService.fetchFrameRange(sessionId, frameIdx, 1);
        return frames[0] ?? imageData.fileData;
    }

    private static async exportAsYOLO(mode: ExportMode): Promise<void> {
        const zip = new JSZip();
        const imagesData = LabelsSelector.getImagesData();

        if (mode === 'complete') {
            const split = DatasetSplitUtil.split(imagesData);
            const labelNames = LabelsSelector.getLabelNames();
            const sessionId = VideoSelector.getActiveVideo()?.sessionId;

            for (const [splitName, splitImages] of Object.entries(split)) {
                for (const imageData of splitImages) {
                    const fileContent = RectLabelsExporter.wrapRectLabelsIntoYOLO(imageData);
                    if (fileContent) {
                        const txtName = imageData.fileData.name.replace(/\.[^/.]+$/, '.txt');
                        zip.file(`labels/${splitName}/${txtName}`, fileContent);
                    }
                    if (imageData.fileData) {
                        const file = await RectLabelsExporter.resolveFileData(imageData, sessionId);
                        zip.file(`images/${splitName}/${file.name}`, file);
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
            zip.file('labels.txt', classNames.join('\n'));
        } else {
            const labelNames = LabelsSelector.getLabelNames();
            imagesData.forEach((imageData: ImageData) => {
                const fileContent = RectLabelsExporter.wrapRectLabelsIntoYOLO(imageData);
                if (fileContent) {
                    const fileName = imageData.fileData.name.replace(/\.[^/.]+$/, '.txt');
                    zip.file(fileName, fileContent);
                }
            });
            zip.file('labels.txt', labelNames.map(l => l.name).join('\n'));
        }

        const prefix = mode === 'complete' ? 'yolo_full' : 'yolo_simple';
        const content = await zip.generateAsync({type:'blob'});
        saveAs(content, `${ExporterUtil.getExportFileName(prefix)}.zip`);
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
        if (imageData.labelRects.length === 0)
            return null;

        const labelNames: LabelName[] = LabelsSelector.getLabelNames();
        // In video mode, ImageRepository stores 150px thumbnails, not full-res frames.
        // Use the actual video dimensions to avoid normalizing against the wrong size.
        const videoSize = VideoSelector.getActiveVideo()?.videoSize;
        let imageSize: ISize;
        if (videoSize?.width && videoSize.height) {
            imageSize = videoSize;
        } else {
            const image: HTMLImageElement = ImageRepository.getById(imageData.id);
            if (image) {
                imageSize = {width: image.width, height: image.height};
            } else {
                const fallback = LabelsSelector.getImagesData().find(d => d.loadStatus);
                const fallbackImg = fallback ? ImageRepository.getById(fallback.id) : null;
                if (!fallbackImg) return null;
                imageSize = {width: fallbackImg.width, height: fallbackImg.height};
            }
        }
        const labelRectsString: string[] = imageData.labelRects
            .filter((labelRect: LabelRect) => labelRect.labelId !== null)
            .map((labelRect: LabelRect) => {
                return RectLabelsExporter.wrapRectLabelIntoYOLO(labelRect, labelNames, imageSize)
            });
        return labelRectsString.join('\n');
    }

    private static async exportAsVOC(mode: ExportMode): Promise<void> {
        const zip = new JSZip();
        const imagesData = LabelsSelector.getImagesData();

        if (mode === 'complete') {
            const split = DatasetSplitUtil.split(imagesData);
            const sessionId = VideoSelector.getActiveVideo()?.sessionId;

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
                        const file = await RectLabelsExporter.resolveFileData(imageData, sessionId);
                        zip.file(`JPEGImages/${file.name}`, file);
                    }
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

        const vocPrefix = mode === 'complete' ? 'voc_full' : 'voc_simple';
        const content = await zip.generateAsync({type:'blob'});
        saveAs(content, `${ExporterUtil.getExportFileName(vocPrefix)}.zip`);
    }

    private static wrapRectLabelsIntoVOC(imageData: ImageData): string {
        if (imageData.labelRects.length === 0)
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
            let imgW = 0, imgH = 0;
            const videoSize = VideoSelector.getActiveVideo()?.videoSize;
            if (videoSize?.width && videoSize.height) {
                imgW = videoSize.width; imgH = videoSize.height;
            } else {
                const image: HTMLImageElement = ImageRepository.getById(imageData.id);
                if (image) {
                    imgW = image.width; imgH = image.height;
                } else {
                    const fallback = LabelsSelector.getImagesData().find(d => d.loadStatus);
                    const fb = fallback ? ImageRepository.getById(fallback.id) : null;
                    if (fb) { imgW = fb.width; imgH = fb.height; }
                }
            }
            return [
                `<annotation>`,
                `\t<folder>${projectName}</folder>`,
                `\t<filename>${imageData.fileData.name}</filename>`,
                `\t<path>/${projectName}/${imageData.fileData.name}</path>`,
                `\t<source>`,
                `\t\t<database>Unspecified</database>`,
                `\t</source>`,
                `\t<size>`,
                `\t\t<width>${imgW}</width>`,
                `\t\t<height>${imgH}</height>`,
                `\t\t<depth>3</depth>`,
                `\t</size>`,
                labels,
                `</annotation>`
            ].join('\n');
        }
        return null;
    }


    private static async exportAsCSV(mode: ExportMode): Promise<void> {
        const imagesData = LabelsSelector.getImagesData();

        if (mode === 'complete') {
            const zip = new JSZip();
            const split = DatasetSplitUtil.split(imagesData);
            const sessionId = VideoSelector.getActiveVideo()?.sessionId;

            for (const [splitName, splitImages] of Object.entries(split)) {
                const entries: string[] = splitImages
                    .map(d => RectLabelsExporter.wrapRectLabelsIntoCSV(d))
                    .filter(Boolean);
                entries.unshift(Settings.RECT_LABELS_EXPORT_CSV_COLUMN_NAMES);
                zip.file(`${splitName}.csv`, entries.join('\n'));

                for (const imageData of splitImages) {
                    if (imageData.fileData) {
                        const file = await RectLabelsExporter.resolveFileData(imageData, sessionId);
                        zip.file(`images/${splitName}/${file.name}`, file);
                    }
                }
            }

            const content = await zip.generateAsync({type:'blob'});
            saveAs(content, `${ExporterUtil.getExportFileName('csv_full')}.zip`);
        } else {
            const contentEntries: string[] = imagesData
                .map((imageData: ImageData) => RectLabelsExporter.wrapRectLabelsIntoCSV(imageData))
                .filter(Boolean);
            contentEntries.unshift(Settings.RECT_LABELS_EXPORT_CSV_COLUMN_NAMES);
            const content: string = contentEntries.join('\n');
            const fileName: string = `${ExporterUtil.getExportFileName('csv')}.csv`;
            ExporterUtil.saveAs(content, fileName);
        }
    }

    private static wrapRectLabelsIntoCSV(imageData: ImageData): string {
        if (imageData.labelRects.length === 0 || !imageData.loadStatus)
            return null;

        const labelNames: LabelName[] = LabelsSelector.getLabelNames();
        const videoSize = VideoSelector.getActiveVideo()?.videoSize;
        let imageSize: ISize;
        if (videoSize?.width && videoSize.height) {
            imageSize = videoSize;
        } else {
            const image: HTMLImageElement = ImageRepository.getById(imageData.id);
            imageSize = {width: image?.width ?? 0, height: image?.height ?? 0};
        }
        const labelRectsString: string[] = imageData.labelRects
            .filter((labelRect: LabelRect) => labelRect.labelId !== null)
            .map((labelRect: LabelRect) => RectLabelsExporter.wrapRectLabelIntoCSV(
                labelRect, labelNames, imageSize, imageData.fileData.name));
        return labelRectsString.join('\n');
    }
}
