import {LanguageTexts} from '../data/LanguageConfig';
import {QueueItem, QueueItemType} from '../store/queue/types';

export interface QueueDisplayMetadata {
    name: string;
    type: QueueItemType;
    totalFrames?: number;
    fps?: number;
    fileCount?: number;
}

const stripMetaSuffix = (name: string): string => name.replace(
    /\s*\([\d]+(张图像| 帧 @ [\d.]+fps| frames @ [\d.]+fps| images)\)$/, '',
);

export const getQueueDisplayName = (meta: QueueDisplayMetadata, texts: LanguageTexts): string => {
    const baseName = stripMetaSuffix(meta.name);
    if (meta.type === QueueItemType.VIDEO && meta.totalFrames !== undefined && meta.fps !== undefined) {
        const videoMeta = texts.videoMeta
            .replace('{frames}', String(meta.totalFrames))
            .replace('{fps}', String(Math.round(meta.fps)));
        return `${baseName} (${videoMeta})`;
    }
    if (meta.type === QueueItemType.FOLDER && meta.fileCount !== undefined) {
        const folderMeta = texts.folderMeta.replace('{count}', String(meta.fileCount));
        return `${baseName} (${folderMeta})`;
    }
    return baseName;
};

export const getQueueItemDisplayName = (item: QueueItem, texts: LanguageTexts): string =>
    getQueueDisplayName({
        name: item.name,
        type: item.type,
        totalFrames: item.extractionMetadata?.totalFrames,
        fps: item.extractionMetadata?.fps,
        fileCount: item.files?.length,
    }, texts);
