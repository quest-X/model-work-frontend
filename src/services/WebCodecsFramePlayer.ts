/**
 * WebCodecsFramePlayer — GPU 硬件解码 + LRU VideoFrame 缓存
 *
 * v2.6.0 视频显示路径的核心服务。配合 VideoDemuxer 使用:
 *
 *     const demuxer = await VideoDemuxer.create('/video-stream/abc');
 *     const player = await WebCodecsFramePlayer.create(demuxer);
 *     const frame = await player.getFrame(1234);
 *     ctx.drawImage(frame, 0, 0);
 *     // frame 由 player 内部 LRU 管理,会自动 close()
 *
 * LRU 缓存策略: 保留 ~50 个 VideoFrame (1440p 时 ~275MB,可调)。
 * VideoFrame 是 GC root,必须显式 close() 才会释放底层 GPU/CPU 内存。
 */

import { VideoDemuxer } from './VideoDemuxer';

const DEFAULT_CACHE_FRAMES = 50; // LRU 容量,实际占用 ≈ N × ~5.5MB (1440p YUV)

interface CacheEntry {
    frame: VideoFrame;
    insertedAt: number;
}

export class WebCodecsFramePlayer {
    private demuxer: VideoDemuxer;
    private decoder!: VideoDecoder;
    private cache: Map<number, CacheEntry> = new Map();
    private maxCacheFrames: number;
    private pendingDecodes: Map<number, Promise<VideoFrame>> = new Map();
    // 解码器输出顺序问题: VideoDecoder.decode 是流水线,output 回调按 DTS 顺序到来,
    // 但我们要按 frame index 配对。用一个单调递增的 expectedFrameIdx 队列。
    private decodeQueue: { frameIdx: number; resolve: (f: VideoFrame) => void; reject: (e: Error) => void }[] = [];

    private constructor(demuxer: VideoDemuxer, maxCacheFrames: number) {
        this.demuxer = demuxer;
        this.maxCacheFrames = maxCacheFrames;
    }

    static async create(demuxer: VideoDemuxer, opts: { maxCacheFrames?: number } = {}): Promise<WebCodecsFramePlayer> {
        const maxCache = opts.maxCacheFrames ?? DEFAULT_CACHE_FRAMES;
        const player = new WebCodecsFramePlayer(demuxer, maxCache);
        await player.initDecoder();
        return player;
    }

    /** 探测当前浏览器是否支持视频的 codec; UI 层据此决定走 WebCodecs 还是 fallback。 */
    static async isSupported(codec: string): Promise<boolean> {
        if (typeof VideoDecoder === 'undefined') return false;
        try {
            const result = await VideoDecoder.isConfigSupported({ codec });
            return result.supported === true;
        } catch {
            return false;
        }
    }

    getInfo() {
        return this.demuxer.getInfo();
    }

    /**
     * 取目标帧。命中缓存立即返回; 否则触发 keyframe-aware 解码序列。
     * 返回的 VideoFrame **由 player 持有**,调用方不要 close()。
     */
    async getFrame(frameIdx: number): Promise<VideoFrame> {
        const cached = this.cache.get(frameIdx);
        if (cached) {
            // LRU: touch 一下 (重新插入到末尾)
            this.cache.delete(frameIdx);
            this.cache.set(frameIdx, cached);
            return cached.frame;
        }
        const pending = this.pendingDecodes.get(frameIdx);
        if (pending) return pending;

        const promise = this.decodeFrame(frameIdx);
        this.pendingDecodes.set(frameIdx, promise);
        try {
            return await promise;
        } finally {
            this.pendingDecodes.delete(frameIdx);
        }
    }

    /**
     * 显式释放所有资源。FramePlayer 卸载时调用。
     */
    close(): void {
        for (const entry of this.cache.values()) {
            entry.frame.close();
        }
        this.cache.clear();
        try {
            this.decoder?.close();
        } catch { /* 已经 closed */ }
    }

    // ===== 内部 =====

    private async initDecoder(): Promise<void> {
        const info = this.demuxer.getInfo();
        const supported = await WebCodecsFramePlayer.isSupported(info.codec);
        if (!supported) {
            throw new Error(`Codec ${info.codec} not supported by VideoDecoder`);
        }
        this.decoder = new VideoDecoder({
            output: (frame) => this.handleDecodedFrame(frame),
            error: (err) => {
                console.error('[WebCodecs] VideoDecoder error:', err);
                // 把队列里所有等待者都 reject
                for (const w of this.decodeQueue) w.reject(err);
                this.decodeQueue = [];
            },
        });
        this.decoder.configure({
            codec: info.codec,
            codedWidth: info.width,
            codedHeight: info.height,
            description: info.description,
        });
    }

    /**
     * 实际解码: 取 [keyframe..frameIdx] 的 chunks 喂给 decoder,等到目标帧 output。
     * keyframe 之前的中间帧也会输出,我们把它们一并放进 LRU 缓存(顺手赚到的)。
     */
    private async decodeFrame(frameIdx: number): Promise<VideoFrame> {
        const chunks = await this.demuxer.getChunksForFrame(frameIdx);
        const targetTimestamp = chunks[chunks.length - 1].timestamp;
        const expectedTimestamps = chunks.map(c => c.timestamp);

        return new Promise<VideoFrame>((resolve, reject) => {
            // 注册等待者: 当 output 的 timestamp 命中 targetTimestamp,resolve
            this.decodeQueue.push({
                frameIdx,
                resolve,
                reject,
            });
            // 顺手把中间帧也"等"上,output 时塞进 cache
            (this as any)._currentBatchTimestamps = new Set(expectedTimestamps);
            (this as any)._currentBatchTarget = targetTimestamp;

            for (const chunk of chunks) {
                this.decoder.decode(chunk);
            }
            // flush 让 decoder 输出最后一帧 (尤其当 chunks 末尾是 P/B 帧时)
            this.decoder.flush().catch(reject);
        });
    }

    private handleDecodedFrame(frame: VideoFrame): void {
        const ts = frame.timestamp;
        const targetTs = (this as any)._currentBatchTarget;
        const batchSet = (this as any)._currentBatchTimestamps as Set<number> | undefined;

        // batch 内的所有中间帧都进 LRU
        if (batchSet?.has(ts)) {
            const frameIdx = this.demuxer.timestampToFrame(ts);
            // 如果同 frame 已经在 cache (理论上不应该,因为 getFrame 已经查过了),先 close 旧的
            const existing = this.cache.get(frameIdx);
            if (existing) existing.frame.close();
            this.cache.set(frameIdx, { frame, insertedAt: Date.now() });
            this.evictIfNeeded(frameIdx);
        } else {
            // 不在 batch 内,直接丢弃
            frame.close();
            return;
        }

        // 命中目标帧 → resolve 等待者
        if (ts === targetTs) {
            const waiter = this.decodeQueue.shift();
            if (waiter) {
                waiter.resolve(frame);
            }
        }
    }

    /**
     * LRU 淘汰: 距 currentPos 最远的优先 evict。
     */
    private evictIfNeeded(currentPos: number): void {
        if (this.cache.size <= this.maxCacheFrames) return;
        const indices = Array.from(this.cache.keys());
        indices.sort((a, b) => Math.abs(b - currentPos) - Math.abs(a - currentPos));
        const toRemove = this.cache.size - this.maxCacheFrames;
        for (let i = 0; i < toRemove; i++) {
            const idx = indices[i];
            const entry = this.cache.get(idx);
            if (entry) {
                entry.frame.close();
                this.cache.delete(idx);
            }
        }
    }
}
