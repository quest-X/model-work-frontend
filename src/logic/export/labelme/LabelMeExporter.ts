import {ImageData, LabelName, LabelPolygon, LabelRect} from '../../../store/labels/types';
import {LabelsSelector} from '../../../store/selectors/LabelsSelector';
import {VideoSelector} from '../../../store/selectors/VideoSelector';
import {ExporterUtil} from '../../../utils/ExporterUtil';
import {submitNewNotification} from '../../../store/notifications/actionCreators';
import {NotificationUtil} from '../../../utils/NotificationUtil';
import {resolveExportImageFiles} from '../ExportImageResolver';
import JSZip from 'jszip';
import {saveAs} from 'file-saver';

export class LabelMeExporter {
    public static export(mode: 'simple' | 'complete' = 'complete'): void {
        const allImagesData: ImageData[] = LabelsSelector.getImagesData();
        const labelNames: LabelName[] = LabelsSelector.getLabelNames();
        const labelNameMap: Record<string, string> = {};
        labelNames.forEach(l => { labelNameMap[l.id] = l.name; });

        const activeVideo = VideoSelector.getActiveVideo();
        const videoSize = activeVideo?.videoSize;

        const prefix = mode === 'simple' ? 'labelme_simple' : 'labelme_full';
        const folderName = ExporterUtil.getExportFileName(prefix);

        const zip = new JSZip();
        let fileCount = 0;

        allImagesData.forEach((imageData: ImageData) => {
            if (!imageData.labelRects.length && !imageData.labelPolygons.length) return;

            const shapes: object[] = [];
            imageData.labelRects.forEach((label: LabelRect) => {
                shapes.push({
                    label: labelNameMap[label.labelId] || 'unknown',
                    points: [
                        [label.rect.x, label.rect.y],
                        [label.rect.x + label.rect.width, label.rect.y + label.rect.height]
                    ],
                    group_id: null, description: '', shape_type: 'rectangle', flags: {}, mask: null
                });
            });
            imageData.labelPolygons.forEach((label: LabelPolygon) => {
                shapes.push({
                    label: labelNameMap[label.labelId] || 'unknown',
                    points: label.vertices.map(v => [v.x, v.y]),
                    group_id: null, description: '', shape_type: 'polygon', flags: {}, mask: null
                });
            });

            const width = videoSize?.width ?? 0;
            const height = videoSize?.height ?? 0;
            zip.file(
                `${folderName}/${imageData.fileData.name.replace(/\.[^/.]+$/, '')}.json`,
                JSON.stringify({ version: '5.10.1', flags: {}, shapes, imagePath: imageData.fileData.name, imageData: null, imageHeight: height, imageWidth: width }, null, 2)
            );
            fileCount++;
        });

        if (fileCount === 0) return;

        if (mode === 'simple') {
            zip.generateAsync({ type: 'blob' }).then((blob: Blob) => {
                saveAs(blob, `${folderName}.zip`);
            });
            return;
        }

        resolveExportImageFiles(allImagesData, activeVideo)
            .then(imageFileMap => {
                const missing = allImagesData.filter(img =>
                    (img.labelRects.length > 0 || img.labelPolygons.length > 0) &&
                    !imageFileMap.has(img.id)
                );
                if (missing.length > 0) {
                    submitNewNotification(NotificationUtil.createErrorNotification({
                        header: '导出失败',
                        description: `${missing.length} 张图片无法获取原始分辨率，请确认后端连接正常后重试。`
                    }));
                    return;
                }

                imageFileMap.forEach((file, id) => {
                    const imageData = allImagesData.find(img => img.id === id);
                    if (imageData) zip.file(`${folderName}/${imageData.fileData.name}`, file);
                });

                zip.generateAsync({ type: 'blob' }).then((blob: Blob) => {
                    saveAs(blob, `${folderName}.zip`);
                });
            })
            .catch(() => {
                submitNewNotification(NotificationUtil.createErrorNotification({
                    header: '导出失败',
                    description: '获取原始帧失败，请确认后端连接正常后重试。'
                }));
            });
    }
}
