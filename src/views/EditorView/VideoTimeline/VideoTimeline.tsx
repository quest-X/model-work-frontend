import React, { useRef, useEffect, useState, useCallback } from 'react';
import './VideoTimeline.scss';
import { ISize } from '../../../interfaces/ISize';
import { Language, LanguageConfig } from '../../../data/LanguageConfig';
import { connect } from 'react-redux';
import { AppState } from '../../../store';

interface IProps {
    duration: number; // 视频总时长（秒）
    currentTime: number; // 当前播放时间（秒）
    frames: number; // 总帧数
    currentFrame: number; // 当前帧
    fps: number; // 帧率
    onSeek: (time: number) => void; // 拖动时间轴时的回调
    onFrameChange: (frame: number) => void; // 帧变化时的回调
    size?: ISize; // 时间轴大小
    isPlaying?: boolean; // 是否正在播放
    keyframes?: number[]; // 关键帧位置数组
    annotatedFrames?: number[]; // 已标注的帧数组
    onPlayPause?: () => void; // 播放/暂停回调
    isMuted?: boolean; // 是否静音
    onToggleMute?: () => void; // 切换静音回调
    language: Language;
}

const VideoTimeline: React.FC<IProps> = ({
    duration,
    currentTime,
    frames,
    currentFrame,
    fps,
    onSeek,
    onFrameChange,
    size,
    isPlaying = false,
    keyframes = [],
    annotatedFrames = [],
    onPlayPause,
    isMuted = true,
    onToggleMute,
    language
}) => {
    const texts = LanguageConfig[language];
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [hoverTime, setHoverTime] = useState<number | null>(null);

    // 绘制时间轴（纯 Redux prop 驱动，简单可靠）
    const drawTimeline = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        // 清空画布
        ctx.clearRect(0, 0, width, height);

        // 绘制背景
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, width, height);

        // 绘制刻度线
        const pixelsPerSecond = width / duration;
        
        // 动态计算时间标签间隔，避免文字重叠
        // 估计每个时间文字需要约40像素宽度
        const minLabelSpacing = 40; // 最小标签间距（像素）
        const minTimeInterval = minLabelSpacing / pixelsPerSecond; // 对应的最小时间间隔
        
        // 根据视频长度选择合适的标签间隔（秒）
        let labelInterval: number;
        if (minTimeInterval <= 5) {
            labelInterval = 5; // 短视频：每5秒
        } else if (minTimeInterval <= 10) {
            labelInterval = 10; // 中等视频：每10秒
        } else if (minTimeInterval <= 30) {
            labelInterval = 30; // 长视频：每30秒
        } else if (minTimeInterval <= 60) {
            labelInterval = 60; // 很长视频：每1分钟
        } else if (minTimeInterval <= 300) {
            labelInterval = 300; // 超长视频：每5分钟
        } else {
            labelInterval = 600; // 极长视频：每10分钟
        }
        
        // 小刻度间隔：标签间隔的1/5
        const tickInterval = Math.max(1, labelInterval / 5);
        
        ctx.strokeStyle = '#444';
        ctx.fillStyle = '#999';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';

        for (let i = 0; i <= duration; i += tickInterval) {
            const x = i * pixelsPerSecond;
            const isLabelTick = i % labelInterval === 0; // 是否显示标签
            const tickHeight = isLabelTick ? 15 : 8; // 有标签的刻度更长
            
            ctx.beginPath();
            ctx.moveTo(x, height - tickHeight);
            ctx.lineTo(x, height);
            ctx.stroke();

            // 只在标签位置显示时间文字
            if (isLabelTick) {
                const minutes = Math.floor(i / 60);
                const seconds = i % 60;
                const timeText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                ctx.fillText(timeText, x, height - 20);
            }
        }

        // 绘制已标注的帧（绿色标记）— 用帧比例直接算像素，不经浮点除法
        ctx.fillStyle = 'rgba(76, 175, 80, 0.5)';
        annotatedFrames.forEach(frame => {
            const x = frames > 1 ? (frame / (frames - 1)) * width : 0;
            ctx.fillRect(x - 1, 0, 2, height - 30);
        });

        // 绘制关键帧标记（黄色小菱形）— 同样用帧比例
        ctx.fillStyle = '#ffd700';
        keyframes.forEach(frame => {
            const x = frames > 1 ? (frame / (frames - 1)) * width : 0;
            const y = height - 35;
            
            ctx.beginPath();
            ctx.moveTo(x, y - 4);
            ctx.lineTo(x + 4, y);
            ctx.lineTo(x, y + 4);
            ctx.lineTo(x - 4, y);
            ctx.closePath();
            ctx.fill();
        });

        // 绘制播放进度条
        const displayFrame = currentFrame;
        const displayTime = currentTime;
        const progress = frames > 0 ? displayFrame / (frames - 1) : 0;
        const currentX = Math.min(progress * width, width);
        ctx.fillStyle = 'rgba(33, 150, 243, 0.3)';
        ctx.fillRect(0, 0, currentX, height - 30);

        // 绘制当前时间指针
        ctx.strokeStyle = '#2196f3';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(currentX, 0);
        ctx.lineTo(currentX, height);
        ctx.stroke();

        // 绘制指针底部的三角形（朝上）
        ctx.fillStyle = '#2196f3';
        ctx.beginPath();
        ctx.moveTo(currentX, height);           // 顶点在底部
        ctx.lineTo(currentX - 6, height - 10);  // 左上角
        ctx.lineTo(currentX + 6, height - 10);  // 右上角
        ctx.closePath();
        ctx.fill();

        // 如果鼠标悬停，显示悬停时间
        if (hoverTime !== null) {
            const hoverX = (hoverTime / duration) * width;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(hoverX, 0);
            ctx.lineTo(hoverX, height - 30);
            ctx.stroke();
            ctx.setLineDash([]);

            // 显示悬停时间文本
            const hoverMinutes = Math.floor(hoverTime / 60);
            const hoverSeconds = Math.floor(hoverTime % 60);
            const hoverFrame = Math.min(Math.round(hoverTime * fps), frames - 1);
            const hoverText = `${hoverMinutes}:${hoverSeconds.toString().padStart(2, '0')} (Frame ${hoverFrame})`;
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(hoverX - 60, 15, 120, 20);
            ctx.fillStyle = '#fff';
            ctx.font = '11px sans-serif';
            ctx.fillText(hoverText, hoverX, 28);
        }

        // 绘制右上角时间信息（替换原来的Frame显示）
        ctx.fillStyle = '#fff';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'right';
        const currentMinutes = Math.floor(displayTime / 60);
        const currentSeconds = Math.floor(displayTime % 60);
        const timeText = `${currentMinutes}:${currentSeconds.toString().padStart(2, '0')} / ${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}`;
        ctx.fillText(timeText, width - 10, 20);

    }, [duration, currentTime, frames, currentFrame, fps, hoverTime, keyframes, annotatedFrames]);

    // 处理鼠标按下
    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        setIsDragging(true);
        handleSeek(e);
    };

    // 处理拖动
    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const time = (x / rect.width) * duration;
        setHoverTime(Math.max(0, Math.min(duration, time)));

        if (isDragging) {
            handleSeek(e);
        }
    };

    // 处理鼠标抬起
    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // 处理鼠标离开
    const handleMouseLeave = () => {
        setIsDragging(false);
        setHoverTime(null);
    };

    // 处理时间跳转
    const handleSeek = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const time = (x / rect.width) * duration;
        const clampedTime = Math.max(0, Math.min(duration, time));
        
        onSeek(clampedTime);
        
        const frame = Math.min(Math.round(clampedTime * fps), frames - 1);
        onFrameChange(frame);
    };

    // 键盘快捷键
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return; // 忽略输入框中的按键
            }

            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    // 后退1帧
                    const prevFrame = Math.max(0, currentFrame - 1);
                    onFrameChange(prevFrame);
                    onSeek(prevFrame / fps);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    // 前进1帧
                    const nextFrame = Math.min(frames - 1, currentFrame + 1);
                    onFrameChange(nextFrame);
                    onSeek(nextFrame / fps);
                    break;
                case 'a':
                case 'A':
                case ',':
                    e.preventDefault();
                    // 后退10帧
                    const prevFrame10 = Math.max(0, currentFrame - 10);
                    onFrameChange(prevFrame10);
                    onSeek(prevFrame10 / fps);
                    break;
                case 'd':
                case 'D':
                case '.':
                    e.preventDefault();
                    // 前进10帧
                    const nextFrame10 = Math.min(frames - 1, currentFrame + 10);
                    onFrameChange(nextFrame10);
                    onSeek(nextFrame10 / fps);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentFrame, frames, fps, onFrameChange, onSeek]);

    // 重绘时间轴
    useEffect(() => {
        drawTimeline();
    }, [drawTimeline]);

    // 设置画布大小
    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const updateSize = () => {
            const rect = container.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = size?.height || 60;
            drawTimeline();
        };

        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, [size, drawTimeline]);

    return (
        <div className="VideoTimeline" ref={containerRef}>
            <canvas
                ref={canvasRef}
                className="TimelineCanvas"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
            />
            <div className="TimelineControls">
                <div className="LeftInfo">
                    <span>FPS: {fps}</span>
                    <span>{texts.video.frame + ': '}{currentFrame + 1} / {frames}</span>
                </div>
                
                {/* 播放和静音按钮 - 居中显示 */}
                <div className="CenterControls">
                    {onPlayPause && (
                        <button onClick={onPlayPause} className="PlayPauseButton">
                            {isPlaying
                                ? '⏸ ' + texts.video.pause
                                : currentFrame >= frames - 1
                                    ? '↺ ' + texts.video.replay
                                    : '▶ ' + texts.video.play}
                        </button>
                    )}
                    {onToggleMute && (
                        <button 
                            onClick={onToggleMute} 
                            className="MuteButton"
                            title={isMuted ? texts.video.unmute : texts.video.mute}
                            aria-label={isMuted ? texts.video.unmute : texts.video.mute}
                        >
                            {isMuted ? (
                                // 静音图标
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M16.5 12C16.5 10.23 15.48 8.71 14 7.97V10.18L16.45 12.63C16.48 12.43 16.5 12.22 16.5 12Z" fill="currentColor"/>
                                    <path d="M19 12C19 12.94 18.8 13.82 18.46 14.64L19.97 16.15C20.63 14.91 21 13.5 21 12C21 7.72 18.01 4.14 14 3.23V5.29C16.89 6.15 19 8.83 19 12Z" fill="currentColor"/>
                                    <path d="M4.27 3L3 4.27L7.73 9H3V15H7L12 20V13.27L16.25 17.52C15.58 18.04 14.83 18.45 14 18.7V20.76C15.38 20.45 16.63 19.81 17.69 18.95L19.73 21L21 19.73L12 10.73L4.27 3ZM12 4L9.91 6.09L12 8.18V4Z" fill="currentColor"/>
                                </svg>
                            ) : (
                                // 音量图标
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M3 9V15H7L12 20V4L7 9H3Z" fill="currentColor"/>
                                    <path d="M16.5 12C16.5 10.23 15.48 8.71 14 7.97V16.03C15.48 15.29 16.5 13.77 16.5 12Z" fill="currentColor"/>
                                    <path d="M14 3.23V5.29C16.89 6.15 19 8.83 19 12C19 15.17 16.89 17.85 14 18.71V20.77C18.01 19.86 21 16.28 21 12C21 7.72 18.01 4.14 14 3.23Z" fill="currentColor"/>
                                </svg>
                            )}
                        </button>
                    )}
                </div>
                
                <div className="RightInfo">
                    <div className="HelpText">
                        <span>{texts.video.shortcutMove1}</span>
                        <span>{texts.video.shortcutPlayPause}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(mapStateToProps)(VideoTimeline);

