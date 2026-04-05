import React, { useRef, useEffect, useState, useCallback } from 'react';
import '../VideoPlayer/VideoPlayer.scss';
import { ISize } from '../../../interfaces/ISize';
import { Language, LanguageConfig } from '../../../data/LanguageConfig';
import { EditorModel } from '../../../staticModels/EditorModel';
import { FrameExtractorService } from '../../../services/FrameExtractorService';

interface IProps {
    language: Language;
    frames: File[];
    sessionId?: string;  // 按需取帧模式的会话 ID
    fps: number;
    duration: number;
    totalFrames: number;
    videoSize: ISize;
    currentTime: number;
    currentFrame: number;
    isPlaying?: boolean;
    onTimeUpdate?: (time: number, frame: number) => void;
    onLoadedMetadata?: (duration: number, frames: number, fps: number, videoSize: ISize) => void;
    onPlayPause?: () => void;
    onFirstFrameDrawn?: (canvas: HTMLCanvasElement) => void;
}

const FramePlayer: React.FC<IProps> = ({
    language,
    frames,
    sessionId,
    fps,
    duration,
    totalFrames,
    videoSize,
    currentTime,
    currentFrame,
    isPlaying = false,
    onTimeUpdate,
    onLoadedMetadata,
    onPlayPause,
    onFirstFrameDrawn,
}) => {
    const texts = LanguageConfig[language];
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const focusableElementRef = useRef<HTMLDivElement>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    // 帧图像缓存：frameIndex → HTMLImageElement
    const frameCacheRef = useRef<Map<number, HTMLImageElement>>(new Map());
    // Blob URL 缓存：frameIndex → URL (用于及时释放)
    const blobUrlCacheRef = useRef<Map<number, string>>(new Map());

    // 稳定的 ref 模式（与 VideoPlayer 一致）
    const onTimeUpdateRef = useRef(onTimeUpdate);
    onTimeUpdateRef.current = onTimeUpdate;
    const onPlayPauseRef = useRef(onPlayPause);
    onPlayPauseRef.current = onPlayPause;
    const isPlayingRef = useRef(isPlaying);
    isPlayingRef.current = isPlaying;

    // 播放定时器
    const playIntervalRef = useRef<ReturnType<typeof setInterval>>();
    const playFrameRef = useRef(0);
    const isVideoEndedRef = useRef(false); // 是否播放到末尾

    // 加载单帧图像 — 三层查找：LRU 缓存 → 全局帧池 → 后端按需请求
    // 缓存上限：100000 帧，但会通过内存检查动态限制
    const MAX_CACHED_FRAMES = 100000;
    // 防止同一帧重复请求
    const pendingRequestsRef = useRef<Map<number, Promise<HTMLImageElement>>>(new Map());
    // 防止同一批次重复请求后端
    const pendingBatchRef = useRef<Map<number, Promise<File[]>>>(new Map());

    const loadFrameImage = useCallback(async (frameIdx: number): Promise<HTMLImageElement> => {
        if (frameIdx < 0 || frameIdx >= totalFrames) {
            throw new Error(`Frame ${frameIdx} out of range [0, ${totalFrames})`);
        }

        // 1. LRU 缓存命中
        const cache = frameCacheRef.current;
        const cached = cache.get(frameIdx);
        if (cached) return cached;

        // 2. 防止重复请求
        const pending = pendingRequestsRef.current.get(frameIdx);
        if (pending) return pending;

        const promise = (async () => {
            // 3. 全局帧池 / props.frames
            const allFrames = EditorModel.videoFrameFiles;
            let frameFile = (allFrames.length > frameIdx ? allFrames[frameIdx] : null)
                || (frames.length > frameIdx ? frames[frameIdx] : null);

            // 4. 按需从后端获取（大视频模式）— 批量取帧避免逐帧请求
            if (!frameFile && sessionId) {
                const BATCH_SIZE = 30;
                const batchStart = Math.floor(frameIdx / BATCH_SIZE) * BATCH_SIZE;
                const batchCount = Math.min(BATCH_SIZE, totalFrames - batchStart);

                // 复用同一批次的请求
                let batchPromise = pendingBatchRef.current.get(batchStart);
                if (!batchPromise) {
                    batchPromise = FrameExtractorService.fetchFrameRange(sessionId, batchStart, batchCount);
                    pendingBatchRef.current.set(batchStart, batchPromise);
                    batchPromise.finally(() => pendingBatchRef.current.delete(batchStart));
                }
                const fetched = await batchPromise;
                // 存入全局帧池
                for (let i = 0; i < fetched.length; i++) {
                    allFrames[batchStart + i] = fetched[i];
                }
                frameFile = allFrames[frameIdx] || null;
            }

            if (!frameFile) {
                throw new Error(`Frame ${frameIdx} unavailable`);
            }

            // 内存感知驱逐：帧数上限 + 内存上限（可用内存的 80%）
            const shouldEvict = (() => {
                if (cache.size >= MAX_CACHED_FRAMES) return true;
                // 检查内存压力（仅 Chrome 支持 performance.memory）
                const mem = (performance as any).memory;
                if (mem && mem.jsHeapSizeLimit > 0) {
                    const usageRatio = mem.usedJSHeapSize / mem.jsHeapSizeLimit;
                    if (usageRatio > 0.8) return true;
                }
                return false;
            })();
            if (shouldEvict && cache.size > 0) {
                const firstKey = cache.keys().next().value;
                cache.delete(firstKey);
                const oldUrl = blobUrlCacheRef.current.get(firstKey);
                if (oldUrl) {
                    URL.revokeObjectURL(oldUrl);
                    blobUrlCacheRef.current.delete(firstKey);
                }
            }

            // 创建 Image
            return new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                const url = URL.createObjectURL(frameFile!);
                blobUrlCacheRef.current.set(frameIdx, url);
                img.onload = () => {
                    cache.set(frameIdx, img);
                    resolve(img);
                };
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    blobUrlCacheRef.current.delete(frameIdx);
                    reject(new Error(`Failed to decode frame ${frameIdx}`));
                };
                img.src = url;
            });
        })();

        pendingRequestsRef.current.set(frameIdx, promise);
        try {
            const result = await promise;
            return result;
        } finally {
            pendingRequestsRef.current.delete(frameIdx);
        }
    }, [frames, sessionId, totalFrames]);

    // 绘制指定帧到 canvas（同步快速路径 + 异步慢速路径）
    // 用于 Editor 渲染的离屏 canvas（复用，避免每帧创建）
    const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

    const drawFrame = useCallback(async (frameIdx: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (canvas.width !== videoSize.width || canvas.height !== videoSize.height) {
            canvas.width = videoSize.width;
            canvas.height = videoSize.height;
        }

        try {
            const img = await loadFrameImage(frameIdx);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            // 更新 EditorModel.videoFrameImage — 直接用已加载的 img
            EditorModel.videoFrameImage = img;
        } catch (err) {
            console.error(`[FramePlayer] drawFrame(${frameIdx}) failed:`, err);
        }
    }, [loadFrameImage, videoSize]);

    // 同步绘制：仅在缓存命中时绘制，返回是否成功（播放丢帧用）
    const drawFrameSync = useCallback((frameIdx: number): boolean => {
        const canvas = canvasRef.current;
        if (!canvas) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;

        const cached = frameCacheRef.current.get(frameIdx);
        if (!cached) return false;

        if (canvas.width !== videoSize.width || canvas.height !== videoSize.height) {
            canvas.width = videoSize.width;
            canvas.height = videoSize.height;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(cached, 0, 0, canvas.width, canvas.height);
        EditorModel.videoFrameImage = cached;
        return true;
    }, [videoSize]);

    // 预加载：加载当前帧附近的帧
    // === 4 层预取策略 ===
    // P0: 首屏（帧 0-49）— init 时立刻触发，完成后立刻触发 P1
    // P1: 播放缓冲（每次 500 帧）— P0 完成后立刻触发
    // P2: 跳帧窗口（当前帧 -100 ~ +500）— seek/播放时触发
    // P3: 常备化预加载 — P0-P2 空闲时，从头到尾加载所有帧（上限 100000）

    // P3 取消标志：当 P2 触发时取消正在进行的 P3
    const p3CancelledRef = useRef(false);
    const p3RunningRef = useRef(false);
    // 当前活跃的 P0-P2 任务数
    const activePriorityTasksRef = useRef(0);

    const preloadRange = useCallback(async (start: number, end: number, priority: 'p0' | 'p1' | 'p2' | 'p3' = 'p1') => {
        const s = Math.max(0, start);
        const e = Math.min(totalFrames, end);
        if (s >= e) return;

        const isHighPriority = priority !== 'p3';
        if (isHighPriority) activePriorityTasksRef.current++;

        try {
            const BATCH = 30;
            for (let batchStart = Math.floor(s / BATCH) * BATCH; batchStart < e; batchStart += BATCH) {
                // P3 在高优先级任务进入时让路
                if (priority === 'p3' && p3CancelledRef.current) return;

                const batchEnd = Math.min(batchStart + BATCH, e);
                // 检查此批次是否已全部缓存
                let allCached = true;
                let firstUncached = -1;
                for (let i = Math.max(s, batchStart); i < batchEnd; i++) {
                    if (!frameCacheRef.current.has(i)) {
                        allCached = false;
                        if (firstUncached < 0) firstUncached = i;
                        break;
                    }
                }
                if (allCached) continue;

                if (firstUncached >= 0) {
                    try {
                        await loadFrameImage(firstUncached);
                    } catch { /* ignore */ }
                }

                // P3 每批后检查内存
                if (priority === 'p3') {
                    const m = (performance as any).memory;
                    const pressure = m && m.jsHeapSizeLimit > 0 && (m.usedJSHeapSize / m.jsHeapSizeLimit) > 0.8;
                    if (frameCacheRef.current.size >= MAX_CACHED_FRAMES || pressure) return;
                }
            }
        } finally {
            if (isHighPriority) activePriorityTasksRef.current--;
        }
    }, [totalFrames, loadFrameImage]);

    // P3: 常备化预加载 — 空闲时从头到尾加载未缓存帧
    const startP3 = useCallback(async () => {
        if (p3RunningRef.current) return;
        p3RunningRef.current = true;
        p3CancelledRef.current = false;

        const MAX_P3_FRAMES = Math.min(100000, totalFrames);

        // 等待 P0-P2 完成
        while (activePriorityTasksRef.current > 0) {
            await new Promise(r => setTimeout(r, 200));
            if (p3CancelledRef.current) { p3RunningRef.current = false; return; }
        }

        // 从头开始找未加载的帧，逐批加载
        const BATCH = 30;
        for (let i = 0; i < MAX_P3_FRAMES; i += BATCH) {
            if (p3CancelledRef.current) break;
            // 等待高优先级任务完成
            while (activePriorityTasksRef.current > 0) {
                await new Promise(r => setTimeout(r, 200));
                if (p3CancelledRef.current) break;
            }
            if (p3CancelledRef.current) break;

            // 检查内存：帧数上限或内存压力则停止
            const mem = (performance as any).memory;
            const memoryPressure = mem && mem.jsHeapSizeLimit > 0 && (mem.usedJSHeapSize / mem.jsHeapSizeLimit) > 0.8;
            if (frameCacheRef.current.size >= MAX_CACHED_FRAMES || memoryPressure) {
                console.log(`[FramePlayer] P3 停止: 缓存 ${frameCacheRef.current.size} 帧, 内存压力: ${memoryPressure}`);
                break;
            }

            // 检查此批次是否需要加载
            let needsLoad = false;
            for (let j = i; j < Math.min(i + BATCH, MAX_P3_FRAMES); j++) {
                if (!frameCacheRef.current.has(j)) { needsLoad = true; break; }
            }
            if (!needsLoad) continue;

            await preloadRange(i, Math.min(i + BATCH, MAX_P3_FRAMES), 'p3');
        }

        p3RunningRef.current = false;
    }, [totalFrames, preloadRange]);

    // P0 + P1 + P3: 首屏 → 播放缓冲 → 常备化
    const preloadInitial = useCallback(async () => {
        // P0: 帧 0-49（最高优先）
        await preloadRange(0, 50, 'p0');
        // P1: 帧 50-549（P0 完成后立刻触发）
        await preloadRange(50, 550, 'p1');
        // P3: 空闲时从头到尾加载
        startP3();
    }, [preloadRange, startP3]);

    // P2: 跳帧/播放窗口 — 前 100 后 500
    const preloadAroundPosition = useCallback(async (targetFrame: number) => {
        // 打断 P3
        p3CancelledRef.current = true;
        await preloadRange(targetFrame - 100, targetFrame + 500, 'p2');
        // P2 完成后恢复 P3
        startP3();
    }, [preloadRange, startP3]);

    // 播放时追踪上次预取位置，每推进 30 帧触发一次 P2
    const lastPreloadFrameRef = useRef(0);

    // 初始化：加载第一帧 + 通知元数据（只执行一次）
    const initDoneRef = useRef(false);
    useEffect(() => {
        // 全量模式需要 frames，按需模式需要 sessionId
        const hasSource = frames.length > 0 || !!sessionId;
        if (!hasSource || videoSize.width === 0) return undefined;
        if (initDoneRef.current) return undefined;

        let cancelled = false;

        const init = async () => {
            try {
                await loadFrameImage(0);
                if (cancelled) return;

                await drawFrame(0);
                if (cancelled) return;

                initDoneRef.current = true;

                // 通知父组件元数据（触发缩略图生成）
                onLoadedMetadata?.(duration, totalFrames, fps, videoSize);

                // 触发第一帧绘制回调
                if (canvasRef.current) {
                    setTimeout(() => {
                        if (!cancelled && canvasRef.current) {
                            onFirstFrameDrawn?.(canvasRef.current);
                        }
                    }, 0);
                }

                // 自动聚焦
                focusableElementRef.current?.focus();

                // 帧0已加载，立即允许播放
                setIsLoaded(true);

                // 延迟 500ms 启动预加载，让缩略图生成先填充全局帧池，避免重复请求后端
                setTimeout(() => {
                    preloadRange(0, 50, 'p0')
                        .then(() => preloadRange(50, 550, 'p1'))
                        .then(() => startP3());
                }, 500);
            } catch (err) {
                console.error('[FramePlayer] Init failed:', err);
            }
        };

        init();

        return () => {
            cancelled = true;
        };
    }, [frames, sessionId, videoSize.width, videoSize.height]);  // eslint-disable-line react-hooks/exhaustive-deps

    // 用 ref 跟踪 currentFrame，避免播放 effect 依赖它导致 interval 反复重建
    const currentFrameRef = useRef(currentFrame);
    currentFrameRef.current = currentFrame;

    // 播放/暂停控制
    useEffect(() => {
        if (!isLoaded) return undefined;

        if (isPlaying) {
            // 如果播放到末尾后重新播放，重置到第 0 帧
            if (isVideoEndedRef.current) {
                isVideoEndedRef.current = false;
                playFrameRef.current = 0;
                onTimeUpdateRef.current?.(0, 0);
                drawFrame(0);
            } else {
                playFrameRef.current = currentFrameRef.current;
            }

            const interval = 1000 / fps;

            playIntervalRef.current = setInterval(() => {
                const nextFrame = playFrameRef.current + 1;

                if (nextFrame >= totalFrames) {
                    // 播放到末尾
                    clearInterval(playIntervalRef.current);
                    playIntervalRef.current = undefined;
                    isVideoEndedRef.current = true;
                    onTimeUpdateRef.current?.(duration, totalFrames - 1);
                    if (!drawFrameSync(totalFrames - 1)) {
                        drawFrame(totalFrames - 1);
                    }
                    onPlayPauseRef.current?.();
                    return;
                }

                playFrameRef.current = nextFrame;
                const time = nextFrame / fps;
                onTimeUpdateRef.current?.(time, nextFrame);

                // 同步绘制优先：缓存命中就画，没命中就异步加载（不阻塞 interval）
                if (!drawFrameSync(nextFrame)) {
                    drawFrame(nextFrame); // 异步，不 await，不卡住播放节奏
                }

                // P2: 每推进 30 帧触发一次预取（前20后80）
                if (nextFrame - lastPreloadFrameRef.current >= 30) {
                    lastPreloadFrameRef.current = nextFrame;
                    preloadAroundPosition(nextFrame);
                }
            }, interval);
        } else {
            if (playIntervalRef.current) {
                clearInterval(playIntervalRef.current);
                playIntervalRef.current = undefined;
            }
        }

        return () => {
            if (playIntervalRef.current) {
                clearInterval(playIntervalRef.current);
                playIntervalRef.current = undefined;
            }
        };
    }, [isPlaying, isLoaded, fps, totalFrames, duration, drawFrameSync, preloadAroundPosition]);

    // 外部时间变化 → seek（仅在暂停时响应）
    useEffect(() => {
        if (!isLoaded || isPlaying) return;

        const targetFrame = Math.min(Math.round(currentTime * fps), totalFrames - 1);
        drawFrame(Math.max(0, targetFrame));
        // P2: seek 时预取目标帧前20后80
        preloadAroundPosition(targetFrame);
    }, [currentTime, isLoaded, isPlaying, fps, totalFrames, drawFrame, preloadAroundPosition]);

    // 键盘快捷键：空格播放/暂停
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isLoaded) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onPlayPauseRef.current?.();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isLoaded]);

    // 清理：清空缓存引用（不主动 revokeObjectURL，避免 Strict Mode 下撤销正在加载的 URL）
    // 浏览器会在 Image 对象被 GC 后自动回收 blob URL
    useEffect(() => {
        return () => {
            frameCacheRef.current = new Map();
            blobUrlCacheRef.current = new Map();
            pendingRequestsRef.current = new Map();
            EditorModel.videoFrameImage = null;
        };
    }, []);

    return (
        <div className="VideoPlayer" ref={containerRef}>
            <div
                ref={focusableElementRef}
                tabIndex={0}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    outline: 'none',
                    zIndex: 1
                }}
                aria-label={texts.video.playerAriaLabel}
            />
            <canvas
                ref={canvasRef}
                className="VideoCanvas"
                style={{
                    display: 'block',
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain'
                }}
            />
            {!isLoaded && (
                <div className="LoadingOverlay">
                    <div className="LoadingSpinner"></div>
                    <p>加载帧数据中...</p>
                </div>
            )}
        </div>
    );
};

export default FramePlayer;
