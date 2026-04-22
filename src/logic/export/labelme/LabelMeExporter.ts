import {ImageData, LabelName, LabelPolygon, LabelRect} from '../../../store/labels/types';
import {LabelsSelector} from '../../../store/selectors/LabelsSelector';
import {VideoSelector} from '../../../store/selectors/VideoSelector';
import {ExporterUtil} from '../../../utils/ExporterUtil';
import {FrameExtractorService} from '../../../services/FrameExtractorService';
import {VideoData} from '../../../store/video/types';
import {submitNewNotification} from '../../../store/notifications/actionCreators';
import {NotificationUtil} from '../../../utils/NotificationUtil';
import JSZip from 'jszip';
import {saveAs} from 'file-saver';
import {ExportMode} from '../../../views/PopupView/ExportLabelsPopup/ExportLabelPopup';

const resolveImageFiles = async (
    allImagesData: ImageData[],
    activeVideo: VideoData | null
): Promise<Map<string, File | Blob>> => {
    const map = new Map<string, File | Blob>();

    if (!activeVideo) {
        allImagesData.forEach(img => {
            if (img.fileData.size > 0) map.set(img.id, img.fileData);
        });
        return map;
    }

    if (activeVideo.preExtractedFrames?.length) {
        allImagesData.forEach((img, idx) => {
            const f = activeVideo.preExtractedFrames![idx];
            if (f) map.set(img.id, f);
        });
        return map;
    }

    if (activeVideo.sessionId) {
        const annotated = allImagesData
            .map((img, idx) => ({ img, idx }))
            .filter(({ img }) => img.labelRects.length > 0 || img.labelPolygons.length > 0);

        // Merge indices with gap ≤ 10 into one batch request
        const ranges: { start: number; end: number; indices: Set<number> }[] = [];
        for (const { idx } of annotated) {
            const last = ranges[ranges.length - 1];
            if (last && idx - last.end <= 10) {
                last.end = idx;
                last.indices.add(idx);
            } else {
                ranges.push({ start: idx, end: idx, indices: new Set([idx]) });
            }
        }

        for (const range of ranges) {
            const frames = await FrameExtractorService.fetchFrameRange(
                activeVideo.sessionId, range.start, range.end - range.start + 1
            );
            for (let i = 0; i < frames.length; i++) {
                const globalIdx = range.start + i;
                const targetImg = allImagesData[globalIdx];
                if (targetImg && range.indices.has(globalIdx)) {
                    map.set(targetImg.id, frames[i]);
                }
            }
        }
        return map;
    }

    return map;
};

export class LabelMeExporter {
    public static export(mode: ExportMode = 'simple'): void {
        const allImagesData: ImageData[] = LabelsSelector.getImagesData();
        const labelNames: LabelName[] = LabelsSelector.getLabelNames();
        const labelNameMap: Record<string, string> = {};
        labelNames.forEach(l => { labelNameMap[l.id] = l.name; });

        const activeVideo = VideoSelector.getActiveVideo();
        const videoSize = activeVideo?.videoSize;

        const zip = new JSZip();
        let fileCount = 0;

        // Phase 1: annotation JSONs (sync, always)
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
                `${imageData.fileData.name.replace(/\.[^/.]+$/, '')}.json`,
                JSON.stringify({ version: '5.10.1', flags: {}, shapes, imagePath: imageData.fileData.name, imageHeight: height, imageWidth: width }, null, 2)
            );
            fileCount++;
        });

        if (fileCount === 0) return;

        if (mode !== 'complete') {
            zip.generateAsync({ type: 'blob' }).then((blob: Blob) => {
                saveAs(blob, `${ExporterUtil.getExportFileName('labelme')}.zip`);
            });
            return;
        }

        // Phase 2: full-resolution images (async)
        resolveImageFiles(allImagesData, activeVideo)
            .then(imageFileMap => {
                // Verify every annotated frame resolved
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
                    if (imageData) zip.file(`images/${imageData.fileData.name}`, file);
                });

                zip.generateAsync({ type: 'blob' }).then((blob: Blob) => {
                    saveAs(blob, `${ExporterUtil.getExportFileName('labelme')}.zip`);
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
