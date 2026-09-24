import {v4 as uuidv4} from 'uuid';
import {QueueItem, QueueItemStatus, QueueItemType} from '../../../store/queue/types';
import {FrameExtractorService} from '../../../services/FrameExtractorService';
import {EditorModel} from '../../../staticModels/EditorModel';
import {store} from '../../../index';
import {submitNewNotification, deleteNotificationById} from '../../../store/notifications/actionCreators';
import {NotificationUtil} from '../../../utils/NotificationUtil';

export type VideoImportProgress = {phase: string; progress: number; fileName: string};

// A thumbnail is optional: unreadable images must still enter the queue.
const generateImageThumbnail = (file: File): Promise<string | undefined> => new Promise((resolve) => {
    let reader: FileReader | null = null;
    let image: HTMLImageElement | null = null;
    const finish = (thumbnail?: string) => {
        if (reader) reader.onload = reader.onerror = reader.onabort = null;
        if (image) {
            image.onload = image.onerror = image.onabort = null;
            image.removeAttribute('src');
        }
        resolve(thumbnail);
    };

    try {
        reader = new FileReader();
        image = new Image();
        reader.onerror = () => finish();
        reader.onabort = () => finish();
        reader.onload = () => {
            try {
                if (typeof reader.result === 'string') image.src = reader.result;
                else finish();
            } catch {
                finish();
            }
        };
        image.onerror = () => finish();
        image.onabort = () => finish();
        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    finish();
                    return;
                }
                const scale = Math.min(100 / image.width, 100 / image.height, 1);
                const width = image.width * scale;
                const height = image.height * scale;
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(image, 0, 0, width, height);
                finish(canvas.toDataURL());
            } catch {
                finish();
            }
        };
        reader.readAsDataURL(file);
    } catch {
        finish();
    }
});

