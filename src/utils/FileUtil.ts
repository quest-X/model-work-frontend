import {ArrayUtil} from './ArrayUtil';

// Concurrency cap for chunked image decode: large enough to keep the GPU/decoder
// pipeline saturated, small enough that the main thread stays responsive when
// users drop hundreds of 4K photos at once.
const DECODE_CHUNK_SIZE = 16;

export class FileUtil {
    public static loadImageBase64(fileData: File): Promise<string | ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(fileData);
            reader.onload = () => resolve(reader.result);
            reader.onerror = (error) => reject(error);
        });
    }

    public static loadImage(fileData: File): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(fileData);
            const image = new Image();
            // We deliberately do NOT revoke the object URL on success — `<img>`
            // elements that later read `image.src` (e.g. ImagePreview) need the
            // URL to remain valid for the lifetime of the element. The
            // ImageRepository LRU revokes the URL when the image is evicted.
            image.onload = () => {
                // Prefer decode() when available so decoding finishes off the
                // main thread before we hand the image to canvas drawImage.
                // Without this, drawImage triggers a synchronous decode that
                // can stall the main thread by hundreds of ms on 4K photos.
                if (typeof image.decode === 'function') {
                    image.decode().then(() => resolve(image), () => resolve(image));
                } else {
                    resolve(image);
                }
            };
            image.onerror = (err) => {
                URL.revokeObjectURL(url);
                reject(err);
            };
            image.src = url;
        });
    }

    /**
     * Decode files in fixed-size chunks (parallel within a chunk, sequential
     * between chunks) to avoid the multi-second main-thread freeze of
     * `Promise.all(files.map(decode))` on large drops.
     */
    public static async loadImages(fileData: File[]): Promise<HTMLImageElement[]> {
        const out: HTMLImageElement[] = [];
        for (const batch of ArrayUtil.chunk(fileData, DECODE_CHUNK_SIZE)) {
            const decoded = await Promise.all(batch.map(file => FileUtil.loadImage(file)));
            out.push(...decoded);
        }
        return out;
    }

    public static readFile(fileData: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = (event: any) => {
                resolve(event?.target?.result);
            };
            reader.onerror = reject;
            reader.readAsText(fileData);
        });
    }

    public static readFiles(fileData: File[]): Promise<string[]> {
        return new Promise((resolve, reject) => {
            const promises: Promise<string>[] = fileData.map((data: File) => FileUtil.readFile(data));
            Promise
                .all(promises)
                .then((values: string[]) => resolve(values))
                .catch((error) => reject(error));
        });
    }

    public static extractFileExtension(name: string): string | null {
        const parts = name.split('.');
        return parts.length > 1 ? parts[parts.length - 1] : null;
    }

    public static extractFileName(name: string): string | null {
        const splitPath = name.split('.');
        let fName = '';
        for (const idx of Array(splitPath.length - 1).keys()) {
            if (fName === '') fName += splitPath[idx];
            else fName += '.' + splitPath[idx];
        }
        return fName;
    }
}
