import {zip} from "lodash";
import {ImageData} from "../../store/labels/types";

export type ImageMap = { [s: string]: HTMLImageElement; };

// 文件级别的缓存结构
interface FileCache {
    imagesData: ImageData[];  // 该文件的所有 ImageData（包括标注信息）
    imageMap: ImageMap;        // 该文件的所有缩略图
}

// LRU cap for live (decoded) HTMLImageElements held in `repository`. Each
// decoded 4K photo can take ~30-50 MB of RGBA pixel memory; without a cap,
// importing 200+ photos pins multi-GB heap. Eviction releases the image's
// blob URL and clears `src` so the browser can free the decoded bitmap.
// Entries that are evicted from `repository` remain reachable through
// `fileCache.imageMap` if the user previously saved that file's snapshot —
// the LRU cap only affects the active in-view set.
// 视频流场景常态有数千帧滑动；50 太低导致频繁 evict + revokeObjectURL 抖动主线程。
// 300 ≈ 一屏滚动可见 + 缓冲，evict 频率显著降低
const DEFAULT_LIVE_IMAGE_CAP = 300;

export class ImageRepository {
    private static repository: ImageMap = {};

    // Insertion-order tracking for LRU eviction. Map preserves order, and
    // re-inserting an existing key (delete + set) moves it to the most-recent
    // slot, which is exactly the semantics we want.
    private static lru: Map<string, true> = new Map();
    private static liveImageCap: number = DEFAULT_LIVE_IMAGE_CAP;

    // 新增：文件级别的缓存
    private static fileCache: { [fileId: string]: FileCache } = {};

    // 新增：当前活动的文件ID
    private static activeFileId: string | null = null;

    public static storeImage(id: string, image: HTMLImageElement) {
        ImageRepository.repository[id] = image;
        // Touch in LRU: delete then set so this id moves to the newest slot.
        ImageRepository.lru.delete(id);
        ImageRepository.lru.set(id, true);
        ImageRepository.evictIfOverCap();
    }

    public static storeImages(ids: string[], images: HTMLImageElement[]) {
        zip(ids, images).forEach((pair: [string, HTMLImageElement]) => {
            ImageRepository.storeImage(...pair);
        })
    }

    public static getById(uuid: string): HTMLImageElement {
        const image = ImageRepository.repository[uuid];
        if (image) {
            // Mark as recently used so active editing doesn't get evicted
            // out from under the user.
            ImageRepository.lru.delete(uuid);
            ImageRepository.lru.set(uuid, true);
        }
        return image;
    }

    /**
     * Override the live-image LRU cap. Set to 0 or negative to disable
     * eviction (legacy behavior). Useful for tests or callers that know
     * they need the entire set in memory.
     */
    public static setLiveImageCap(cap: number) {
        ImageRepository.liveImageCap = Number.isFinite(cap) ? cap : DEFAULT_LIVE_IMAGE_CAP;
        ImageRepository.evictIfOverCap();
    }

    /**
     * Explicitly drop one image from the live set. Safe to call when the
     * user removes an image — releases the blob URL and clears `src` so
     * the browser can reclaim the decoded pixels.
     */
    public static releaseImage(id: string) {
        const image = ImageRepository.repository[id];
        if (!image) {
            ImageRepository.lru.delete(id);
            return;
        }
        ImageRepository.releaseHtmlImage(image);
        delete ImageRepository.repository[id];
        ImageRepository.lru.delete(id);
    }

    private static evictIfOverCap() {
        const cap = ImageRepository.liveImageCap;
        if (cap <= 0) return;
        while (ImageRepository.lru.size > cap) {
            const oldest = ImageRepository.lru.keys().next().value as string | undefined;
            if (!oldest) break;
            ImageRepository.lru.delete(oldest);
            const stale = ImageRepository.repository[oldest];
            if (stale) {
                ImageRepository.releaseHtmlImage(stale);
                delete ImageRepository.repository[oldest];
            }
        }
    }

    private static releaseHtmlImage(image: HTMLImageElement) {
        const src = image.src;
        // Only blob: URLs from FileUtil.loadImage need explicit revoke; data:
        // and remote URLs are GC'd with the element.
        if (src && src.startsWith('blob:')) {
            URL.revokeObjectURL(src);
        }
        // Detach src so the browser can reclaim the decoded bitmap even if
        // other code still holds a reference to the HTMLImageElement.
        image.src = '';
    }
    
    // ==================== 新增：文件级别的缓存管理 ====================
    
    /**
     * 设置当前活动文件ID
     */
    public static setActiveFileId(fileId: string | null) {
        ImageRepository.activeFileId = fileId;
    }
    
