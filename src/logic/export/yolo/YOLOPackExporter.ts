import {ImageData, LabelName, LabelPolygon, LabelRect} from '../../../store/labels/types';
import {LabelsSelector} from '../../../store/selectors/LabelsSelector';
import {VideoSelector} from '../../../store/selectors/VideoSelector';
import {ImageRepository} from '../../imageRepository/ImageRepository';
import {DatasetSplitUtil} from '../../../utils/DatasetSplitUtil';
import {ExporterUtil} from '../../../utils/ExporterUtil';
import {NumberUtil} from '../../../utils/NumberUtil';
import {submitNewNotification} from '../../../store/notifications/actionCreators';
import {NotificationUtil} from '../../../utils/NotificationUtil';
import {RectLabelsExporter} from '../RectLabelsExporter';
import {resolveExportImageFiles} from '../ExportImageResolver';
import {findIndex} from 'lodash';
import JSZip from 'jszip';
import {saveAs} from 'file-saver';
import {ISize} from '../../../interfaces/ISize';

const snapFix = (value: number): string =>
    NumberUtil.snapValueToRange(value, 0, 1).toFixed(6);

const resolveImageSize = (imageData: ImageData, allImagesData: ImageData[], videoSize?: ISize): ISize | null => {
    if (videoSize?.width && videoSize.height) return videoSize;

    const img = ImageRepository.getById(imageData.id);
    if (img) return {width: img.width, height: img.height};

    const fallback = allImagesData.find(d => d.loadStatus);
    const fallbackImg = fallback ? ImageRepository.getById(fallback.id) : null;
    if (fallbackImg) return {width: fallbackImg.width, height: fallbackImg.height};

    return null;
};

const buildSegmentationLine = (
    labelPolygon: LabelPolygon,
    labelNames: LabelName[],
    size: ISize
): string => {
    const classIdx = findIndex(labelNames, {id: labelPolygon.labelId});
    const coords = labelPolygon.vertices.flatMap(v => [
        snapFix(v.x / size.width),
        snapFix(v.y / size.height),
    ]);
    return [classIdx, ...coords].join(' ');
};

const buildRectAsSegLine = (labelRect: LabelRect, labelNames: LabelName[], size: ISize): string => {
    const classIdx = findIndex(labelNames, {id: labelRect.labelId});
    const {x, y, width, height} = labelRect.rect;
    const corners = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
    const coords = corners.flatMap(([px, py]) => [snapFix(px / size.width), snapFix(py / size.height)]);
    return [classIdx, ...coords].join(' ');
};

const buildLabelFileContent = (
    imageData: ImageData,
    labelNames: LabelName[],
    size: ISize,
    useSegmentation: boolean
): string | null => {
    const lines: string[] = [];

    if (useSegmentation) {
        imageData.labelPolygons
            .filter(p => p.labelId !== null)
            .forEach(p => lines.push(buildSegmentationLine(p, labelNames, size)));
        imageData.labelRects
            .filter(r => r.labelId !== null)
            .forEach(r => lines.push(buildRectAsSegLine(r, labelNames, size)));
    } else {
        imageData.labelRects
            .filter(r => r.labelId !== null)
            .forEach(r => lines.push(RectLabelsExporter.wrapRectLabelIntoYOLO(r, labelNames, size)));
    }

    return lines.length > 0 ? lines.join('\n') : null;
};

export class YOLOPackExporter {
    public static export(mode: 'simple' | 'complete' = 'complete'): void {
        const allImagesData: ImageData[] = LabelsSelector.getImagesData();
        const labelNames: LabelName[] = LabelsSelector.getLabelNames();

        const hasPolygons = allImagesData.some(img => img.labelPolygons.length > 0);
        const hasRects = allImagesData.some(img => img.labelRects.length > 0);

        if (!hasPolygons && !hasRects) return;

        const useSegmentation = hasPolygons;
        const activeVideo = VideoSelector.getActiveVideo();
        const videoSize = activeVideo?.videoSize;

        if (mode === 'simple') {
            const folderName = ExporterUtil.getExportFileName('yolo_simple');
            const zip = new JSZip();
            for (const imageData of allImagesData) {
                const size = resolveImageSize(imageData, allImagesData, videoSize);
                if (!size) continue;
                const content = buildLabelFileContent(imageData, labelNames, size, useSegmentation);
                if (content) {
                    const txtName = imageData.fileData.name.replace(/\.[^/.]+$/, '.txt');
                    zip.file(`${folderName}/${txtName}`, content);
                }
            }
            zip.file(`${folderName}/labels.txt`, labelNames.map(l => l.name).join('\n'));
            zip.generateAsync({type: 'blob'}).then((blob: Blob) => {
                saveAs(blob, `${folderName}.zip`);
            });
            return;
        }

        const folderName = ExporterUtil.getExportFileName('yolo_train');
        resolveExportImageFiles(allImagesData, activeVideo)
            .then(imageFileMap => {
                const missing = allImagesData.filter(img =>
                    (img.labelRects.length > 0 || img.labelPolygons.length > 0) &&
                    !imageFileMap.has(img.id)
                );
                if (missing.length > 0) {
                    submitNewNotification(NotificationUtil.createErrorNotification({
                        header: '导出失败',
                        description: `${missing.length} 张图片无法获取原始分辨率，请确认后端连接正常后重试。`,
                    }));
                    return;
                }

                const zip = new JSZip();
                const split = DatasetSplitUtil.split(allImagesData);

                for (const [splitName, splitImages] of Object.entries(split)) {
                    for (const imageData of splitImages) {
                        const size = resolveImageSize(imageData, allImagesData, videoSize);
                        if (size) {
                            const content = buildLabelFileContent(imageData, labelNames, size, useSegmentation);
                            if (content) {
                                const txtName = imageData.fileData.name.replace(/\.[^/.]+$/, '.txt');
                                zip.file(`${folderName}/labels/${splitName}/${txtName}`, content);
                            }
                        }

                        const file = imageFileMap.get(imageData.id);
                        if (file) {
                            zip.file(`${folderName}/images/${splitName}/${imageData.fileData.name}`, file);
                        }
                    }
                }

                const classNames = labelNames.map(l => l.name);
                const yaml = [
                    `train: images/train`,
                    `val: images/val`,
                    `test: images/test`,
                    ``,
                    `nc: ${classNames.length}`,
                    `names: [${classNames.map(n => `'${n}'`).join(', ')}]`,
                ].join('\n');
                zip.file(`${folderName}/data.yaml`, yaml);
                zip.file(`${folderName}/labels.txt`, classNames.join('\n'));

                zip.generateAsync({type: 'blob'}).then((blob: Blob) => {
                    saveAs(blob, `${folderName}.zip`);
                });
            })
            .catch(() => {
                submitNewNotification(NotificationUtil.createErrorNotification({
                    header: '导出失败',
                    description: '获取原始帧失败，请确认后端连接正常后重试。',
                }));
            });
    }
}
