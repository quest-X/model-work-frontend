import React, { useRef, useEffect, useState, useCallback } from 'react';
import './VideoPlayer.scss';
import { ISize } from '../../../interfaces/ISize';
import { Language, LanguageConfig } from '../../../data/LanguageConfig';
import { EditorModel } from '../../../staticModels/EditorModel';

interface IProps {
    language: Language;
    videoSrc: string; // 视频源
    currentTime: number; // 当前时间
    currentFrame: number; // 当前帧
    fps: number; // 帧率
    size?: ISize; // 播放器大小
    onTimeUpdate?: (time: number, frame: number) => void; // 时间更新回调
    onLoadedMetadata?: (duration: number, frames: number, fps: number, videoSize: ISize) => void; // 视频加载完成回调
    onPlay?: () => void; // 播放回调
    onPause?: () => void; // 暂停回调
    onPlayPause?: () => void; // 统一的播放/暂停切换回调
    isPlaying?: boolean; // 外部控制播放状态
    defaultMuted?: boolean; // 默认是否静音
    onFirstFrameDrawn?: (canvas: HTMLCanvasElement) => void; // 第一帧绘制完成回调
    processingProgress?: number; // 视频处理进度 (0-100)
}

const VideoPlayer: React.FC<IProps> = ({
    language,
    videoSrc,
    currentTime,
    currentFrame,
    fps,
    size,
    onTimeUpdate,
    onLoadedMetadata,
    onPlay,
    onPause,
    onPlayPause,
    isPlaying = false,
    defaultMuted = true, // 默认静音
    onFirstFrameDrawn,
    processingProgress = 0
}) => {
    const texts = LanguageConfig[language];
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const focusableElementRef = useRef<HTMLDivElement>(null); // 用于接收焦点的元素
    const [videoDuration, setVideoDuration] = useState(0);
    const [videoSize, setVideoSize] = useState<ISize>({ width: 0, height: 0 });
    const [isVideoLoaded, setIsVideoLoaded] = useState(false);
    const [isFpsDetecting, setIsFpsDetecting] = useState(false); // 帧率检测中
    const requestRef = useRef<number>();
    const [detectedFps, setDetectedFps] = useState<number>(fps || 60);
    const videoFrameCallbackIdRef = useRef<number>();
    const playPromiseRef = useRef<Promise<void> | null>(null); // 跟踪 play() Promise
    const [isVideoEnded, setIsVideoEnded] = useState(false); // 视频是否播放完毕
    const firstFrameDrawnRef = useRef<boolean>(false); // 跟踪第一帧是否已绘制

    // 监听视频源变化，重置所有状态
    useEffect(() => {
        console.log('[1] 视频源变化，重置所有状态');
        
        // 重置状态
        setIsVideoLoaded(false);
        setIsFpsDetecting(false);
        setVideoDuration(0);
        setVideoSize({ width: 0, height: 0 });
        setIsVideoEnded(false);
        firstFrameDrawnRef.current = false;
        
        // 清空 canvas
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }
        
        // 取消所有正在进行的回调
        const video = videoRef.current;
        if (video) {
            if (videoFrameCallbackIdRef.current !== undefined) {
                if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
                    (video as any).cancelVideoFrameCallback(videoFrameCallbackIdRef.current);
                }
                videoFrameCallbackIdRef.current = undefined;
            }
        }
        if (requestRef.current) {
            cancelAnimationFrame(requestRef.current);
            requestRef.current = undefined;
        }
    }, [videoSrc]);

    // 从视频元数据快速获取帧率
    const detectFrameRate = useCallback((video: HTMLVideoElement): Promise<number> => {
        return new Promise((resolve) => {
            if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
                setIsFpsDetecting(true);

                // 只需要 2 帧就能从 metadata 推算帧率
                let firstMediaTime: number | null = null;

                const callback = (now: number, metadata: any) => {
                    if (firstMediaTime === null) {
                        firstMediaTime = metadata.mediaTime;
                        (video as any).requestVideoFrameCallback(callback);
                    } else {
                        // 两帧时间差的倒数就是帧率
                        const frameDuration = metadata.mediaTime - firstMediaTime;
                        const detectedFps = frameDuration > 0 ? Math.round(1 / frameDuration) : 30;

                        video.pause();
                        video.currentTime = 0;
                        setIsFpsDetecting(false);
                        resolve(detectedFps);
                    }
                };

                video.currentTime = 0;
                video.play().then(() => {
                    (video as any).requestVideoFrameCallback(callback);
                }).catch((err) => {
                    if (err.name !== 'AbortError') {
                        console.error('帧率检测播放失败:', err);
                    }
                    setIsFpsDetecting(false);
                    resolve(30);
                });
            } else {
                resolve(30);
            }
        });
    }, []);

    // 在画布上绘制当前视频帧
    const drawFrame = useCallback(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || !isVideoLoaded) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 设置画布大小以匹配视频尺寸
        if (canvas.width !== videoSize.width || canvas.height !== videoSize.height) {
            canvas.width = videoSize.width;
            canvas.height = videoSize.height;
        }

        // 清空画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 绘制视频帧
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // 如果是第一帧绘制完成，触发回调
        if (!firstFrameDrawnRef.current && onFirstFrameDrawn) {
            firstFrameDrawnRef.current = true;
            // 使用 setTimeout 确保 Canvas 内容已完全绘制
            setTimeout(() => {
                onFirstFrameDrawn(canvas);
            }, 0);
        }
    }, [isVideoLoaded, videoSize, onFirstFrameDrawn]);

    // 处理视频元数据加载
    const handleLoadedMetadata = useCallback(async () => {
        const video = videoRef.current;
        if (!video) return;

        const duration = video.duration;
        const videoSizeData = {
            width: video.videoWidth,
            height: video.videoHeight
        };

        setVideoDuration(duration);
        setVideoSize(videoSizeData);

        // 自动检测帧率
        const realFps = await detectFrameRate(video);
        setDetectedFps(realFps);
        
        const totalFrames = Math.floor(duration * realFps); // 使用 floor 确保不超过视频实际可播放帧数
        setIsVideoLoaded(true);
        // 将 video 元素暴露给 EditorModel，供检测等功能全分辨率截帧
        EditorModel.videoElement = video;

        if (onLoadedMetadata) {
            onLoadedMetadata(duration, totalFrames, realFps, videoSizeData);
        }

        // 等待状态更新后绘制第一帧
        setTimeout(() => {
            drawFrame();
            // 自动将焦点设置到视频播放器容器，这样用户可以直接按空格键播放
            if (focusableElementRef.current) {
                focusableElementRef.current.focus();
            }
        }, 100);
    }, [detectFrameRate, onLoadedMetadata, drawFrame]);

    // 跳转到指定时间（保持至多一个 seeked 监听器）
    const pendingSeekedRef = useRef<(() => void) | null>(null);
    const seekToTime = useCallback((time: number) => {
        const video = videoRef.current;
        if (!video) return;

        // 移除之前未完成的 seeked 监听器
        if (pendingSeekedRef.current) {
            video.removeEventListener('seeked', pendingSeekedRef.current);
        }

        video.currentTime = time;

        const handleSeeked = () => {
            drawFrame();
            pendingSeekedRef.current = null;
        };
        pendingSeekedRef.current = handleSeeked;
        video.addEventListener('seeked', handleSeeked, { once: true });
    }, [drawFrame]);

    // 使用 requestVideoFrameCallback 实现精确的逐帧更新
    // 优化：先立即请求下一帧，然后再执行耗时操作，避免延迟累积
    const updateVideoFrame = useCallback(() => {
        const video = videoRef.current;
        if (!video || !onTimeUpdate) return;

        const currentTime = video.currentTime;
        const currentFrame = Math.floor(currentTime * detectedFps);
        
        // 关键优化：先立即请求下一帧，避免延迟累积
        // 如果视频还在播放，继续请求下一帧（必须在执行耗时操作之前）
        if (!video.paused && !video.ended) {
            if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
                videoFrameCallbackIdRef.current = (video as any).requestVideoFrameCallback(updateVideoFrame);
            } else {
                // 降级方案：使用 requestAnimationFrame
                requestRef.current = requestAnimationFrame(updateVideoFrame);
            }
        }
        
        // 然后执行耗时操作（Redux 更新、绘制）
        // 这些操作不会阻塞下一帧的请求
        onTimeUpdate(currentTime, currentFrame);
        drawFrame();
    }, [detectedFps, onTimeUpdate, drawFrame]);

    // 处理视频时间更新（仅用于暂停时的同步，播放时使用 requestVideoFrameCallback）
    const handleTimeUpdate = useCallback(() => {
        const video = videoRef.current;
        if (!video || !onTimeUpdate || isPlaying) return; // 播放时不使用 timeupdate

        const currentTime = video.currentTime;
        const currentFrame = Math.floor(currentTime * detectedFps);
        
        onTimeUpdate(currentTime, currentFrame);
        drawFrame();
    }, [detectedFps, onTimeUpdate, drawFrame, isPlaying]);

    // 播放控制 - 只有在视频加载完成且帧率检测完成后才允许播放
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !isVideoLoaded || isFpsDetecting) return undefined;

        const playVideo = async (): Promise<void> => {
            if (isPlaying) {
                try {
                    // 重置视频结束状态
                    if (isVideoEnded) {
                        video.currentTime = 0;
                        setIsVideoEnded(false);
                        hasEndedRef.current = false;
                        // 等待 seek 完成
                        await new Promise<void>((resolve) => {
                            const onSeeked = () => {
                                video.removeEventListener('seeked', onSeeked);
                                resolve();
                            };
                            video.addEventListener('seeked', onSeeked);
                            setTimeout(() => { video.removeEventListener('seeked', onSeeked); resolve(); }, 300);
                        });
                    }
                    
                    // 存储 play() Promise
                    const playPromise = video.play();
                    playPromiseRef.current = playPromise;
                    
                    await playPromise;
                    
                    // 确保播放成功后才启动逐帧更新
                    if (playPromiseRef.current === playPromise && isPlaying) {
                        // 注意：不在这里调用 onPlay()，因为播放操作是由父组件控制的
                        // 父组件通过设置 isPlaying prop 来控制播放状态
                        
                        updateVideoFrame();
                    }
                } catch (err: any) {
                    // 忽略 AbortError，这是正常的暂停行为
                    if (err.name !== 'AbortError') {
                        console.error('视频播放失败:', err);
                    }
                } finally {
                    playPromiseRef.current = null;
                }
            } else {
                // 等待之前的 play() Promise 完成
                if (playPromiseRef.current) {
                    try {
                        await playPromiseRef.current;
                    } catch (err) {
                        // 忽略错误
                    }
                }
                
                // 只有在视频实际播放时才调用 pause()
                if (!video.paused) {
                    video.pause();
                }
                
                // 取消逐帧更新循环
                if (videoFrameCallbackIdRef.current !== undefined) {
                    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
                        (video as any).cancelVideoFrameCallback(videoFrameCallbackIdRef.current);
                    }
                    videoFrameCallbackIdRef.current = undefined;
                }
                if (requestRef.current) {
                    cancelAnimationFrame(requestRef.current);
                    requestRef.current = undefined;
                }
                
                // 注意：不在这里调用 onPause()，因为暂停操作是由父组件控制的
                // 只在视频自然播放完毕时（handleVideoEnded）才调用 onPause()
            }
        };

        playVideo();

        // 清理函数
        return () => {
            if (videoFrameCallbackIdRef.current !== undefined) {
                if ('requestVideoFrameCallback' in HTMLVideoElement.prototype && video) {
                    (video as any).cancelVideoFrameCallback(videoFrameCallbackIdRef.current);
                }
            }
            if (requestRef.current) {
                cancelAnimationFrame(requestRef.current);
            }
        };
    }, [isPlaying, isVideoLoaded, isFpsDetecting, isVideoEnded, updateVideoFrame]);

    // 监听外部时间变化（仅在暂停时同步，避免播放时跳帧）
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !isVideoLoaded) return;

        // 只有在暂停状态下才同步外部时间变化
        // 播放状态下让视频自然播放，避免跳帧
        if (!isPlaying && Math.abs(video.currentTime - currentTime) > 0.1) {
            seekToTime(currentTime);
        }
    }, [currentTime, isVideoLoaded, isPlaying, seekToTime]);

    // 处理视频播放完毕
    const hasEndedRef = useRef<boolean>(false); // 防止重复触发
    const handleVideoEnded = useCallback(() => {
        // 防止重复触发
        if (hasEndedRef.current) {
            return;
        }
        hasEndedRef.current = true;

        const video = videoRef.current;

        // 立即取消所有帧回调，避免残留回调干扰状态
        if (video && videoFrameCallbackIdRef.current !== undefined) {
            if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
                (video as any).cancelVideoFrameCallback(videoFrameCallbackIdRef.current);
            }
            videoFrameCallbackIdRef.current = undefined;
        }
        if (requestRef.current) {
            cancelAnimationFrame(requestRef.current);
            requestRef.current = undefined;
        }

        setIsVideoEnded(true);

        // 通知父组件最终帧位置（确保时间轴指针到达末尾）
        if (video && onTimeUpdate) {
            const finalFrame = Math.floor(videoDuration * detectedFps) - 1;
            onTimeUpdate(videoDuration, Math.max(0, finalFrame));
            drawFrame();
        }

        // 通知父组件停止播放
        if (onPause) {
            onPause();
        }
    }, [onPause, onTimeUpdate, videoDuration, detectedFps, drawFrame]);

    // 键盘快捷键 - 空格键播放/暂停
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const video = videoRef.current;
            if (!video || !isVideoLoaded) return;

            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    e.stopPropagation();
                    // 统一走 onPlayPause，和 Timeline 按钮一致
                    onPlayPause?.();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isVideoLoaded, onPlayPause]);

    // 设置播放速率为1.0（正常速度）
    useEffect(() => {
        const video = videoRef.current;
        if (video) {
            video.playbackRate = 1.0;
        }
    }, []);

    // 控制视频静音状态
    useEffect(() => {
        const video = videoRef.current;
        if (video) {
            video.muted = defaultMuted;
        }
    }, [defaultMuted]);

    return (
        <div 
            className="VideoPlayer" 
            ref={containerRef} 
            style={size}
        >
            {/* 用于接收焦点的透明覆盖层 */}
            <div
                ref={focusableElementRef}
                tabIndex={0}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    outline: 'none', // 移除焦点时的轮廓
                    zIndex: 1
                }}
                aria-label={texts.video.playerAriaLabel}
            />
            <video
                ref={videoRef}
                src={videoSrc}
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleVideoEnded}
                style={{ display: 'none' }}
                preload="auto"
                muted={defaultMuted}
            />
            <canvas
                ref={canvasRef}
                className="VideoCanvas"
                style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain'
                }}
            />
            {(!isVideoLoaded || isFpsDetecting) && (
                <div className="LoadingOverlay">
                    <div className="LoadingSpinner"></div>
                    <p>{isFpsDetecting ? '正在解析处理视频...' : '加载视频中...'}</p>
                    {processingProgress > 0 && (
                        <div className="ProgressBar">
                            <div className="ProgressBarFill" style={{ width: `${processingProgress}%` }}></div>
                            <span className="ProgressText">{processingProgress}%</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default VideoPlayer;

