import {ImageData} from '../../store/labels/types';
import {VideoData} from '../../store/video/types';
import {FrameExtractorService} from '../../services/FrameExtractorService';

export const resolveExportImageFiles = async (
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
            .map((img, idx) => ({img, idx}))
            .filter(({img}) => img.labelRects.length > 0 || img.labelPolygons.length > 0);

        const ranges: {start: number; end: number; indices: Set<number>}[] = [];
        for (const {idx} of annotated) {
            const last = ranges[ranges.length - 1];
            if (last && idx - last.end <= 10) {
                last.end = idx;
                last.indices.add(idx);
            } else {
                ranges.push({start: idx, end: idx, indices: new Set([idx])});
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
