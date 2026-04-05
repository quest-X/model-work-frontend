/**
 * FrameExtractorService — v1.9.0
 *
 * 双模式：
 *   1. 小视频（< FULL_LOAD_THRESHOLD 帧）：一次性全量拆帧（旧模式，快）
 *   2. 大视频：一次上传 → 按需取帧（新模式，内存安全）
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
    sessionId?: string;  // 大视频模式的会话 ID
}

export type ProgressCallback = (phase: string, current: number, total: number) => void;

const API_BASE = 'http://localhost:8000';
const FULL_LOAD_THRESHOLD = 10000; // ≤10K帧全量加载，>10K帧按需加载

export class FrameExtractorService {

    // ── 入口：自动选择模式 ──────────────────────────────────────────────────

    /**
     * 上传视频并提取帧。
     * 短视频（< 500 帧）：全量拆帧返回所有帧。
     * 长视频（≥ 500 帧）：上传后只返回 metadata + sessionId，帧按需获取。
     */
    static async extractFrames(
        videoFile: File,
        targetFps: number = 30,
        onProgress?: ProgressCallback,
    ): Promise<FrameExtractionResult> {

        // 1. 先上传视频到后端，获取 metadata
        onProgress?.('上传视频', 0, 100);
        console.log(`[FrameExtractor] 上传视频: ${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(1)}MB)`);

        const uploadResult = await this.uploadVideo(videoFile, targetFps, onProgress);
        const { sessionId, metadata } = uploadResult;

        console.log(`[FrameExtractor] 上传完成, 会话=${sessionId}, 总帧数=${metadata.totalFrames}`);

        // 2. 根据帧数决定模式
        if (metadata.totalFrames <= FULL_LOAD_THRESHOLD) {
            // 小视频：全量拆帧
            console.log(`[FrameExtractor] 小视频模式: 全量加载 ${metadata.totalFrames} 帧`);
            onProgress?.('解压帧', 0, metadata.totalFrames);
            const frames = await this.fetchFrameRange(sessionId, 0, metadata.totalFrames, onProgress);

            return {
                frames,
                fps: metadata.fps,
                duration: metadata.duration,
                totalFrames: metadata.totalFrames,
                width: metadata.width,
                height: metadata.height,
            };
        } else {
            // 大视频：按需模式，不预加载帧
            console.log(`[FrameExtractor] 大视频模式: 按需取帧, sessionId=${sessionId}`);
            onProgress?.('完成', metadata.totalFrames, metadata.totalFrames);

            return {
                frames: [],  // 不预加载
                fps: metadata.fps,
                duration: metadata.duration,
                totalFrames: metadata.totalFrames,
                width: metadata.width,
                height: metadata.height,
                sessionId,
            };
        }
    }

    // ── 上传视频 ────────────────────────────────────────────────────────────

    static async uploadVideo(
        videoFile: File,
        targetFps: number = 30,
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
            timeout: 60000,
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
