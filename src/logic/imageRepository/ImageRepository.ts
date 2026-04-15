import {zip} from "lodash";
import {ImageData} from "../../store/labels/types";

export type ImageMap = { [s: string]: HTMLImageElement; };

// 文件级别的缓存结构
interface FileCache {
    imagesData: ImageData[];  // 该文件的所有 ImageData（包括标注信息）
    imageMap: ImageMap;        // 该文件的所有缩略图
}

export class ImageRepository {
    private static repository: ImageMap = {};

    // 新增：文件级别的缓存
    private static fileCache: { [fileId: string]: FileCache } = {};

    // 新增：当前活动的文件ID
    private static activeFileId: string | null = null;

    public static storeImage(id: string, image: HTMLImageElement) {
        ImageRepository.repository[id] = image;
    }

    public static storeImages(ids: string[], images: HTMLImageElement[]) {
        zip(ids, images).forEach((pair: [string, HTMLImageElement]) => {
            ImageRepository.storeImage(...pair);
        })
    }

    public static getById(uuid: string): HTMLImageElement {
        return ImageRepository.repository[uuid];
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

        // 恢复 ImageRepository 中的缩略图
        Object.entries(cache.imageMap).forEach(([id, image]) => {
            ImageRepository.repository[id] = image;
        });

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
    }
    
    /**
     * 删除特定文件的缓存
     */
    public static removeFileCache(fileId: string) {
        if (!fileId) return;
        
        console.log(`[ImageRepository] 7. 删除文件 ${fileId.substring(0, 8)} 的缓存`);
        
        const cache = ImageRepository.fileCache[fileId];
        if (cache) {
            // 从 repository 中删除该文件的所有图像
            Object.keys(cache.imageMap).forEach(id => {
                delete ImageRepository.repository[id];
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
        ImageRepository.repository = {};
        ImageRepository.fileCache = {};
        ImageRepository.activeFileId = null;
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