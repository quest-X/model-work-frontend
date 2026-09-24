import {ImageData} from '../../../store/labels/types';
import {ImageDataUtil} from '../../../utils/ImageDataUtil';

export function createVideoFramePlaceholders(file: File, frames: number): ImageData[] {
    const images: ImageData[] = [];
    for (let i = 0; i < frames; i++) {
        const image = ImageDataUtil.createImageDataFromFileData(file);
        image.loadStatus = false;
        if (i === 0) image.isSelected = true;
        images.push(image);
    }
    return images;
}

export function getPlaybackFrame(images: ImageData[], latestImages: ImageData[] | null, frame: number): ImageData | null {
    let image = images[frame];
    if (image && image.labelRects.length === 0 && latestImages) {
        const latest = latestImages[frame];
        if (latest && latest.labelRects.length > 0) image = latest;
    }
    return image || null;
}