    /**
     * 获取当前活动文件ID
     */
    public static getActiveFileId(): string | null {
        return ImageRepository.activeFileId;
    }
    
    /**
     * 保存当前文件的缓存（在切换文件前调用）
     */
    public static saveFileCache(fileId: string, imagesData: ImageData[]) {
        if (!fileId) return;
        
        console.log(`[ImageRepository] 1. 保存文件 ${fileId.substring(0, 8)} 的缓存，共 ${imagesData.length} 张图像`);
        
        // 保存 ImageData 和对应的缩略图
        const imageMap: ImageMap = {};
        imagesData.forEach(imgData => {
            const image = ImageRepository.repository[imgData.id];
            if (image) {
                imageMap[imgData.id] = image;
            }
        });
        
        ImageRepository.fileCache[fileId] = {
            imagesData: imagesData.map(data => ({...data})), // 深拷贝
            imageMap
        };
        
        console.log(`[ImageRepository] 2. 文件缓存已保存: ${Object.keys(imageMap).length} 个缩略图`);
    }
    
    /**
     * 恢复文件的缓存（在切换到某个文件时调用）
     * @returns 返回缓存的 imagesData，如果没有缓存则返回 null
     */
    public static restoreFileCache(fileId: string): ImageData[] | null {
        if (!fileId) return null;
        
        const cache = ImageRepository.fileCache[fileId];
        if (!cache) {
            console.log(`[ImageRepository] 3. 文件 ${fileId.substring(0, 8)} 没有缓存，将重新生成`);
            return null;
        }
        
        console.log(`[ImageRepository] 4. 恢复文件 ${fileId.substring(0, 8)} 的缓存，共 ${cache.imagesData.length} 张图像`);

        // 恢复 ImageRepository 中的缩略图，并把它们登记到 LRU（最新位）；
        // 超出 cap 的旧条目会被 evictIfOverCap 释放。
        Object.entries(cache.imageMap).forEach(([id, image]) => {
            ImageRepository.repository[id] = image;
            ImageRepository.lru.delete(id);
            ImageRepository.lru.set(id, true);
        });
        ImageRepository.evictIfOverCap();

        console.log(`[ImageRepository] 5. 文件缓存已恢复: ${Object.keys(cache.imageMap).length} 个缩略图`);
        
        // 返回深拷贝，避免外部修改影响缓存
        return cache.imagesData.map(data => ({...data}));
    }
    
    /**
     * 清空当前显示的图像（但不清除文件缓存）
     * 在切换文件时调用，清空 UI 显示
     */
    public static clearCurrentDisplay() {
        console.log(`[ImageRepository] 6. 清空当前显示的图像（保留文件缓存）`);
        // 只清空当前的 repository，不删除 fileCache
        ImageRepository.repository = {};
        ImageRepository.lru.clear();
    }
    
    /**
     * 删除特定文件的缓存
     */
    public static removeFileCache(fileId: string) {
        if (!fileId) return;
        
        console.log(`[ImageRepository] 7. 删除文件 ${fileId.substring(0, 8)} 的缓存`);
        
        const cache = ImageRepository.fileCache[fileId];
        if (cache) {
            // 从 repository 中删除该文件的所有图像 + 释放 blob URL
            Object.keys(cache.imageMap).forEach(id => {
                const image = ImageRepository.repository[id];
                if (image) {
                    ImageRepository.releaseHtmlImage(image);
                    delete ImageRepository.repository[id];
                }
                ImageRepository.lru.delete(id);
            });

            // 删除文件缓存
            delete ImageRepository.fileCache[fileId];
        }
    }
    
    /**
     * 清除所有缓存（用于内存清理）
     */
    public static clearAllCache() {
        console.log(`[ImageRepository] 8. 清除所有缓存`);
        // Release blob URLs and clear src so decoded pixel buffers can be GC'd.
        Object.values(ImageRepository.repository).forEach(img => {
            if (img) ImageRepository.releaseHtmlImage(img);
        });
        ImageRepository.repository = {};
        ImageRepository.fileCache = {};
        ImageRepository.activeFileId = null;
        ImageRepository.lru.clear();
    }
    
    /**
     * 获取缓存统计信息
     */
    public static getCacheStats() {
        const fileCount = Object.keys(ImageRepository.fileCache).length;
        const currentImageCount = Object.keys(ImageRepository.repository).length;
        
        let totalCachedImages = 0;
        Object.values(ImageRepository.fileCache).forEach(cache => {
            totalCachedImages += Object.keys(cache.imageMap).length;
        });
        
        return {
            fileCount,              // 缓存的文件数
            currentImageCount,      // 当前显示的图像数
            totalCachedImages,      // 所有缓存的图像总数
            activeFileId: ImageRepository.activeFileId
        };
    }
}