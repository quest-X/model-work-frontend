import {getVideoThumbnailSize} from '../utils/VideoThumbnailUtil';

export class VideoThumbnailService {
    private static queue: Promise<void> = Promise.resolve();
    private static pending = 0;
    private static decoder: {file: File; video: HTMLVideoElement; url: string} | null = null;

    public static capture(file: File, time: number, signal: AbortSignal): Promise<Blob> {
        // Sidebar requests share one decoder and never seek the editor's video.
        this.pending++;
        const request = this.queue.then(() => this.captureFrame(file, time, signal));
        this.queue = request.then(() => undefined, () => undefined);
        return request.finally(() => {
            if (--this.pending === 0) this.releaseDecoder();
        });
    }

    private static releaseDecoder(): void {
        const decoder = this.decoder;
        this.decoder = null;
        if (!decoder) return;
        decoder.video.removeAttribute('src');
        decoder.video.load();
        URL.revokeObjectURL(decoder.url);
    }

    private static getDecoder(file: File) {
        if (this.decoder?.file !== file) {
            this.releaseDecoder();
            const video = document.createElement('video');
            video.muted = true;
            video.preload = 'auto';
            this.decoder = {file, video, url: URL.createObjectURL(file)};
        }
        return this.decoder;
    }

    private static captureFrame(file: File, time: number, signal: AbortSignal): Promise<Blob> {
        if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
        return new Promise((resolve, reject) => {
            const {video, url} = this.getDecoder(file);
            let finished = false;
            let capturing = false;
            let targetTime: number | null = null;
            const cleanup: {timeout?: ReturnType<typeof setTimeout>; onAbort?: () => void} = {};
            const finish = (error?: Error, blob?: Blob) => {
                if (finished) return;
                finished = true;
                clearTimeout(cleanup.timeout);
                if (cleanup.onAbort) signal.removeEventListener('abort', cleanup.onAbort);
                video.onloadedmetadata = video.onloadeddata = video.onseeked = video.onerror = null;
                if (error) { this.releaseDecoder(); reject(error); }
                else resolve(blob);
            };
            const draw = () => {
                if (finished || capturing || targetTime === null || video.seeking || video.readyState < 2 ||
                    Math.abs(video.currentTime - targetTime) > 0.001) return;
                capturing = true;
                try {
                    if (!video.videoWidth || !video.videoHeight) throw new Error('Video frame unavailable');
                    const size = getVideoThumbnailSize(video.videoWidth, video.videoHeight);
                    const canvas = document.createElement('canvas');
                    canvas.width = size.width;
                    canvas.height = size.height;
                    const context = canvas.getContext('2d');
                    if (!context) throw new Error('Canvas unavailable');
                    context.drawImage(video, 0, 0, size.width, size.height);
                    canvas.toBlob(blob => {
                        if (blob) finish(undefined, blob);
                        else finish(new Error('Thumbnail encoding failed'));
                    }, 'image/jpeg', 0.6);
                } catch (error) {
                    finish(error instanceof Error ? error : new Error(String(error)));
                }
            };
            cleanup.onAbort = () => finish(new DOMException('Cancelled', 'AbortError'));
            signal.addEventListener('abort', cleanup.onAbort, {once: true});
            cleanup.timeout = setTimeout(() => finish(new Error('Video thumbnail timed out')), 10000);
            const seek = () => {
                if (!Number.isFinite(video.duration) || video.duration <= 0 || !Number.isFinite(time) || time < 0) {
                    finish(new Error('Invalid video metadata or frame time'));
                    return;
                }
                targetTime = Math.min(time, Math.max(0, video.duration - 0.001));
                video.currentTime = targetTime;
                draw();
            };
            video.onloadedmetadata = seek;
            video.onloadeddata = video.onseeked = draw;
            video.onerror = () => finish(new Error('Video thumbnail decode failed'));
            if (video.getAttribute('src') && video.readyState >= 1) seek();
            else {
                video.src = url;
                video.load();
            }
        });
    }
}
