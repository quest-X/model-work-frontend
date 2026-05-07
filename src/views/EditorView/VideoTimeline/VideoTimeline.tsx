import React, { useRef, useEffect, useState, useCallback } from 'react';
import './VideoTimeline.scss';
import { ISize } from '../../../interfaces/ISize';
import { Language, LanguageConfig } from '../../../data/LanguageConfig';
import { connect } from 'react-redux';
import { AppState } from '../../../store';

/** 选区范围（帧号，闭区间） */
export interface FrameRange {
    startFrame: number;
    endFrame: number;
}

/**
 * 全局可读的当前选区范围。EditorTopNavigationBar 读此值决定推理按钮文案。
 * 更新时 dispatch 'timelineRangeChange' CustomEvent 让订阅者 re-render。
 */
let _currentRange: FrameRange | null = null;
export function getTimelineRange(): FrameRange | null { return _currentRange; }
function setGlobalRange(r: FrameRange | null) {
    _currentRange = r;
    window.dispatchEvent(new CustomEvent('timelineRangeChange', { detail: r }));
}

interface IProps {
    duration: number; // 视频总时长（秒）
    currentTime: number; // 当前播放时间（秒）
    frames: number; // 总帧数
    currentFrame: number; // 当前帧
    fps: number; // 帧率
    onFrameChange: (frame: number) => void; // 跳转到指定帧（point/drag/键盘统一入口）
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
    onFrameChange,
    size,
    isPlaying = false,
    keyframes = [],
    annotatedFrames = [],
    onPlayPause,
    isMuted = true,
    onToggleMute,
    language,
}) => {
    const texts = LanguageConfig[language];
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [hoverTime, setHoverTime] = useState<number | null>(null);

    // ===== Shift+拖拽范围选区 =====
    const [selectionRange, setSelectionRange] = useState<FrameRange | null>(null);
    const [isRangeSelecting, setIsRangeSelecting] = useState(false);
    const rangeAnchorRef = useRef<number | null>(null); // 选区锚点帧

    /** 像素 → 帧号 */
    const xToFrame = useCallback((clientX: number): number => {
        const canvas = canvasRef.current;
        if (!canvas) return 0;
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const ratio = Math.max(0, Math.min(1, x / rect.width));
        return Math.min(Math.round(ratio * (frames - 1)), frames - 1);
    }, [frames]);

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

        // ===== 绘制选区高亮 =====
        if (selectionRange) {
            const x1 = frames > 1 ? (selectionRange.startFrame / (frames - 1)) * width : 0;
            const x2 = frames > 1 ? (selectionRange.endFrame / (frames - 1)) * width : width;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.fillRect(x1, 0, x2 - x1, height - 30);
            // 选区边界线
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(x1, 0); ctx.lineTo(x1, height - 30);
            ctx.moveTo(x2, 0); ctx.lineTo(x2, height - 30);
            ctx.stroke();
        }

        // 绘制刻度线
        const pixelsPerSecond = width / duration;

        // 动态计算时间标签间隔，避免文字重叠
        const minLabelSpacing = 40;
        const minTimeInterval = minLabelSpacing / pixelsPerSecond;

        let labelInterval: number;
        if (minTimeInterval <= 5) {
            labelInterval = 5;
        } else if (minTimeInterval <= 10) {
            labelInterval = 10;
        } else if (minTimeInterval <= 30) {
            labelInterval = 30;
        } else if (minTimeInterval <= 60) {
            labelInterval = 60;
        } else if (minTimeInterval <= 300) {
            labelInterval = 300;
        } else {
            labelInterval = 600;
        }

        const tickInterval = Math.max(1, labelInterval / 5);

        ctx.strokeStyle = '#444';
        ctx.fillStyle = '#999';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';

        for (let i = 0; i <= duration; i += tickInterval) {
            const x = i * pixelsPerSecond;
            const isLabelTick = i % labelInterval === 0;
            const tickHeight = isLabelTick ? 15 : 8;

            ctx.beginPath();
            ctx.moveTo(x, height - tickHeight);
            ctx.lineTo(x, height);
            ctx.stroke();

            if (isLabelTick) {
                const minutes = Math.floor(i / 60);
                const seconds = i % 60;
                const timeText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                ctx.fillText(timeText, x, height - 20);
            }
        }

        // 绘制已标注的帧（绿色标记）
        ctx.fillStyle = 'rgba(76, 175, 80, 0.5)';
        annotatedFrames.forEach(frame => {
            const x = frames > 1 ? (frame / (frames - 1)) * width : 0;
            ctx.fillRect(x - 1, 0, 2, height - 30);
        });

        // 绘制关键帧标记（黄色小菱形）
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
        ctx.moveTo(currentX, height);
        ctx.lineTo(currentX - 6, height - 10);
        ctx.lineTo(currentX + 6, height - 10);
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

        // 绘制右上角时间信息
        ctx.fillStyle = '#fff';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'right';
        const currentMinutes = Math.floor(displayTime / 60);
        const currentSeconds = Math.floor(displayTime % 60);
        const timeText = `${currentMinutes}:${currentSeconds.toString().padStart(2, '0')} / ${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}`;
        ctx.fillText(timeText, width - 10, 20);

    }, [duration, currentTime, frames, currentFrame, fps, hoverTime, keyframes, annotatedFrames, selectionRange]);

    // ===== 鼠标事件 =====

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (e.shiftKey) {
            // Shift+mousedown：开始范围选区
            const frame = xToFrame(e.clientX);
            rangeAnchorRef.current = frame;
            setIsRangeSelecting(true);
            setSelectionRange({ startFrame: frame, endFrame: frame });
            return; // 不触发 seek
        }
        setIsDragging(true);
        handleSeek(e);
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const time = (x / rect.width) * duration;
        setHoverTime(Math.max(0, Math.min(duration, time)));

        if (isRangeSelecting && rangeAnchorRef.current !== null) {
            const frame = xToFrame(e.clientX);
            const anchor = rangeAnchorRef.current;
            setSelectionRange({
                startFrame: Math.min(anchor, frame),
                endFrame: Math.max(anchor, frame),
            });
            return;
        }

        if (isDragging) {
            handleSeek(e);
        }
    };

    const handleMouseUp = () => {
        if (isRangeSelecting) {
            setIsRangeSelecting(false);
            rangeAnchorRef.current = null;
            // 选区太小（<2帧）时清除
            if (selectionRange && selectionRange.endFrame - selectionRange.startFrame < 2) {
                setSelectionRange(null);
            }
            return;
        }
        setIsDragging(false);
    };

    const handleMouseLeave = () => {
        if (isRangeSelecting) {
            setIsRangeSelecting(false);
            rangeAnchorRef.current = null;
        }
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
        const frame = Math.min(Math.round(clampedTime * fps), frames - 1);
        if (frame === currentFrame) return;
        onFrameChange(frame);
    };

    // 键盘快捷键
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            // Esc 清除选区
            if (e.key === 'Escape' && selectionRange) {
                e.preventDefault();
                setSelectionRange(null);
                return;
            }

            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    onFrameChange(Math.max(0, currentFrame - 1));
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    onFrameChange(Math.min(frames - 1, currentFrame + 1));
                    break;
                case 'a':
                case 'A':
                case ',':
                    e.preventDefault();
                    onFrameChange(Math.max(0, currentFrame - 10));
                    break;
                case 'd':
                case 'D':
                case '.':
                    e.preventDefault();
                    onFrameChange(Math.min(frames - 1, currentFrame + 10));
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentFrame, frames, fps, onFrameChange, selectionRange]);

    // 同步选区到全局，让 EditorTopNavigationBar 的推理按钮能读到
    useEffect(() => {
        setGlobalRange(selectionRange);
        return () => { setGlobalRange(null); }; // 卸载时清除
    }, [selectionRange]);

    // 重绘时间轴
    useEffect(() => {
        drawTimeline();
    }, [drawTimeline]);

    // 设置画布大小
    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return undefined;

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
                    <span>{language === 'zh' ? '帧率' : 'FPS'}: {fps}</span>
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
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M16.5 12C16.5 10.23 15.48 8.71 14 7.97V10.18L16.45 12.63C16.48 12.43 16.5 12.22 16.5 12Z" fill="currentColor"/>
                                    <path d="M19 12C19 12.94 18.8 13.82 18.46 14.64L19.97 16.15C20.63 14.91 21 13.5 21 12C21 7.72 18.01 4.14 14 3.23V5.29C16.89 6.15 19 8.83 19 12Z" fill="currentColor"/>
                                    <path d="M4.27 3L3 4.27L7.73 9H3V15H7L12 20V13.27L16.25 17.52C15.58 18.04 14.83 18.45 14 18.7V20.76C15.38 20.45 16.63 19.81 17.69 18.95L19.73 21L21 19.73L12 10.73L4.27 3ZM12 4L9.91 6.09L12 8.18V4Z" fill="currentColor"/>
                                </svg>
                            ) : (
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
