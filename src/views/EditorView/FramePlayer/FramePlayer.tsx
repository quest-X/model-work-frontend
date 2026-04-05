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
    const MAX_CACHED_FRAMES = 200;
    // 防止同一帧重复请求
    const pendingRequestsRef = useRef<Map<number, Promise<HTMLImageElement>>>(new Map());

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

            // 4. 按需从后端获取（大视频模式）
            if (!frameFile && sessionId) {
                const fetched = await FrameExtractorService.fetchFrameRange(sessionId, frameIdx, 1);
                if (fetched.length > 0) {
                    frameFile = fetched[0];
                    // 存入全局帧池以便复用
                    if (allFrames.length <= frameIdx) {
                        // 扩展数组（稀疏）
                        allFrames[frameIdx] = frameFile;
                    }
                }
            }

            if (!frameFile) {
                throw new Error(`Frame ${frameIdx} unavailable`);
            }

            // LRU 驱逐
            if (cache.size >= MAX_CACHED_FRAMES) {
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

    // 绘制指定帧到 canvas
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

            // 更新 EditorModel.videoFrameImage（供 Editor 渲染引擎使用）
            if (!EditorModel.videoFrameImage ||
                EditorModel.videoFrameImage.naturalWidth !== videoSize.width ||
                EditorModel.videoFrameImage.naturalHeight !== videoSize.height) {
                // 创建全分辨率 Image
                const fullCanvas = document.createElement('canvas');
                fullCanvas.width = videoSize.width;
                fullCanvas.height = videoSize.height;
                const fullCtx = fullCanvas.getContext('2d')!;
                fullCtx.drawImage(img, 0, 0, videoSize.width, videoSize.height);
                const dataUrl = fullCanvas.toDataURL('image/jpeg', 0.9);
                const fullImage = new Image();
                fullImage.src = dataUrl;
                await new Promise<void>(r => { fullImage.onload = () => r(); });
                EditorModel.videoFrameImage = fullImage;
            } else {
                // 复用已有的 Image 对象，仅重绘内容
                const fullCanvas = document.createElement('canvas');
                fullCanvas.width = videoSize.width;
                fullCanvas.height = videoSize.height;
                const fullCtx = fullCanvas.getContext('2d')!;
                fullCtx.drawImage(img, 0, 0, videoSize.width, videoSize.height);
                const dataUrl = fullCanvas.toDataURL('image/jpeg', 0.9);
                const newImage = new Image();
                newImage.src = dataUrl;
                await new Promise<void>(r => { newImage.onload = () => r(); });
                EditorModel.videoFrameImage = newImage;
            }
        } catch (err) {
            console.error(`[FramePlayer] drawFrame(${frameIdx}) failed:`, err);
        }
    }, [loadFrameImage, videoSize]);

    // 预加载：加载当前帧附近的帧
    // === 3 层预取策略 ===
    // P0: 首屏（帧 0-19）— init 时立刻触发
    // P1: 播放缓冲（帧 20-499）— P0 完成后触发
    // P2: 跳帧窗口（目标帧 -20 ~ +80）— seek/播放时触发

    const preloadRange = useCallback((start: number, end: number) => {
        const s = Math.max(0, start);
        const e = Math.min(totalFrames, end);
        for (let i = s; i < e; i++) {
            if (!frameCacheRef.current.has(i)) {
                loadFrameImage(i).catch(() => {/* ignore */});
            }
        }
    }, [totalFrames, loadFrameImage]);

    // P2: 跳帧/播放窗口 — 前 20 后 80
    const preloadAroundPosition = useCallback((targetFrame: number) => {
        preloadRange(targetFrame - 20, targetFrame + 80);
    }, [preloadRange]);

    // P0 + P1: 首屏 + 播放缓冲
    const preloadInitial = useCallback(async () => {
        // P0: 帧 0-19（同步预取，最高优先）
        preloadRange(0, 20);
        // P1: 帧 20-499（稍后预取，播放缓冲）
        setTimeout(() => preloadRange(20, 500), 100);
    }, [preloadRange]);

    // 播放时追踪上次预取位置，每推进 30 帧触发一次 P2
    const lastPreloadFrameRef = useRef(0);

    // 初始化：加载第一帧 + 通知元数据
    useEffect(() => {
        // 全量模式需要 frames，按需模式需要 sessionId
        const hasSource = frames.length > 0 || !!sessionId;
        if (!hasSource || videoSize.width === 0) return undefined;

        let cancelled = false;

        const init = async () => {
            try {
                await loadFrameImage(0);
                if (cancelled) return;

                await drawFrame(0);
                if (cancelled) return;

                setIsLoaded(true);

                // 通知父组件元数据
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

                // P0 + P1 预取
                preloadInitial();
            } catch (err) {
                console.error('[FramePlayer] Init failed:', err);
            }
        };

        init();

        return () => {
            cancelled = true;
            setIsLoaded(false);
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
                    // 通知最终帧
                    onTimeUpdateRef.current?.(duration, totalFrames - 1);
                    drawFrame(totalFrames - 1);
                    // 通知暂停（不用 onPlayPause 切换，直接通知父组件停止）
                    onPlayPauseRef.current?.();
                    return;
                }

                playFrameRef.current = nextFrame;
                const time = nextFrame / fps;

                onTimeUpdateRef.current?.(time, nextFrame);
                drawFrame(nextFrame);

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
    }, [isPlaying, isLoaded, fps, totalFrames, duration, drawFrame, preloadAroundPosition]);

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
