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
    // 多 waiter (timestamp → resolver)。允许多个 in-flight 等待,
    // 关键: B-frame 编码的视频中,frame 7 可能要等 frame 10 的 ref 才能输出,
    // 所以不能把 chain 卡在 frame 7 上,否则 frame 10 永远轮不到 feed,死锁。
    private waiters: Map<number, { resolve: (f: VideoFrame) => void; reject: (e: Error) => void }> = new Map();
    // feed/reset chain: 串行化 decoder 状态变更(reset/configure/decode 调用顺序敏感)。
    // 注意: 此 chain 只在"决定喂哪段 + 实际 decode()"时持有,
    // **不**等待 decoder 输出 — 输出靠 waiters 异步唤醒。
    private feedChain: Promise<unknown> = Promise.resolve();
    // 跟踪 decoder 已喂到第几帧。sequential 调用从 head+1 续喂,不必 reset。
    private decoderHead: number = -1;

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
     * 按时间戳取帧。后端预拆 JPEG 的 fps 可能与 mp4 native fps 不一样
     * (例如 backend 抽 17fps,mp4 25fps)→ ImageData[idx] 不能直接当 mp4 frame idx,
     * 必须先转成 timestamp 再用二分找最近的 native 帧。
     */
    async getFrameAtTimestamp(timestampUs: number): Promise<VideoFrame> {
        const frameIdx = this.demuxer.timestampToFrame(timestampUs);
        return this.getFrame(frameIdx);
    }

    /**
     * 同步查 cache,返回 VideoFrame (LRU touch) 或 null。
     * 给 rAF 播放循环用,绝不可阻塞。
     */
    getCachedFrameAtTimestamp(timestampUs: number): VideoFrame | null {
        const frameIdx = this.demuxer.timestampToFrame(timestampUs);
        const cached = this.cache.get(frameIdx);
        if (!cached) return null;
        // LRU touch
        this.cache.delete(frameIdx);
        this.cache.set(frameIdx, cached);
        return cached.frame;
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

    private async decodeFrame(frameIdx: number): Promise<VideoFrame> {
        // 1. Feed (串行) — 决定喂什么并触发 decoder.decode(), 不等输出
        const myFeed = this.feedChain.then(() => this.feedIfNeeded(frameIdx));
        this.feedChain = myFeed.catch(() => undefined);
        await myFeed;

        // 2. Feed 后 cache 可能已经有了 (decoder 输出快)
        const cached = this.cache.get(frameIdx);
        if (cached) {
            this.cache.delete(frameIdx);
            this.cache.set(frameIdx, cached);
            return cached.frame;
        }

        // 3. 等输出: 注册 waiter (timestamp keyed,允许多个并行等待)
        const targetTs = this.demuxer.frameToTimestamp(frameIdx);
        return new Promise<VideoFrame>((resolve, reject) => {
            this.waiters.set(targetTs, { resolve, reject });
            // race: 帧可能在 setter 之前已经入 cache
            const final = this.cache.get(frameIdx);
            if (final) {
                this.waiters.delete(targetTs);
                resolve(final.frame);
            }
        });
    }

    private async feedIfNeeded(frameIdx: number): Promise<void> {
        if (this.cache.has(frameIdx)) return; // 别的 feed 已经覆盖

        const total = this.demuxer.getInfo().totalFrames;
        const LOOKAHEAD = 9;

        if (frameIdx > this.decoderHead) {
            // 前向: 从 decoderHead+1 续喂; 首次则从 keyframe 喂
            const startIdx = this.decoderHead < 0
                ? this.demuxer.findKeyframeBefore(frameIdx)
                : this.decoderHead + 1;
            const endIdx = Math.min(frameIdx + LOOKAHEAD, total - 1);
            if (startIdx > endIdx) return;
            const chunks = await this.demuxer.getChunksInRange(startIdx, endIdx);
            for (const chunk of chunks) this.decoder.decode(chunk);
            this.decoderHead = endIdx;
        } else if (this.decoderHead - frameIdx > 50) {
            // 远程倒回: reset + 重新配置 + 从 keyframe 喂
            try { this.decoder.reset(); } catch { /* idempotent */ }
            const info = this.demuxer.getInfo();
            this.decoder.configure({
                codec: info.codec,
                codedWidth: info.width,
                codedHeight: info.height,
                description: info.description,
            });
            this.decoderHead = -1;
            const startIdx = this.demuxer.findKeyframeBefore(frameIdx);
            const endIdx = Math.min(frameIdx + LOOKAHEAD, total - 1);
            const chunks = await this.demuxer.getChunksInRange(startIdx, endIdx);
            for (const chunk of chunks) this.decoder.decode(chunk);
            this.decoderHead = endIdx;
        }
        // else: frame 在 [decoderHead-50..decoderHead],很可能还在 pipeline 里 → 不喂,等输出
    }

    /**
     * 显式释放所有资源。FramePlayer 卸载时调用。
     */
    close(): void {
        for (const entry of this.cache.values()) {
            entry.frame.close();
        }
        this.cache.clear();
        for (const w of this.waiters.values()) {
            try { w.reject(new Error('Player closed')); } catch {}
        }
        this.waiters.clear();
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
                // 拒绝所有等待中的 waiter
                for (const w of this.waiters.values()) {
                    try { w.reject(err); } catch {}
                }
                this.waiters.clear();
            },
        });
        this.decoder.configure({
            codec: info.codec,
            codedWidth: info.width,
            codedHeight: info.height,
            description: info.description,
        });
    }

    private handleDecodedFrame(frame: VideoFrame): void {
        const ts = frame.timestamp;
        const idx = this.demuxer.timestampToFrame(ts);

        // 全部进 cache (lookahead 帧 / target 帧 / B-frame 重排晚到的帧都是有效输出)
        const existing = this.cache.get(idx);
        if (existing) existing.frame.close();
        this.cache.set(idx, { frame, insertedAt: Date.now() });
        this.evictIfNeeded(idx);

        // 唤醒等待此 timestamp 的 waiter (允许多个 in-flight)
        const waiter = this.waiters.get(ts);
        if (waiter) {
            this.waiters.delete(ts);
            waiter.resolve(frame);
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