// 生成缩略图辅助函数
const generateThumbnail = async (file: File): Promise<string | undefined> => {
    if (file.type.startsWith('image/')) return generateImageThumbnail(file);
    return new Promise((resolve) => {
        if (file.type.startsWith('video/')) {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = () => {
                video.currentTime = 0;
            };
            const videoUrl = URL.createObjectURL(file);
            video.onseeked = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const maxSize = 100;
                let width = video.videoWidth;
                let height = video.videoHeight;

                if (width > height) {
                    if (width > maxSize) {
                        height *= maxSize / width;
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width *= maxSize / height;
                        height = maxSize;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                ctx?.drawImage(video, 0, 0, width, height);
                URL.revokeObjectURL(videoUrl);
                resolve(canvas.toDataURL());
            };
            video.onerror = () => {
                URL.revokeObjectURL(videoUrl);
                resolve(undefined);
            };
            video.src = videoUrl;
        } else {
            resolve(undefined);
        }
    });
};

// 从文件路径提取文件夹名称
const getFolderName = (path: string): string | null => {
    const parts = path.split('/');
    if (parts.length > 1) {
        return parts[parts.length - 2];
    }
    return null;
};


const createVideoQueueItem = async (
    videoFile: File,
    setVideoProcessing: (progress: VideoImportProgress | null) => void,
): Promise<QueueItem> => {
    try {
        console.log(`[FFmpeg] 开始拆帧: ${videoFile.name}`);
        setVideoProcessing({ phase: '上传视频...', progress: 0, fileName: videoFile.name });

        const result = await FrameExtractorService.openSession(
            videoFile, 0,
            (phase, current, total) => {
                const pct = total > 0 ? Math.round((current / total) * 100) : 0;
                if (phase === '上传视频') {
                    setVideoProcessing({ phase: `上传中 ${pct >= 100 ? 99 : pct}%`, progress: pct, fileName: videoFile.name });
                } else if (phase === '解压帧') {
                    setVideoProcessing({ phase: `上传中 ${pct >= 100 ? 99 : pct}%`, progress: pct, fileName: videoFile.name });
                } else {
                    setVideoProcessing({ phase, progress: 0, fileName: videoFile.name });
                }
            }
        );
        const isOnDemand = !!result.sessionId;
        console.log(`[FFmpeg] Done: fast_ffmpeg_mode (${isOnDemand ? 'on-demand' : 'full-load'}), ${result.totalFrames} frames`);

        // Initialize global frame pool for fast_ffmpeg_mode (FramePlayer handles decoding)
        EditorModel.preloadedImageCache = new Map();
        if (isOnDemand) {
            EditorModel.videoSessionId = result.sessionId;
        }
        EditorModel.videoFrameFiles = [];

        // 缩略图从第 0 帧文件生成
        let thumbnail: string | undefined;
        if (EditorModel.videoFrameFiles?.[0]) {
            thumbnail = await generateThumbnail(EditorModel.videoFrameFiles[0]);
        } else if (isOnDemand) {
            // 大视频：取第 0 帧生成缩略图
            try {
                const batch = await FrameExtractorService.fetchFrameRange(result.sessionId, 0, 1);
                if (batch.length > 0) {
                    EditorModel.videoFrameFiles[0] = batch[0];
                    thumbnail = await generateThumbnail(batch[0]);
                }
            } catch { /* skip */ }
        }

        const item: QueueItem = {
            id: uuidv4(),
            name: videoFile.name,
            type: QueueItemType.VIDEO,
            file: videoFile,
            extractedFrames: undefined,
            videoSessionId: result.sessionId,
            extractionMetadata: {
                fps: result.fps,
                duration: result.duration,
                totalFrames: result.totalFrames,
                width: result.width,
                height: result.height,
            },
            status: QueueItemStatus.PENDING,
            uploadedAt: Date.now(),
            thumbnail
        };
        setVideoProcessing(null);
        return item;
    } catch (err) {
        console.error('[FFmpeg] Extraction failed, falling back to raw_browser_mode:', err);
        setVideoProcessing(null);
        // Surface the backend's real error (e.g. "磁盘空间不足") instead of
        // a generic "FFmpeg failed" — axios attaches it on .response.data.detail.
        const detail = (err as {response?: {data?: {detail?: unknown}}})?.response?.data?.detail;
        const description = typeof detail === 'string' && detail.trim()
            ? `${detail}\n（已回退到 raw_browser_mode）`
            : '已回退到 raw_browser_mode';
        const errorNotification = NotificationUtil.createErrorNotification({
            header: `视频上传失败: ${videoFile.name}`,
            description,
        });
        store.dispatch(submitNewNotification(errorNotification));
        // Linger 12s for actionable error (disk message), 5s for generic.
        const ttl = typeof detail === 'string' && detail.trim() ? 12000 : 5000;
        setTimeout(() => store.dispatch(deleteNotificationById(errorNotification.id)), ttl);
        // Fallback: raw_browser_mode (browser-native <video> element, no pre-extracted frames)
        const thumbnail = await generateThumbnail(videoFile);
        const item: QueueItem = {
            id: uuidv4(),
            name: videoFile.name,
            type: QueueItemType.VIDEO,
            file: videoFile,
            status: QueueItemStatus.PENDING,
            uploadedAt: Date.now(),
            thumbnail
        };
        return item;
    }
};

export const groupDroppedImages = (imageFiles: File[]): Map<string, File[]> => {
    const filesByFolder = new Map<string, File[]>();
    for (const file of imageFiles) {
        const folderPath = file.webkitRelativePath || file.name;
        const folderName = getFolderName(folderPath) || 'images';
        
        if (!filesByFolder.has(folderName)) {
            filesByFolder.set(folderName, []);
        }
        filesByFolder.get(folderName).push(file);
    }

    return filesByFolder;
};

export const createDroppedMediaQueueItems = async (
    sortedFiles: File[],
    setVideoProcessing: (progress: VideoImportProgress | null) => void,
): Promise<QueueItem[]> => {
    const videoFiles = sortedFiles.filter(file => file.type.startsWith('video/'));
    const imageFiles = sortedFiles.filter(file => file.type.startsWith('image/'));
    const filesByFolder = groupDroppedImages(imageFiles);
    const newQueueItems: QueueItem[] = [];
    for (const videoFile of videoFiles) {
        newQueueItems.push(await createVideoQueueItem(videoFile, setVideoProcessing));
    }
    for (const [folderName, folderFiles] of filesByFolder.entries()) {
        if (folderFiles.length === 1) {
            const file = folderFiles[0];
            const thumbnail = await generateThumbnail(file);
            const item: QueueItem = {
                id: uuidv4(),
                name: file.name,
                type: QueueItemType.IMAGE,
                file: file,
                status: QueueItemStatus.PENDING,
                uploadedAt: Date.now(),
                thumbnail
            };
            newQueueItems.push(item);
        } else {
            const sortedFolderFiles = folderFiles.sort((a, b) => a.name.localeCompare(b.name));
            const thumbnail = await generateThumbnail(sortedFolderFiles[0]);
            const item: QueueItem = {
                id: uuidv4(),
                name: folderName,
                type: QueueItemType.FOLDER,
                files: sortedFolderFiles,
                status: QueueItemStatus.PENDING,
                uploadedAt: Date.now(),
                thumbnail
            };
            newQueueItems.push(item);
        }
    }

    return newQueueItems;
};
