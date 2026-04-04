import React, { useRef, useEffect, useState, useCallback } from 'react';
import '../VideoPlayer/VideoPlayer.scss';
import { ISize } from '../../../interfaces/ISize';
import { Language, LanguageConfig } from '../../../data/LanguageConfig';
import { EditorModel } from '../../../staticModels/EditorModel';

interface IProps {
    language: Language;
    frames: File[];
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

    // 加载单帧图像
    const loadFrameImage = useCallback((frameIdx: number): Promise<HTMLImageElement> => {
        const cache = frameCacheRef.current;
        const cached = cache.get(frameIdx);
        if (cached) return Promise.resolve(cached);

        return new Promise((resolve, reject) => {
            if (frameIdx < 0 || frameIdx >= frames.length) {
                reject(new Error(`Frame index ${frameIdx} out of range`));
                return;
            }
            const img = new Image();
            const url = URL.createObjectURL(frames[frameIdx]);
            blobUrlCacheRef.current.set(frameIdx, url);
            img.onload = () => {
                cache.set(frameIdx, img);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                blobUrlCacheRef.current.delete(frameIdx);
                reject(new Error(`Failed to load frame ${frameIdx}`));
            };
            img.src = url;
        });
    }, [frames]);

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
    const preloadFrames = useCallback((centerIdx: number, range: number = 10) => {
        const start = Math.max(0, centerIdx);
        const end = Math.min(frames.length, centerIdx + range);
        for (let i = start; i < end; i++) {
            if (!frameCacheRef.current.has(i)) {
                loadFrameImage(i).catch(() => {/* ignore preload failures */});
            }
        }
    }, [frames.length, loadFrameImage]);

    // 初始化：加载第一帧 + 通知元数据
    useEffect(() => {
        if (frames.length === 0 || videoSize.width === 0) return undefined;

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

                // 预加载前几帧
                preloadFrames(1, 20);
            } catch (err) {
                console.error('[FramePlayer] Init failed:', err);
            }
        };

        init();

        return () => {
            cancelled = true;
        };
    }, [frames, videoSize.width, videoSize.height]);  // eslint-disable-line react-hooks/exhaustive-deps

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

                // 预加载后续帧
                preloadFrames(nextFrame + 1, 10);
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
    }, [isPlaying, isLoaded, fps, totalFrames, duration, drawFrame, preloadFrames]);

    // 外部时间变化 → seek（仅在暂停时响应）
    useEffect(() => {
        if (!isLoaded || isPlaying) return;

        const targetFrame = Math.min(Math.round(currentTime * fps), totalFrames - 1);
        drawFrame(Math.max(0, targetFrame));
        preloadFrames(targetFrame, 10);
    }, [currentTime, isLoaded, isPlaying, fps, totalFrames, drawFrame, preloadFrames]);

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

    // 清理：释放所有 blob URL
    useEffect(() => {
        return () => {
            blobUrlCacheRef.current.forEach(url => URL.revokeObjectURL(url));
            blobUrlCacheRef.current.clear();
            frameCacheRef.current.clear();
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
