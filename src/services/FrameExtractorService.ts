/**
 * FrameExtractorService — 使用 FFmpeg WASM 在浏览器中将视频拆分为独立帧图片
 *
 * 核心思想：视频上传后一次性拆成 N 张 JPEG，后续全走图片模式。
 * 消除所有浏览器 video seek 精度问题、rVFC 时序问题、readyState 轮询问题。
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

export interface FrameExtractionResult {
    frames: File[];         // 每帧为独立的 JPEG File 对象
    fps: number;            // 检测到的帧率
    duration: number;       // 视频时长（秒）
    totalFrames: number;    // 总帧数
    width: number;          // 视频宽度
    height: number;         // 视频高度
}

export type ProgressCallback = (phase: string, current: number, total: number) => void;

export class FrameExtractorService {
    private static ffmpeg: FFmpeg | null = null;
    private static loaded = false;

    /**
     * 初始化 FFmpeg WASM（首次调用时自动加载，~25MB）
     */
    static async ensureLoaded(onProgress?: (msg: string) => void): Promise<void> {
        if (this.loaded && this.ffmpeg) return;

        this.ffmpeg = new FFmpeg();

        // 日志回调
        this.ffmpeg.on('log', ({ message }) => {
            // 静默，除非调试
            if (message.includes('fps=') || message.includes('frame=')) {
                console.log('[FFmpeg]', message);
            }
        });

        onProgress?.('加载 FFmpeg WASM 引擎...');

        // 加载 WASM core（从 CDN 或本地）
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        await this.ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });

        this.loaded = true;
        console.log('[FFmpeg] WASM engine loaded');
    }

    /**
     * 从视频文件提取所有帧为独立 JPEG
     */
    static async extractFrames(
        videoFile: File,
        targetFps: number = 30,
        onProgress?: ProgressCallback
    ): Promise<FrameExtractionResult> {
        await this.ensureLoaded((msg) => onProgress?.('init', 0, 0));
        const ffmpeg = this.ffmpeg!;

        // 1. 写入视频文件到 WASM 虚拟文件系统
        onProgress?.('读取视频', 0, 1);
        const inputName = 'input' + this.getExtension(videoFile.name);
        await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

        // 2. 先获取视频信息（duration, fps, resolution）
        onProgress?.('分析视频', 0, 1);
        const info = await this.probeVideo(ffmpeg, inputName, targetFps);
        console.log('[FFmpeg] Video info:', info);

        // 3. 执行拆帧命令
        const totalFrames = Math.floor(info.duration * info.fps);
        onProgress?.('拆分帧', 0, totalFrames);

        // 进度追踪
        let lastProgressFrame = 0;
        ffmpeg.on('progress', ({ progress }) => {
            const currentFrame = Math.round(progress * totalFrames);
            if (currentFrame !== lastProgressFrame) {
                lastProgressFrame = currentFrame;
                onProgress?.('拆分帧', currentFrame, totalFrames);
            }
        });

        // ffmpeg -i input.mp4 -vf fps=30 -q:v 3 -f image2 frame_%06d.jpg
        await ffmpeg.exec([
            '-i', inputName,
            '-vf', `fps=${info.fps}`,
            '-q:v', '3',           // JPEG 质量（1=最好, 31=最差, 3=高质量）
            '-f', 'image2',
            'frame_%06d.jpg'
        ]);

        // 4. 读取所有输出帧
        onProgress?.('读取帧', 0, totalFrames);
        const frames: File[] = [];

        for (let i = 1; i <= totalFrames + 10; i++) { // +10 容错
            const frameName = `frame_${String(i).padStart(6, '0')}.jpg`;
            try {
                const data = await ffmpeg.readFile(frameName);
                if (data instanceof Uint8Array && data.length > 0) {
                    const blob = new Blob([data], { type: 'image/jpeg' });
                    const file = new File([blob], frameName, { type: 'image/jpeg' });
                    frames.push(file);
                    if (i % 10 === 0) onProgress?.('读取帧', i, totalFrames);
                }
            } catch {
                // 文件不存在，已到最后一帧
                break;
            }
        }

        // 5. 清理 WASM 文件系统
        try { await ffmpeg.deleteFile(inputName); } catch {}
        for (let i = 1; i <= frames.length; i++) {
            try { await ffmpeg.deleteFile(`frame_${String(i).padStart(6, '0')}.jpg`); } catch {}
        }

        console.log(`[FFmpeg] Extracted ${frames.length} frames from ${videoFile.name}`);

        return {
            frames,
            fps: info.fps,
            duration: info.duration,
            totalFrames: frames.length,
            width: info.width,
            height: info.height
        };
    }

    /**
     * 获取视频基本信息
     */
    private static async probeVideo(
        ffmpeg: FFmpeg,
        inputName: string,
        targetFps: number
    ): Promise<{ duration: number; fps: number; width: number; height: number }> {
        // 用 ffmpeg 的日志输出解析视频信息
        let logOutput = '';
        const logHandler = ({ message }: { message: string }) => {
            logOutput += message + '\n';
        };
        ffmpeg.on('log', logHandler);

        // 运行一个简短的 ffmpeg 命令获取信息
        try {
            await ffmpeg.exec(['-i', inputName, '-f', 'null', '-t', '0', '-']);
        } catch {
            // ffmpeg -i 没有输出时会"失败"，但日志中有信息
        }

        ffmpeg.off('log', logHandler);

        // 解析时长
        let duration = 0;
        const durationMatch = logOutput.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
        if (durationMatch) {
            duration = parseInt(durationMatch[1]) * 3600 +
                       parseInt(durationMatch[2]) * 60 +
                       parseInt(durationMatch[3]) +
                       parseInt(durationMatch[4]) / 100;
        }

        // 解析分辨率
        let width = 0, height = 0;
        const resMatch = logOutput.match(/(\d{2,5})x(\d{2,5})/);
        if (resMatch) {
            width = parseInt(resMatch[1]);
            height = parseInt(resMatch[2]);
        }

        // 解析帧率
        let fps = targetFps;
        const fpsMatch = logOutput.match(/(\d+(?:\.\d+)?)\s*fps/);
        if (fpsMatch) {
            fps = Math.round(parseFloat(fpsMatch[1]));
        }

        // 如果解析失败，使用默认值
        if (duration === 0) duration = 10;
        if (fps === 0) fps = targetFps;

        return { duration, fps, width, height };
    }

    private static getExtension(filename: string): string {
        const ext = filename.split('.').pop()?.toLowerCase();
        return ext ? `.${ext}` : '.mp4';
    }
}
