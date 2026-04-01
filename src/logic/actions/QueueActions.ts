import { store } from '../../index';
import { QueueItem, QueueItemType, QueueItemStatus } from '../../store/queue/types';
import { ImageData } from '../../store/labels/types';
import { setActiveQueueItem, updateQueueItem } from '../../store/queue/actionCreators';
import { updateImageData, updateActiveImageIndex } from '../../store/labels/actionCreators';
import { addVideoData, updateVideoMode } from '../../store/video/actionCreators';
import { ImageRepository } from '../imageRepository/ImageRepository';
import { ImageDataUtil } from '../../utils/ImageDataUtil';
import { VideoData } from '../../store/video/types';

export class QueueActions {
    public static async switchToQueueItem(
        targetItem: QueueItem,
        currentImagesData: ImageData[]
    ): Promise<void> {
        // 1. 保存当前文件的标注缓存
        const currentFileId = ImageRepository.getActiveFileId();
        if (currentFileId && currentImagesData.length > 0) {
            ImageRepository.saveFileCache(currentFileId, currentImagesData);
        }

        // 2. 清空当前显示
        ImageRepository.clearCurrentDisplay();
        store.dispatch(updateImageData([]));
        store.dispatch(updateActiveImageIndex(0));

        // 3. 标记目标项为处理中
        store.dispatch(setActiveQueueItem(targetItem.id));
        store.dispatch(updateQueueItem(targetItem.id, { status: QueueItemStatus.PROCESSING }));

        try {
            const cachedData = ImageRepository.restoreFileCache(targetItem.id);

            if (targetItem.type === QueueItemType.VIDEO) {
                const videoData: VideoData = {
                    id: targetItem.id,
                    fileData: targetItem.file!,
                    loadStatus: false,
                    duration: 0,
                    fps: 30,
                    totalFrames: 0,
                    videoSize: { width: 0, height: 0 },
                    currentFrame: 0,
                    currentTime: 0,
                    isPlaying: false,
                    frames: new Map()
                };
                store.dispatch(updateVideoMode(true));
                store.dispatch(addVideoData(videoData));
                ImageRepository.setActiveFileId(targetItem.id);
                if (cachedData) {
                    store.dispatch(updateImageData(cachedData));
                    store.dispatch(updateActiveImageIndex(0));
                }
            } else {
                store.dispatch(updateVideoMode(false));
                ImageRepository.setActiveFileId(targetItem.id);
                if (cachedData) {
                    store.dispatch(updateImageData(cachedData));
                    store.dispatch(updateActiveImageIndex(0));
                } else {
                    const files = targetItem.type === QueueItemType.FOLDER
                        ? targetItem.files!
                        : [targetItem.file!];
                    store.dispatch(updateImageData(
                        files.map(f => ImageDataUtil.createImageDataFromFileData(f))
                    ));
                    store.dispatch(updateActiveImageIndex(0));
                }
            }

            store.dispatch(updateQueueItem(targetItem.id, { status: QueueItemStatus.COMPLETED }));
        } catch (error) {
            store.dispatch(updateQueueItem(targetItem.id, {
                status: QueueItemStatus.ERROR,
                error: error instanceof Error ? error.message : '加载失败'
            }));
        }
    }
}
