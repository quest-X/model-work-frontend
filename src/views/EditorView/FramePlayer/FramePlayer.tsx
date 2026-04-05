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
    // 帧完整加载回调：Image 解码 + 缩略图生成完毕
    onFrameReady?: (frameIdx: number, thumbnailImage: HTMLImageElement) => void;
}

const THUMBNAIL_SIZE = 150;
const BATCH_SIZE = 30;

// === available_frames 滑动窗口 ===
const MIN_AHEAD = 500;       // 当前位置前方始终保持 500 帧可播放
const MAX_AVAILABLE = 2000;  // 缓存上限（超出则淘汰远离当前位置的旧帧）
const KEEP_BEHIND = 100;     // 当前位置后方保留 100 帧（支持短回退）

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
    onFrameReady,
}) => {
    const texts = LanguageConfig[language];
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const focusableElementRef = useRef<HTMLDivElement>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0); // initLoad 进度 0-100

    // 帧图像缓存
    const frameCacheRef = useRef<Map<number, HTMLImageElement>>(new Map());
    const blobUrlCacheRef = useRef<Map<number, string>>(new Map());

    // 稳定 ref
    const onTimeUpdateRef = useRef(onTimeUpdate);
    onTimeUpdateRef.current = onTimeUpdate;
    const onPlayPauseRef = useRef(onPlayPause);
    onPlayPauseRef.current = onPlayPause;
    const isPlayingRef = useRef(isPlaying);
    isPlayingRef.current = isPlaying;
    const onFrameReadyRef = useRef(onFrameReady);
    onFrameReadyRef.current = onFrameReady;

    // 播放
    const playIntervalRef = useRef<ReturnType<typeof setInterval>>();
    const playFrameRef = useRef(0);
    const isVideoEndedRef = useRef(false);

    // 加载去重
    const pendingRequestsRef = useRef<Map<number, Promise<HTMLImageElement>>>(new Map());
    const pendingBatchRef = useRef<Map<number, Promise<File[]>>>(new Map());

    // === available_frames 滑动窗口控制 ===
    const loadGenRef = useRef(0);       // 取消令牌
    const thumbnailCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const initPhaseRef = useRef(true);  // 初始化阶段标志
    const lastSeekFrameRef = useRef(-1);

    // 稳定 ref
    const loadFrameFullRef = useRef<(frameIdx: number) => Promise<void>>(() => Promise.resolve());
    const maintainRef = useRef<() => void>(() => {});

    // 加载单帧图像（缓存 → 全局帧池 → 后端批量取）
    const loadFrameImage = useCallback(async (frameIdx: number): Promise<HTMLImageElement> => {
        if (frameIdx < 0 || frameIdx >= totalFrames) {
            throw new Error(`Frame ${frameIdx} out of range [0, ${totalFrames})`);
        }

        const cache = frameCacheRef.current;
        const cached = cache.get(frameIdx);
        if (cached) return cached;

        const preloaded = EditorModel.preloadedImageCache.get(frameIdx);
        if (preloaded) {
            cache.set(frameIdx, preloaded);
            EditorModel.preloadedImageCache.delete(frameIdx);
            return preloaded;
        }

        const pending = pendingRequestsRef.current.get(frameIdx);
        if (pending) return pending;

        const promise = (async () => {
            const allFrames = EditorModel.videoFrameFiles;
            let frameFile = (allFrames.length > frameIdx ? allFrames[frameIdx] : null)
                || (frames.length > frameIdx ? frames[frameIdx] : null);

            if (!frameFile && sessionId) {
                const batchStart = Math.floor(frameIdx / BATCH_SIZE) * BATCH_SIZE;
                const batchCount = Math.min(BATCH_SIZE, totalFrames - batchStart);
                let batchPromise = pendingBatchRef.current.get(batchStart);
                if (!batchPromise) {
                    batchPromise = FrameExtractorService.fetchFrameRange(sessionId, batchStart, batchCount);
                    pendingBatchRef.current.set(batchStart, batchPromise);
                    batchPromise.finally(() => pendingBatchRef.current.delete(batchStart));
                }
                const fetched = await batchPromise;
                for (let i = 0; i < fetched.length; i++) {
                    allFrames[batchStart + i] = fetched[i];
                }
                frameFile = allFrames[frameIdx] || null;
            }

            if (!frameFile) throw new Error(`Frame ${frameIdx} unavailable`);

            // 驱逐由 evictOldFrames 统一处理，此处不做

            return new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                const url = URL.createObjectURL(frameFile!);
                blobUrlCacheRef.current.set(frameIdx, url);
                img.onload = () => { cache.set(frameIdx, img); resolve(img); };
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    blobUrlCacheRef.current.delete(frameIdx);
                    reject(new Error(`Failed to decode frame ${frameIdx}`));
                };
                img.src = url;
            });
        })();

        pendingRequestsRef.current.set(frameIdx, promise);
        try { return await promise; }
        finally { pendingRequestsRef.current.delete(frameIdx); }
    }, [frames, sessionId, totalFrames]);

    const ensureCanvasSize = (canvas: HTMLCanvasElement) => {
        if (canvas.width !== videoSize.width || canvas.height !== videoSize.height) {
            canvas.width = videoSize.width;
            canvas.height = videoSize.height;
        }
    };

    const drawFrame = useCallback(async (frameIdx: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ensureCanvasSize(canvas);
        try {
            const img = await loadFrameImage(frameIdx);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            EditorModel.videoFrameImage = img;
        } catch (err) {
            console.error(`[FramePlayer] drawFrame(${frameIdx}) failed:`, err);
        }
    }, [loadFrameImage, videoSize]);

    const drawFrameSync = useCallback((frameIdx: number): boolean => {
        const canvas = canvasRef.current;
        if (!canvas) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;

        let cached = frameCacheRef.current.get(frameIdx);
        if (!cached) {
            const preloaded = EditorModel.preloadedImageCache.get(frameIdx);
            if (preloaded) {
                frameCacheRef.current.set(frameIdx, preloaded);
                EditorModel.preloadedImageCache.delete(frameIdx);
                cached = preloaded;
            } else {
                return false;
            }
        }
        ensureCanvasSize(canvas);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(cached, 0, 0, canvas.width, canvas.height);
        EditorModel.videoFrameImage = cached;
        return true;
    }, [videoSize]);

    // === 完整加载一帧：Image 解码 + 缩略图 ===
    const loadFrameFull = useCallback(async (frameIdx: number): Promise<void> => {
        try {
            const img = await loadFrameImage(frameIdx);
            const cb = onFrameReadyRef.current;
            if (!cb || videoSize.width === 0) return;

            if (!thumbnailCanvasRef.current) {
                const c = document.createElement('canvas');
                c.width = THUMBNAIL_SIZE;
                c.height = THUMBNAIL_SIZE;
                thumbnailCanvasRef.current = c;
            }
            const ctx = thumbnailCanvasRef.current.getContext('2d');
            if (!ctx) return;

            const scale = Math.min(THUMBNAIL_SIZE / videoSize.width, THUMBNAIL_SIZE / videoSize.height);
            const sw = videoSize.width * scale;
            const sh = videoSize.height * scale;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
            ctx.drawImage(img, (THUMBNAIL_SIZE - sw) / 2, (THUMBNAIL_SIZE - sh) / 2, sw, sh);

            const dataUrl = thumbnailCanvasRef.current.toDataURL('image/jpeg', 0.5);
            await new Promise<void>(resolve => {
                const thumb = new Image();
                thumb.onload = () => { cb(frameIdx, thumb); resolve(); };
                thumb.onerror = () => resolve();
                thumb.src = dataUrl;
            });
        } catch (err) {
            console.error(`[FramePlayer] loadFrameFull(${frameIdx}) failed:`, err);
        }
    }, [loadFrameImage, videoSize]);

    // === available_frames 滑动窗口维护 ===
    // 淘汰远离当前位置的旧帧
    const evictOldFrames = useCallback((currentPos: number) => {
        const cache = frameCacheRef.current;
        if (cache.size <= MAX_AVAILABLE) return;

        const toEvict: number[] = [];
        for (const key of cache.keys()) {
            if (key < currentPos - KEEP_BEHIND) toEvict.push(key);
            if (cache.size - toEvict.length <= MAX_AVAILABLE) break;
        }
        for (const key of toEvict) {
            cache.delete(key);
            const url = blobUrlCacheRef.current.get(key);
            if (url) { URL.revokeObjectURL(url); blobUrlCacheRef.current.delete(key); }
        }
        if (toEvict.length > 0) {
            console.log(`[FramePlayer] 淘汰 ${toEvict.length} 旧帧, 缓存=${cache.size}`);
        }
    }, []);

    // 持续维护 available_frames：保证当前位置前方始终有 MIN_AHEAD 帧可播放
    const maintainAvailableFrames = useCallback(async () => {
        const gen = ++loadGenRef.current;

        while (loadGenRef.current === gen) {
            const pos = isPlayingRef.current ? playFrameRef.current : currentFrameRef.current;
            const searchEnd = Math.min(pos + MAX_AVAILABLE, totalFrames);

            // 找当前位置前方第一个未缓存帧
            let target = -1;
            for (let i = Math.max(0, pos); i < searchEnd; i++) {
                if (!frameCacheRef.current.has(i)) { target = i; break; }
            }

            if (target < 0) {
                // 窗口内全部已缓存
                await new Promise(r => setTimeout(r, 200));
                continue;
            }

            const isUrgent = target < pos + MIN_AHEAD;

            if (isUrgent) {
                // 紧急：在 MIN_AHEAD 范围内有空缺 → 只缓存图片（快，即使播放中也加载）
                try { await loadFrameImage(target); } catch {}
            } else if (!isPlayingRef.current) {
                // 非紧急 + 未播放 → 完整加载（含缩略图）
                try { await loadFrameFullRef.current(target); } catch {}
                if (target % 10 === 0) await new Promise(r => setTimeout(r, 0));
            } else {
                // 非紧急 + 播放中 → 缓冲充足，暂停加载
                await new Promise(r => setTimeout(r, 300));
                continue;
            }

            // 淘汰旧帧
            evictOldFrames(pos);
        }
    }, [totalFrames, loadFrameImage, evictOldFrames]);

    // 更新稳定 ref
    loadFrameFullRef.current = loadFrameFull;
    maintainRef.current = () => { maintainAvailableFrames(); };

    // === 初始化 ===
    const initDoneRef = useRef(false);
    useEffect(() => {
        const hasSource = frames.length > 0 || !!sessionId;
        if (!hasSource || videoSize.width === 0) return undefined;
        if (initDoneRef.current) return undefined;

        let cancelled = false;

        const init = async () => {
            try {
                // 移入解析阶段预加载缓存
                const preloaded = EditorModel.preloadedImageCache;
                if (preloaded.size > 0) {
                    for (const [idx, img] of preloaded) {
                        frameCacheRef.current.set(idx, img);
                    }
                    console.log(`[FramePlayer] 从预加载缓存移入 ${preloaded.size} 帧到 LRU`);
                    preloaded.clear();
                }

                // 加载并绘制第 0 帧
                await loadFrameImage(0);
                if (cancelled) return;
                await drawFrame(0);
                if (cancelled) return;

                initDoneRef.current = true;

                // 通知父组件元数据（触发 ImageData 创建）
                onLoadedMetadata?.(duration, totalFrames, fps, videoSize);

                if (canvasRef.current) {
                    setTimeout(() => {
                        if (!cancelled && canvasRef.current) {
                            onFirstFrameDrawn?.(canvasRef.current);
                        }
                    }, 0);
                }

                focusableElementRef.current?.focus();

                // 等待 VideoEditor 创建 ImageData（下一个 React 渲染周期）
                await new Promise(r => setTimeout(r, 100));
                if (cancelled) return;

                const gen = ++loadGenRef.current;
                const initEnd = Math.min(MIN_AHEAD, totalFrames);

                for (let i = 0; i < initEnd; i++) {
                    if (loadGenRef.current !== gen || cancelled) return;
                    await loadFrameFullRef.current(i);
                    if (i % 30 === 0) {
                        setLoadingProgress(Math.round(((i + 1) / initEnd) * 100));
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
                if (loadGenRef.current !== gen || cancelled) return;

                setIsLoaded(true);

                // 初始化完成，允许 seek
                initPhaseRef.current = false;

                // 启动 available_frames 滑动窗口维护
                maintainRef.current();
            } catch (err) {
                console.error('[FramePlayer] Init failed:', err);
            }
        };

        init();
        return () => { cancelled = true; };
    }, [frames.length, sessionId, videoSize.width, videoSize.height]); // eslint-disable-line react-hooks/exhaustive-deps

    // 播放帧 ref
    const currentFrameRef = useRef(currentFrame);
    currentFrameRef.current = currentFrame;

    // === 播放/暂停控制 ===
    useEffect(() => {
        if (!isLoaded) return undefined;

        if (isPlaying) {
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
                onTimeUpdateRef.current?.(nextFrame / fps, nextFrame);

                if (!drawFrameSync(nextFrame)) {
                    drawFrame(nextFrame);
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
    }, [isPlaying, isLoaded, fps, totalFrames, duration, drawFrameSync, drawFrame]);

    // === 外部 seek（暂停时响应 currentTime 变化）===
    useEffect(() => {
        if (!isLoaded || isPlaying) return;
        // 初始化阶段不响应 seek，避免干扰 initLoad
        if (initPhaseRef.current) return;

        const targetFrame = Math.max(0, Math.min(Math.round(currentTime * fps), totalFrames - 1));

        // 帧号没变则跳过，防止 seek 重复触发
        if (targetFrame === lastSeekFrameRef.current) return;
        lastSeekFrameRef.current = targetFrame;

        drawFrame(targetFrame);
        // 重启滑动窗口维护，从新位置开始填充
        maintainRef.current();
    }, [currentTime, isLoaded, isPlaying, fps, totalFrames, drawFrame]);

    // 键盘快捷键
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

    // 清理（不主动 revokeObjectURL，避免 Strict Mode 双重挂载间撤销正在加载的 URL）
    useEffect(() => {
        return () => {
            loadGenRef.current++; // 终止 maintainAvailableFrames 循环
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
                    <p>解析中 {loadingProgress}%</p>
                </div>
            )}
        </div>
    );
};

export default FramePlayer;
