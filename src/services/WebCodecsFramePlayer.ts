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
    // 串行化解码: 每次 doDecode 等前一次完成,避免 _currentBatch* 状态被并发覆盖。
    // 看起来串行会变慢,但实际上 GPU decoder 内部本身就是流水线,串行 await 在 100ms
    // 量级下根本看不出来,反而避免了并发竞态导致的 waiter 永不 resolve 的 bug。
    private decodeChain: Promise<unknown> = Promise.resolve();
    // 当前正在解码的批次状态(由 doDecode 设置, handleDecodedFrame 读取)
    private currentExpected: Set<number> = new Set();
    private currentTarget: number = -1;
    private currentResolve: ((f: VideoFrame) => void) | null = null;
    private currentReject: ((e: Error) => void) | null = null;

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
                if (this.currentReject) {
                    this.currentReject(err);
                    this.currentReject = null;
                    this.currentResolve = null;
                }
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
     * 解码 frameIdx 所需的 chunks 并返回目标 VideoFrame。
     * 串行化: 每次 decode 等前一次 chain 完成,避免 currentExpected/Target 被并发覆盖。
     * 中间帧顺手进 LRU(下次 scrub 到附近帧零延迟)。
     */
    private async decodeFrame(frameIdx: number): Promise<VideoFrame> {
        const myTurn = this.decodeChain.then(() => this.doDecode(frameIdx));
        // chain 继续,即使本次失败也不阻断后续(catch 吞错只是给链用,真错由 myTurn 抛)
        this.decodeChain = myTurn.catch(() => undefined);
        return myTurn;
    }

    private async doDecode(frameIdx: number): Promise<VideoFrame> {
        // 二次检查 cache(链上前一帧可能正好把这帧解出来了)
        const cached = this.cache.get(frameIdx);
        if (cached) {
            this.cache.delete(frameIdx);
            this.cache.set(frameIdx, cached);
            return cached.frame;
        }

        const chunks = await this.demuxer.getChunksForFrame(frameIdx);
        const targetTimestamp = chunks[chunks.length - 1].timestamp;

        return new Promise<VideoFrame>((resolve, reject) => {
            this.currentExpected = new Set(chunks.map(c => c.timestamp));
            this.currentTarget = targetTimestamp;
            this.currentResolve = resolve;
            this.currentReject = reject;

            for (const chunk of chunks) this.decoder.decode(chunk);
            this.decoder.flush().catch((err) => {
                if (this.currentReject) {
                    this.currentReject(err);
                    this.currentReject = null;
                    this.currentResolve = null;
                }
            });
        });
    }

    private handleDecodedFrame(frame: VideoFrame): void {
        const ts = frame.timestamp;
        const isTarget = ts === this.currentTarget;
        const isExpected = this.currentExpected.has(ts);

        if (!isExpected) {
            // 流水线漏出来的旧帧, 不属于本批次
            frame.close();
            return;
        }

        // 进 LRU 缓存。target 的 frame 不进缓存(交给 caller, caller clone 后是否进缓存
        // 看策略;这里把 target 也放进去,resolve 时返回同一引用,close 由 LRU 管)
        const idx = this.demuxer.timestampToFrame(ts);
        const existing = this.cache.get(idx);
        if (existing) existing.frame.close();
        this.cache.set(idx, { frame, insertedAt: Date.now() });
        this.evictIfNeeded(idx);

        if (isTarget && this.currentResolve) {
            const resolve = this.currentResolve;
            this.currentResolve = null;
            this.currentReject = null;
            resolve(frame);
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
