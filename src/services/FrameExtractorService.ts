/**
 * FrameExtractorService — 调用后端原生 FFmpeg 将视频拆分为独立帧图片
 *
 * 流程：上传视频到后端 → 原生 FFmpeg 拆帧 → ZIP 打包返回 → 前端解压为独立 JPEG File
 * 比 FFmpeg WASM 快 10-50x（原生硬件加速 vs 纯软件 WASM 解码）
 */
import axios from 'axios';
import JSZip from 'jszip';

export interface FrameExtractionResult {
    frames: File[];         // 每帧为独立的 JPEG File 对象
    fps: number;            // 帧率
    duration: number;       // 视频时长（秒）
    totalFrames: number;    // 总帧数
    width: number;          // 视频宽度
    height: number;         // 视频高度
}

export type ProgressCallback = (phase: string, current: number, total: number) => void;

const API_BASE = 'http://localhost:8000';

export class FrameExtractorService {

    /**
     * 从视频文件提取所有帧为独立 JPEG
     */
    static async extractFrames(
        videoFile: File,
        targetFps: number = 30,
        onProgress?: ProgressCallback
    ): Promise<FrameExtractionResult> {

        // 1. 上传视频到后端
        onProgress?.('上传视频', 0, 1);
        console.log(`[FrameExtractor] 上传视频: ${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(1)}MB)`);

        const formData = new FormData();
        formData.append('file', videoFile, videoFile.name);
        formData.append('fps', targetFps.toString());

        const response = await axios.post(`${API_BASE}/extract-frames`, formData, {
            responseType: 'arraybuffer',
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 120000, // 2 分钟超时
            onUploadProgress: (e) => {
                if (e.total) {
                    onProgress?.('上传视频', Math.round((e.loaded / e.total) * 100), 100);
                }
            },
        });

        // 2. 解析 metadata
        const metadataHeader = response.headers['x-frame-metadata'];
        let metadata: any = {};
        if (metadataHeader) {
            try { metadata = JSON.parse(metadataHeader); } catch { /* malformed header, use defaults */ }
        }
        console.log('[FrameExtractor] 后端返回 metadata:', metadata);

        // 3. 解压 ZIP
        onProgress?.('解压帧', 0, metadata.totalFrames || 0);
        const zip = await JSZip.loadAsync(response.data);
        const MAX_FRAMES = 10000;
        const frameNames = Object.keys(zip.files).filter(n => n.endsWith('.jpg')).sort();
        if (frameNames.length > MAX_FRAMES) {
            throw new Error(`帧数超出上限: ${frameNames.length} > ${MAX_FRAMES}`);
        }
        const totalFrames = frameNames.length;

        console.log(`[FrameExtractor] ZIP 包含 ${totalFrames} 帧`);

        const frames: File[] = [];
        for (let i = 0; i < frameNames.length; i++) {
            const name = frameNames[i];
            const blob = await zip.files[name].async('blob');
            const file = new File([blob], name, { type: 'image/jpeg' });
            frames.push(file);

            if (i % 10 === 0) {
                onProgress?.('解压帧', i + 1, totalFrames);
            }
        }

        onProgress?.('完成', totalFrames, totalFrames);
        console.log(`[FrameExtractor] 完成: ${frames.length} 帧`);

        return {
            frames,
            fps: metadata.fps || targetFps,
            duration: metadata.duration || 0,
            totalFrames: frames.length,
            width: metadata.width || 0,
            height: metadata.height || 0,
        };
    }
}
