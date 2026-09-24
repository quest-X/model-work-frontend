async function captureFrameToBlob(
    video: HTMLVideoElement,
    ctx: CanvasRenderingContext2D | null,
    canvas: HTMLCanvasElement
): Promise<Blob> {
    if (!ctx) throw new Error('Video capture canvas unavailable');
    if (video.readyState < 2) throw new Error('Video not ready');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // 用 JPEG q=0.9 编码:体积约为 PNG 的 1/5,主线程编码耗时降低 ~70%,通用目标检测精度无感差异
    // 注意:缺陷检测/OCR 等对压缩敏感的任务请单独走 PNG 通道
    const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.9);
    });
    const bmp = await createImageBitmap(blob);
    bmp.close();
    return blob;
}

function seekVideoToTimeForCapture(video: HTMLVideoElement, time: number): Promise<void> {
    return new Promise<void>((resolve) => {
        // 已在目标时间
        if (Math.abs(video.currentTime - time) < 0.001) {
            if (video.readyState >= 3) {
                setTimeout(resolve, 50);
                return;
            }
            // 已到目标时间但帧未解码 — 直接轮询 readyState，不依赖 seeked 事件
            // （设置相同的 currentTime 不会触发 seeked）
            let polls = 0;
            const check = () => {
                if (video.readyState >= 3 || polls >= 100) {
                    setTimeout(resolve, 100);
                } else {
                    polls++;
                    setTimeout(check, 20);
                }
            };
            check();
            return;
        }

        let settled = false;
        let emergencyTimer: ReturnType<typeof setTimeout> | null = null;
        let onSeeked: (() => void) | null = null;
        const settle = () => {
            if (settled) return;
            settled = true;
            video.removeEventListener('seeked', onSeeked);
            clearTimeout(emergencyTimer);
            resolve();
        };

        emergencyTimer = setTimeout(() => {
            console.warn(`[Capture] Seek timeout for time=${time.toFixed(3)}, readyState=${video.readyState}, currentTime=${video.currentTime.toFixed(3)}`);
            settle();
        }, 5000); // 5秒保护（H.264 极端情况）

        const waitForDecode = () => {
            let polls = 0;
            const check = () => {
                if (video.readyState >= 3 || polls >= 100) { // 100 × 20ms = 2000ms
                    setTimeout(settle, 100); // 100ms 缓冲
                } else {
                    polls++;
                    setTimeout(check, 20);
                }
            };
            check();
        };

        onSeeked = () => {
            if (video.readyState >= 3) {
                setTimeout(settle, 100);
            } else {
                waitForDecode();
            }
        };

        video.addEventListener('seeked', onSeeked, { once: true });
        video.currentTime = time;
    });
}

/** Shared browser-video capture for detection and segmentation batches. */
export async function captureBrowserVideoFrames(
    video: HTMLVideoElement,
    frameIndices: number[],
    fps: number,
    isCancelled: () => boolean,
    onProgress: (index: number, frameIndex: number) => void,
): Promise<Array<Blob | null>> {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const capturedBlobs: Array<Blob | null> = new Array(frameIndices.length).fill(null);
    try {
        const ctx = canvas.getContext('2d');
        for (let i = 0; i < frameIndices.length; i++) {
            if (isCancelled()) break;
            const frameIdx = frameIndices[i];
            if (i % 5 === 0 || i === frameIndices.length - 1) onProgress(i, frameIdx);
            if (i % 8 === 0 && i > 0) await new Promise(resolve => setTimeout(resolve, 0));

            for (let attempt = 0; attempt < 4; attempt++) {
                await seekVideoToTimeForCapture(video, frameIdx / fps);
                try {
                    capturedBlobs[i] = await captureFrameToBlob(video, ctx, canvas);
                    break;
                } catch (err) {
                    console.warn(`[Capture] Frame ${frameIdx} attempt ${attempt + 1} failed:`, err);
                    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
                }
            }
        }
        return capturedBlobs;
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}
