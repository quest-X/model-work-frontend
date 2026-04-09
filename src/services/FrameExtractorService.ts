/**
 * FrameExtractorService — v1.9.1
 *
 * This service powers the "fast_ffmpeg_mode" playback path. It uploads the
 * video to the backend FFmpeg server and retrieves extracted JPEG frames.
 *
 * Two sub-modes within fast_ffmpeg_mode:
 *   1. Full-load (small videos, <=1 GB): all frames downloaded at once.
 *   2. On-demand  (large videos, >1 GB): upload once, fetch frames in
 *      batches via sessionId (sliding-window in FramePlayer).
 *
 * If this service fails (backend unreachable), EditorContainer falls back
 * to raw_browser_mode (browser-native <video> element via VideoPlayer).
 *
 * @see VideoPlaybackMode in data/enums/VideoPlaybackMode.ts
 */
import axios from 'axios';
import JSZip from 'jszip';

export interface FrameExtractionResult {
    frames: File[];
    fps: number;
    duration: number;
    totalFrames: number;
    width: number;
    height: number;
    sessionId?: string;  // fast_ffmpeg_mode (on-demand): backend session ID for batch frame fetching
}

export type ProgressCallback = (phase: string, current: number, total: number) => void;

const API_BASE = 'http://localhost:8000';
const LARGE_VIDEO_SIZE_MB = 1024;  // >1GB 按需加载，≤1GB 全量加载

export class FrameExtractorService {

    // ── 入口：always on-demand ─────────────────────────────────────────────

    /**
     * 上传视频并返回 sessionId，帧由 FramePlayer 滑动窗口按需获取。
     * 所有视频统一走 on-demand 模式，避免大视频 JSZip OOM。
     */
    static async extractFrames(
        videoFile: File,
        targetFps: number = 0,
        onProgress?: ProgressCallback,
    ): Promise<FrameExtractionResult> {

        onProgress?.('上传视频', 0, 100);
        console.log(`[FrameExtractor] 上传视频: ${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(1)}MB)`);

        const uploadResult = await this.uploadVideo(videoFile, targetFps, onProgress);
        const { sessionId, metadata } = uploadResult;

        console.log(`[FrameExtractor] fast_ffmpeg_mode (on-demand): sessionId=${sessionId}, 总帧数=${metadata.totalFrames}`);

        return {
            frames: [],
            fps: metadata.fps,
            duration: metadata.duration,
            totalFrames: metadata.totalFrames,
            width: metadata.width,
            height: metadata.height,
            sessionId,
        };
    }

    // ── 上传视频 ────────────────────────────────────────────────────────────

    static async uploadVideo(
        videoFile: File,
        targetFps: number = 0,
        onProgress?: ProgressCallback,
    ): Promise<{ sessionId: string; metadata: any }> {

        const formData = new FormData();
        formData.append('file', videoFile, videoFile.name);
        formData.append('fps', targetFps.toString());

        const response = await axios.post(`${API_BASE}/upload-video`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 600000,
            onUploadProgress: onProgress ? (e) => {
                if (e.total) {
                    onProgress('上传视频', Math.round((e.loaded / e.total) * 100), 100);
                }
            } : undefined,
        });

        return response.data; // { sessionId, metadata }
    }

    // ── 按需取帧 ────────────────────────────────────────────────────────────

    /**
     * 从后端按范围获取帧（GET /frames/{sessionId}?start=N&count=M）
     */
    static async fetchFrameRange(
        sessionId: string,
        start: number,
        count: number,
        onProgress?: ProgressCallback,
    ): Promise<File[]> {

        const response = await axios.get(`${API_BASE}/frames/${sessionId}`, {
            params: { start, count },
            responseType: 'arraybuffer',
            timeout: 0,
        });

        // 解析 metadata
        const metadataHeader = response.headers['x-frame-metadata'];
        let metadata: any = {};
        if (metadataHeader) {
            try { metadata = JSON.parse(metadataHeader); } catch { /* ignore */ }
        }

        // 解压 ZIP
        const zip = await JSZip.loadAsync(response.data);
        const frameNames = Object.keys(zip.files).filter(n => n.endsWith('.jpg')).sort();

        const frames: File[] = [];
        for (let i = 0; i < frameNames.length; i++) {
            const blob = await zip.files[frameNames[i]].async('blob');
            const globalIndex = start + i;
            const file = new File([blob], `frame_${String(globalIndex).padStart(6, '0')}.jpg`, { type: 'image/jpeg' });
            frames.push(file);

            if (onProgress && i % 10 === 0) {
                onProgress('解压帧', i + 1, frameNames.length);
            }
        }

        return frames;
    }
}
