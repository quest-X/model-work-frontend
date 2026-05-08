/**
 * FrameSourceUtil — HTMLImageElement / VideoFrame 抽象层
 *
 * v2.6.0 引入 WebCodecs 后,`EditorModel.videoFrameImage` 可能是:
 *   - HTMLImageElement (老路径,JPEG decode 出来的 <img>)
 *   - VideoFrame (新路径,WebCodecs 硬解出来的 GPU 纹理)
 *
 * 两者都是 CanvasImageSource(可以直接 drawImage),但维度访问 API 不同:
 *   HTMLImageElement: naturalWidth / naturalHeight
 *   VideoFrame:       displayWidth / displayHeight
 *
 * 渲染层调用 drawImage 不需要变;读维度 / 释放资源走本工具。
 */

export type FrameSource = HTMLImageElement | VideoFrame;

export function isVideoFrame(src: unknown): src is VideoFrame {
    return typeof VideoFrame !== 'undefined' && src instanceof VideoFrame;
}

export function getFrameWidth(src: FrameSource | null | undefined): number {
    if (!src) return 0;
    if (isVideoFrame(src)) return src.displayWidth;
    return src.naturalWidth || src.width;
}

export function getFrameHeight(src: FrameSource | null | undefined): number {
    if (!src) return 0;
    if (isVideoFrame(src)) return src.displayHeight;
    return src.naturalHeight || src.height;
}

/** VideoFrame 必须显式 close,否则 GPU 资源泄漏。HTMLImageElement 由 GC 处理。 */
export function closeFrame(src: FrameSource | null | undefined): void {
    if (src && isVideoFrame(src)) {
        try { src.close(); } catch { /* already closed */ }
    }
}
