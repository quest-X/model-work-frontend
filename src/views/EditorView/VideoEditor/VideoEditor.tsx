import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { connect } from 'react-redux';
import './VideoEditor.scss';
import VideoPlayer from '../VideoPlayer/VideoPlayer';
import FramePlayer from '../FramePlayer/FramePlayer';
import VideoTimeline from '../VideoTimeline/VideoTimeline';
import Editor from '../Editor/Editor';
import { AppState } from '../../../store';
import { VideoData } from '../../../store/video/types';
import { ImageData } from '../../../store/labels/types';
import { ISize } from '../../../interfaces/ISize';
import {
    updateVideoCurrentFrame,
    updateVideoPlayingStatus,
    updateVideoMetadata
} from '../../../store/video/actionCreators';
import { updateImageDataById, updateActiveImageIndex, addImageData, toggleImageSelection } from '../../../store/labels/actionCreators';
import { ImageDataUtil } from '../../../utils/ImageDataUtil';
import { ImageRepository } from '../../../logic/imageRepository/ImageRepository';
import { EditorActions } from '../../../logic/actions/EditorActions';
import { EditorModel } from '../../../staticModels/EditorModel';
import { Language } from '../../../data/LanguageConfig';

interface IProps {
    activeVideo: VideoData | null;
    imagesData: ImageData[];
    activeImageIndex: number;
    language: Language;
    editorSize: ISize;
    updateVideoCurrentFrame: (videoId: string, frameNumber: number, timestamp: number) => void;
    updateVideoPlayingStatus: (videoId: string, isPlaying: boolean) => void;
    updateVideoMetadata: (videoId: string, duration: number, fps: number, totalFrames: number, videoSize: ISize) => void;
    updateImageDataById: (id: string, newImageData: ImageData) => void;
    updateActiveImageIndex: (index: number) => void;
    addImageData: (imageData: ImageData[]) => void;
    toggleImageSelection: (imageId: string) => void;
}

const VideoEditor: React.FC<IProps> = ({
    activeVideo,
    imagesData,
    activeImageIndex,
    language,
    editorSize,
    updateVideoCurrentFrame,
    updateVideoPlayingStatus,
    updateVideoMetadata,
    updateImageDataById,
    updateActiveImageIndex,
    addImageData,
    toggleImageSelection
}) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [videoUrl, setVideoUrl] = useState<string>('');
    const [loadedThumbnailCount, setLoadedThumbnailCount] = useState(0);
    const [totalFrameCount, setTotalFrameCount] = useState(0);
    const [isMuted, setIsMuted] = useState<boolean>(true);
    const generationIdRef = React.useRef(0);

    // 使用 ref 存储最新的 imagesData，避免在 useCallback 依赖中包含它
    // 重要：必须在渲染期间同步更新（不能用 useEffect），
    // 否则 batchApplyResults dispatch 后第一次播放回调读到的是旧数组
    const imagesDataRef = React.useRef<ImageData[]>(imagesData);
    imagesDataRef.current = imagesData;

    // Ref 模式：存储播放回调中频繁变化的值，使 handleVideoTimeUpdate 的身份稳定。
    // activeVideo 每帧通过 Redux 创建新对象，如果放在 useCallback deps 中会导致
    // handleVideoTimeUpdate 每帧重建 ~30次/秒。用 ref 读取则无此问题。
    const activeVideoRef = React.useRef(activeVideo);
    activeVideoRef.current = activeVideo;
    const activeImageIndexRef = React.useRef(activeImageIndex);
    activeImageIndexRef.current = activeImageIndex;
    const isPlayingRef = React.useRef(isPlaying);
    isPlayingRef.current = isPlaying;

    // 初始化视频URL — only needed in raw_browser_mode (no pre-extracted frames)
    useEffect(() => {
        if (activeVideo?.fileData && !activeVideo.preExtractedFrames) {
            // 递增 generation ID，取消所有进���中的缩略图生成
            generationIdRef.current++;
            const url = URL.createObjectURL(activeVideo.fileData);
            setVideoUrl(url);
            return () => {
                const currentImagesData = imagesDataRef.current;
                // 仅在 repository ���被清空时保存缓存��避免覆盖 QueueActions 已保存的有效缓存）
                if (activeVideo.id && currentImagesData.length > 0) {
                    const firstImg = currentImagesData[0];
                    if (firstImg && ImageRepository.getById(firstImg.id)) {
                        ImageRepository.saveFileCache(activeVideo.id, currentImagesData);
                    }
                }

                URL.revokeObjectURL(url);
                EditorModel.videoFrameImage = null;
                EditorModel.playbackImageData = null;
                generationIdRef.current++;
            };
        }
        // fast_ffmpeg_mode (pre-extracted frames present): cleanup effect
        if (activeVideo?.preExtractedFrames) {
            generationIdRef.current++;
            return () => {
                const currentImagesData = imagesDataRef.current;
                if (activeVideo.id && currentImagesData.length > 0) {
                    const firstImg = currentImagesData[0];
                    if (firstImg && ImageRepository.getById(firstImg.id)) {
                        ImageRepository.saveFileCache(activeVideo.id, currentImagesData);
                    }
                }
                EditorModel.videoFrameImage = null;
                EditorModel.playbackImageData = null;
                generationIdRef.current++;
            };
        }
        return undefined;
    }, [activeVideo?.fileData, activeVideo?.id, activeVideo?.preExtractedFrames]);
    
    // 确保视频加载后第一帧被选中（如果 activeImageIndex 为 null 或无效）
    useEffect(() => {
        if (activeVideo && imagesData.length > 0) {
            // 如果 activeImageIndex 为 null 或无效，设置为 0（第一帧）
            if (activeImageIndex === null || activeImageIndex < 0 || activeImageIndex >= imagesData.length) {
                updateActiveImageIndex(0);
                updateVideoCurrentFrame(activeVideo.id, 0, 0);
            }
        }
    }, [activeVideo, imagesData.length, activeImageIndex, updateActiveImageIndex, updateVideoCurrentFrame]);

    // 确保当前帧的图像和标注数据始终同步
    // 关键：playbackImageData 必须始终指向 currentFrame 对应的 imageData，
    // 这样渲染引擎无论在播放还是暂停 seek 时都能读到正确帧的标签
    const lastFrameForImageRef = React.useRef<number>(-1);
    const lastIsPlayingRef = React.useRef<boolean>(false);
    useEffect(() => {
        if (activeVideo && imagesData.length > 0) {
            // 始终同步 playbackImageData 到当前帧
            const frameData = imagesData[activeVideo.currentFrame];
            EditorModel.playbackImageData = frameData || null;

            const frameChanged = activeVideo.currentFrame !== lastFrameForImageRef.current;
            const playStateChanged = isPlaying !== lastIsPlayingRef.current;
            // 暂停 → 播放 或 播放 → 暂停 时，必须重绘 Editor canvas
            // （因为 VideoPrimaryRenderEngine 在播放时跳过 drawImage，暂停时才绘制）
            const needsRedraw = frameChanged || playStateChanged;

            if (needsRedraw) {
                lastFrameForImageRef.current = activeVideo.currentFrame;
                lastIsPlayingRef.current = isPlaying;

                // 视频模式：始终使用缓存的 videoFrameImage，避免用 150x150 缩略图
                if (EditorModel.videoFrameImage) {
                    EditorActions.setActiveImage(EditorModel.videoFrameImage);
                } else {
                    const currentImageData = imagesData[activeVideo.currentFrame];
                    if (currentImageData && currentImageData.id) {
                        const image = ImageRepository.getById(currentImageData.id);
                        if (image) {
                            EditorActions.setActiveImage(image);
                        }
                    }
                }

                // [DBG-END] 追踪暂停瞬间 VideoEditor effect 设置的图像
                if (!isPlaying && frameChanged) {
                    const vfi = EditorModel.videoFrameImage;
                    const em = EditorModel.image;
                    console.log('[DBG-END] VideoEditor frame-sync (post-pause)', {
                        currentFrame: activeVideo.currentFrame,
                        videoFrameImageSrcPrefix: vfi?.src?.slice(0, 80),
                        videoFrameImageWH: vfi ? `${vfi.naturalWidth}x${vfi.naturalHeight}` : 'null',
                        editorModelImageSrcPrefix: em?.src?.slice(0, 80),
                        editorModelImageWH: em ? `${em.naturalWidth}x${em.naturalHeight}` : 'null'
                    });
                }

                // canvas 可能还未挂载，仅在已挂载时刷新
                if (EditorModel.canvas) {
                    EditorActions.fullRender();
                }
            }
        }
    }, [activeVideo?.currentFrame, imagesData, isPlaying]);

    // 监听 activeImageIndex 变化，实现点击缩略图跳转到对应帧
    // 注意：只有在非播放状态下才执行跳转，避免播放时不断暂停
    useEffect(() => {
        if (!activeVideo || imagesData.length === 0) return;
        
        // 如果正在播放，说明是播放时的正常帧更新，不应该触发跳转
        // 只有在暂停状态下，activeImageIndex 的变化才可能是用户点击缩略图
        if (isPlaying) {
            return;
        }
        
        // 当用户点击缩略图时，activeImageIndex 会变化
        // 如果 activeImageIndex 与当前帧不一致，说明用户点击了其他帧的缩略图
        if (activeImageIndex !== null && activeImageIndex !== activeVideo.currentFrame) {
            // 计算目标帧对应的时间戳
            const targetTime = activeImageIndex / activeVideo.fps;
            
            // 更新视频当前帧和时间（这会触发视频播放器跳转）
            updateVideoCurrentFrame(activeVideo.id, activeImageIndex, targetTime);
        }
    }, [activeImageIndex, activeVideo, imagesData.length, isPlaying, updateVideoCurrentFrame]);

    // 缩略图缓冲区：ImageData 未就绪时暂存，就绪后刷入
    const pendingThumbnailsRef = React.useRef<Map<number, HTMLImageElement>>(new Map());

    // fast_ffmpeg_mode: FramePlayer frame-ready callback — stores thumbnail + updates ImageData
    const applyThumbnail = useCallback((frameIdx: number, thumbnailImage: HTMLImageElement): boolean => {
        const currentImagesData = imagesDataRef.current;
        if (frameIdx >= currentImagesData.length) return false;
        const imageData = currentImagesData[frameIdx];
        if (!imageData || imageData.loadStatus) return true; // 已加载，视为成功
        ImageRepository.storeImage(imageData.id, thumbnailImage);
        const updated = { ...imageData, loadStatus: true };
        currentImagesData[frameIdx] = updated;
        updateImageDataById(imageData.id, updated);
        setLoadedThumbnailCount(prev => Math.max(prev, frameIdx + 1));
        return true;
    }, [updateImageDataById]);

    const handleFrameReady = useCallback((frameIdx: number, thumbnailImage: HTMLImageElement) => {
        if (!applyThumbnail(frameIdx, thumbnailImage)) {
            // ImageData 还没创建，缓冲起来
            pendingThumbnailsRef.current.set(frameIdx, thumbnailImage);
        }
    }, [applyThumbnail]);

    // ImageData 就绪后，刷入缓冲区
    useEffect(() => {
        const pending = pendingThumbnailsRef.current;
        if (imagesData.length === 0 || pending.size === 0) return;
        for (const [frameIdx, thumb] of pending) {
            applyThumbnail(frameIdx, thumb);
        }
        console.log(`[VideoEditor] 刷入 ${pending.size} 个缓冲缩略图`);
        pending.clear();
    }, [imagesData.length, applyThumbnail]);


    // 处理第一帧绘制完成 - 生成缩略图 + 全分辨率图像
    const handleFirstFrameDrawn = useCallback(
        (canvas: HTMLCanvasElement) => {
            const currentImagesData = imagesDataRef.current;
            if (!activeVideo || currentImagesData.length === 0) return;

            const firstFrameImageData = currentImagesData[0];
            if (!firstFrameImageData) return;

            // 生成全分辨率图像给 Editor 渲染引擎使用（坐标系必须匹配视频分辨率）
            // 同时缓存到 EditorModel.videoFrameImage，播放时复用避免重复创建
            const setFullResImage = () => {
                // 如果已有缓存且尺寸匹配，直接复用
                const targetW = activeVideo.videoSize.width || canvas.width;
                const targetH = activeVideo.videoSize.height || canvas.height;
                if (EditorModel.videoFrameImage &&
                    EditorModel.videoFrameImage.naturalWidth === targetW &&
                    EditorModel.videoFrameImage.naturalHeight === targetH) {
                    EditorActions.setActiveImage(EditorModel.videoFrameImage);
                    return;
                }
                const fullCanvas = document.createElement('canvas');
                fullCanvas.width = targetW;
                fullCanvas.height = targetH;
                const fullCtx = fullCanvas.getContext('2d');
                fullCtx.drawImage(canvas, 0, 0, fullCanvas.width, fullCanvas.height);
                const fullDataUrl = fullCanvas.toDataURL('image/jpeg', 0.9);
                const fullImage = new Image();
                fullImage.onload = () => {
                    EditorModel.videoFrameImage = fullImage;
                    EditorActions.setActiveImage(fullImage);
                };
                fullImage.src = fullDataUrl;
            };

            if (firstFrameImageData.loadStatus) {
                // 已缓存，直接设置全分辨率图像
                setFullResImage();
                return;
            }

            // 生成缩略图给 ImagePreview 用（150x150）
            const thumbnailSize = 150;
            const thumbnailCanvas = document.createElement('canvas');
            thumbnailCanvas.width = thumbnailSize;
            thumbnailCanvas.height = thumbnailSize;
            const thumbnailCtx = thumbnailCanvas.getContext('2d');

            if (thumbnailCtx && activeVideo.videoSize.width > 0 && activeVideo.videoSize.height > 0) {
                const scale = Math.min(
                    thumbnailSize / activeVideo.videoSize.width,
                    thumbnailSize / activeVideo.videoSize.height
                );
                const scaledWidth = activeVideo.videoSize.width * scale;
                const scaledHeight = activeVideo.videoSize.height * scale;
                const offsetX = (thumbnailSize - scaledWidth) / 2;
                const offsetY = (thumbnailSize - scaledHeight) / 2;

                thumbnailCtx.fillStyle = '#000';
                thumbnailCtx.fillRect(0, 0, thumbnailSize, thumbnailSize);
                thumbnailCtx.drawImage(canvas, offsetX, offsetY, scaledWidth, scaledHeight);

                const thumbnailDataUrl = thumbnailCanvas.toDataURL('image/jpeg', 0.5);
                const thumbnailImage = new Image();
                thumbnailImage.onload = () => {
                    // 缩略图存入 ImageRepository（给 ImagePreview 用）
                    ImageRepository.storeImage(firstFrameImageData.id, thumbnailImage);
                    const updatedImageData = { ...firstFrameImageData, loadStatus: true };
                    updateImageDataById(updatedImageData.id, updatedImageData);
                    // 全分辨率图像给 Editor 渲染引擎
                    setFullResImage();
                };
                thumbnailImage.onerror = () => {
                    const updatedImageData = { ...firstFrameImageData, loadStatus: true };
                    updateImageDataById(updatedImageData.id, updatedImageData);
                };
                thumbnailImage.src = thumbnailDataUrl;
            } else {
                const updatedImageData = { ...firstFrameImageData, loadStatus: true };
                updateImageDataById(updatedImageData.id, updatedImageData);
            }
        },
        [activeVideo, updateImageDataById]
    );

    // 处理视频元数据加载
    // 注意：通过 imagesDataRef 访问 imagesData，避免将 imagesData 放入依赖数组导致无限循环
    const metadataLoadedLockRef = React.useRef(false);
    const handleVideoMetadataLoaded = useCallback(
        async (duration: number, frames: number, fps: number, videoSize: ISize) => {
            if (!activeVideo) return;

            // 防止重入：此函数会修改 Redux state，可能间接导致重新触发
            if (metadataLoadedLockRef.current) return;
            metadataLoadedLockRef.current = true;

            try {
                updateVideoMetadata(activeVideo.id, duration, fps, frames, videoSize);

                const currentImagesData = imagesDataRef.current;

                // ========== 检查是否已经有缓存的 imagesData ==========
                const cachedFileId = ImageRepository.getActiveFileId();
                if (currentImagesData.length > 0 && currentImagesData.length === frames && cachedFileId === activeVideo.id) {
                    const loadedCount = currentImagesData.filter(img => img.loadStatus).length;
                    const loadedPercentage = (loadedCount / frames) * 100;

                    console.log(`[VideoEditor] 7. 检测到 ImageData 缓存，共 ${currentImagesData.length} 帧，已加载 ${loadedCount} 帧 (${loadedPercentage.toFixed(1)}%)`);

                    if (loadedCount > frames * 0.5) {
                        console.log(`[VideoEditor] 8. 缓存有效（${loadedPercentage.toFixed(1)}% 已加载），跳过重新生成`);
                        updateActiveImageIndex(0);
                        updateVideoCurrentFrame(activeVideo.id, 0, 0);
                        setLoadedThumbnailCount(loadedCount);
                        setTotalFrameCount(frames);
                        return;
                    } else {
                        console.log(`[VideoEditor] 9. 缓存无效（仅 ${loadedPercentage.toFixed(1)}% 已加载），将重新生成所有缩略图`);
                    }
                }

                // ========== 如果没有缓存或缓存无效，执行生成逻辑 ==========
                const needsRegeneration = currentImagesData.length === 0 ||
                                          (currentImagesData.length === frames && currentImagesData.filter(img => img.loadStatus).length <= frames * 0.5);

                if (needsRegeneration) {
                    const hasExistingData = currentImagesData.length === frames;
                    console.log(`[VideoEditor] ${hasExistingData ? '缓存无效' : '首次加载'}，共 ${frames} 帧`);
                    setTotalFrameCount(frames);

                    let frameImageDataArray: ImageData[] = [];

                    if (hasExistingData) {
                        frameImageDataArray = currentImagesData.map(img => ({
                            ...img,
                            loadStatus: false
                        }));
                        frameImageDataArray.forEach(img => {
                            updateImageDataById(img.id, img);
                        });
                    } else {
                        for (let i = 0; i < frames; i++) {
                            const frameImageData = ImageDataUtil.createImageDataFromFileData(activeVideo.fileData);
                            frameImageData.loadStatus = false;
                            if (i === 0) {
                                frameImageData.isSelected = true;
                            }
                            frameImageDataArray.push(frameImageData);
                        }
                        addImageData(frameImageDataArray);
                    }

                    console.log(`[VideoEditor] ImageData 准备完成: ${frameImageDataArray.length} 帧`);

                    if (frameImageDataArray.length > 0) {
                        const firstFrameImageData = frameImageDataArray[0];

                        if (!hasExistingData && !firstFrameImageData.isSelected) {
                            const updatedFirstFrame = { ...firstFrameImageData, isSelected: true };
                            updateImageDataById(firstFrameImageData.id, updatedFirstFrame);
                        }

                        setTimeout(() => {
                            updateVideoCurrentFrame(activeVideo.id, 0, 0);
                            updateActiveImageIndex(0);
                        }, 0);
                    }

                    // Thumbnails are generated by FramePlayer.onFrameReady in fast_ffmpeg_mode; no standalone generation needed here
                }
            } finally {
                metadataLoadedLockRef.current = false;
            }
        },
        [activeVideo, updateVideoMetadata, addImageData, updateVideoCurrentFrame, updateActiveImageIndex, updateImageDataById]
    );

    // 跳转到指定帧的统一入口：time 从 frame 推导，避免双 dispatch 互相踩踏
    // 使用场景：时间轴点击/拖动、方向键快捷键、缩略图点击
    const handleFrameChange = useCallback(
        (frameNumber: number) => {
            if (!activeVideo) return;
            // 同帧跳过，不触发 Redux 更新和 effect 级联
            if (frameNumber === activeVideo.currentFrame) return;
            const timestamp = frameNumber / activeVideo.fps;
            // 同步设置 playbackImageData，确保标签与帧一致（fallback 到 latestImagesData 以抗 AI 批量推理时的 ref 滞后）
            let frameImageData = imagesDataRef.current[frameNumber];
            if (frameImageData && frameImageData.labelRects.length === 0 && EditorModel.latestImagesData) {
                const latestData = EditorModel.latestImagesData[frameNumber];
                if (latestData && latestData.labelRects.length > 0) {
                    frameImageData = latestData;
                }
            }
            EditorModel.playbackImageData = frameImageData || null;
            updateVideoCurrentFrame(activeVideo.id, frameNumber, timestamp);
            updateActiveImageIndex(frameNumber);
        },
        [activeVideo, updateVideoCurrentFrame, updateActiveImageIndex]
    );

    // 处理播放/暂停
    const handlePlayPause = useCallback(async () => {
        if (!activeVideo) return;
        const newPlayingStatus = !isPlaying;

        setIsPlaying(newPlayingStatus);
        updateVideoPlayingStatus(activeVideo.id, newPlayingStatus);
        
        if (newPlayingStatus) {
            frameSkipCountRef.current = 0;
            lastFrameRef.current = -1;
        } else {
            // 暂停：用 lastFrameRef（实时值）而非闭包中过时的 activeVideo.currentFrame
            // 注意：不清除 playbackImageData，由 currentFrame effect 统一管理
            const finalFrame = lastFrameRef.current >= 0 ? lastFrameRef.current : activeVideo.currentFrame;
            const safeFps = activeVideo.fps || 30;
            updateVideoCurrentFrame(activeVideo.id, finalFrame, finalFrame / safeFps);
            updateActiveImageIndex(finalFrame);
        }
    }, [activeVideo, isPlaying, updateVideoPlayingStatus, activeImageIndex, updateActiveImageIndex]);

    // 处理静音切换
    const handleToggleMute = useCallback(() => {
        setIsMuted(prev => !prev);
    }, []);

    // 处理视频时间更新
    const lastFrameRef = React.useRef<number>(-1);
    const frameSkipCountRef = React.useRef<number>(0);
    const lastUpdateTimeRef = React.useRef<number>(0); // 记录上次更新时间，用于节流
    const lastSidebarUpdateRef = React.useRef<number>(0); // 侧边栏高亮节流
    const handleVideoTimeUpdate = useCallback(
        (time: number, frame: number) => {
            // 从 ref 读取最新值，使此回调身份稳定（deps 仅含稳定的 action creators）
            const currentActiveVideo = activeVideoRef.current;
            if (!currentActiveVideo) return;

            // 检测跳帧：如果播放中且帧号跳跃超过阈值，输出警告
            // 重要：如果帧号从大跳到小（比如从300跳到0），说明视频被重置了，应该重置 lastFrameRef
            // 注意：对于高帧率视频（>60fps），requestVideoFrameCallback 可能因主线程繁忙而延迟
            // 导致检测到跳帧，这是正常的，不应该视为错误
            if (isPlayingRef.current && lastFrameRef.current >= 0) {
                const frameDiff = frame - lastFrameRef.current;

                // 如果帧号大幅倒退（超过总帧数的一半），说明视频被重置了
                if (frameDiff < -currentActiveVideo.totalFrames / 2) {
                    // 视频重置，重置帧跟踪
                    lastFrameRef.current = -1;
                    frameSkipCountRef.current = 0;
                } else if (frameDiff > 20) {
                    // 提高阈值到20帧，因为高帧率视频（>60fps）中，跳帧是正常的
                    // 只有在跳帧超过20帧时才输出警告
                    frameSkipCountRef.current++;
                    console.warn(`[VideoEditor] 21. 检测到跳帧! 从帧 ${lastFrameRef.current} 跳到 ${frame} (跳过了 ${frameDiff - 1} 帧)`);
                } else if (frameDiff < 0) {
                    // 帧倒退通常发生在视频重置时，只在非正常情况输出警告
                    if (frameDiff < -10) {
                        console.warn(`[VideoEditor] 22. 检测到帧倒退! 从帧 ${lastFrameRef.current} 退到 ${frame}`);
                    }
                }
                // 移除正常连续帧的日志输出
            }
            lastFrameRef.current = frame;

            // 优化：减少 Redux 更新频率，避免阻塞 requestVideoFrameCallback
            // 只在帧号变化时更新，并且限制更新频率（约30fps，33ms）
            const now = Date.now();
            const frameChanged = frame !== currentActiveVideo.currentFrame;
            const timeSinceLastUpdate = now - lastUpdateTimeRef.current;
            // 限制 canvas 更新频率为 30fps（33ms），但最后一帧必须更新（否则播放结束时帧号不对）
            const isLastFrame = frame >= currentActiveVideo.totalFrames - 1;
            const shouldUpdate = frameChanged && (isLastFrame || timeSinceLastUpdate >= 33);

            if (shouldUpdate) {
                lastUpdateTimeRef.current = now;

                // 1. Redux 状态同步（每帧 dispatch，保证 timeline/侧边栏始终同步）
                updateVideoCurrentFrame(currentActiveVideo.id, frame, time);

                // 2. 设置播放时的标注数据（绕过 Redux selector，直接读 ref）
                let frameImageData = imagesDataRef.current[frame];
                if (frameImageData && frameImageData.labelRects.length === 0 && EditorModel.latestImagesData) {
                    const latestData = EditorModel.latestImagesData[frame];
                    if (latestData && latestData.labelRects.length > 0) {
                        frameImageData = latestData;
                    }
                }
                EditorModel.playbackImageData = frameImageData || null;

                // 3. 侧边栏高亮更新：节流到 ~5fps
                const sidebarTimeSince = now - lastSidebarUpdateRef.current;
                if (frame !== activeImageIndexRef.current && (!isPlayingRef.current || sidebarTimeSince >= 200)) {
                    updateActiveImageIndex(frame);
                    lastSidebarUpdateRef.current = now;
                }

                // 4. 渲染标注框
                EditorActions.fullRender();
            }
        },
        [updateVideoCurrentFrame, updateActiveImageIndex]
    );

    // 计算各部分尺寸
    const timelineHeight = 80;
    const videoAndAnnotationHeight = editorSize.height - timelineHeight; // 视频+标注区域占据除时间轴外的所有空间

    const videoPlayerSize: ISize = {
        width: editorSize.width,
        height: videoAndAnnotationHeight
    };

    const canvasEditorSize: ISize = {
        width: editorSize.width,
        height: videoAndAnnotationHeight
    };

    const timelineSize: ISize = {
        width: editorSize.width,
        height: timelineHeight
    };

    if (!activeVideo) {
        return (
            <div className="VideoEditor">
                <div className="NoVideoMessage">
                    <p>请上传视频文件以开始标注</p>
                </div>
            </div>
        );
    }

    // Memoize annotatedFrames: only recompute when imagesData reference changes,
    // NOT on every render (which happens ~30fps during playback due to Redux updates).
    // During playback, imagesData doesn't change (no new annotations), so this is free.
    const annotatedFrames = useMemo(() => {
        return imagesData.reduce<number[]>((acc, img, index) => {
            if (img.labelRects.length > 0 || img.labelPoints.length > 0 ||
                img.labelPolygons.length > 0 || img.labelLines.length > 0) {
                acc.push(index);
            }
            return acc;
        }, []);
    }, [imagesData]);

    // Memoize keyframes: only recompute when activeVideo.frames changes
    const keyframes = useMemo(() => {
        return Array.from(activeVideo.frames.values())
            .filter(frame => frame.isKeyframe)
            .map(frame => frame.frameNumber);
    }, [activeVideo.frames]);

    const currentImageData = imagesData[activeVideo.currentFrame];

    return (
        <div className="VideoEditor">
            {/* 合并的视频播放和标注区域 */}
            <div className="VideoAnnotationSection" style={{ height: videoAndAnnotationHeight }}>
                {/* 底层：视频播放器
                     暂停时隐藏（标注画布已绘制视频帧，避免缩放时未缩放的帧透出） */}
                <div className="VideoPlayerLayer" style={{ visibility: isPlaying ? 'visible' : 'hidden' }}>
                    {/* Playback mode switch:
                        - fast_ffmpeg_mode  → FramePlayer (backend FFmpeg extracts JPEG frames)
                        - raw_browser_mode  → VideoPlayer (browser-native <video> element, fallback)
                        Condition: preExtractedFrames or sessionId present = fast_ffmpeg_mode */}
                    {(activeVideo.preExtractedFrames || activeVideo.sessionId) ? (
                        <FramePlayer
                            language={language}
                            frames={activeVideo.preExtractedFrames || []}
                            sessionId={activeVideo.sessionId}
                            fps={activeVideo.fps}
                            duration={activeVideo.duration}
                            totalFrames={activeVideo.totalFrames}
                            videoSize={activeVideo.videoSize}
                            currentTime={activeVideo.currentTime}
                            currentFrame={activeVideo.currentFrame}
                            isPlaying={isPlaying}
                            onTimeUpdate={handleVideoTimeUpdate}
                            onLoadedMetadata={handleVideoMetadataLoaded}
                            onFirstFrameDrawn={handleFirstFrameDrawn}
                            onPlayPause={handlePlayPause}
                            onFrameReady={handleFrameReady}
                        />
                    ) : (
                        <VideoPlayer
                            language={language}
                            videoSrc={videoUrl}
                            currentTime={activeVideo.currentTime}
                            currentFrame={activeVideo.currentFrame}
                            fps={activeVideo.fps}
                            size={videoPlayerSize}
                            onTimeUpdate={handleVideoTimeUpdate}
                            onLoadedMetadata={handleVideoMetadataLoaded}
                            onFirstFrameDrawn={handleFirstFrameDrawn}
                            onPlay={() => {
                                setIsPlaying(true);
                            }}
                            onPause={() => {
                                setIsPlaying(false);
                                if (activeVideo) {
                                    updateVideoPlayingStatus(activeVideo.id, false);
                                    const finalFrame = lastFrameRef.current >= 0 ? lastFrameRef.current : activeVideo.currentFrame;
                                    const safeFps = activeVideo.fps || (console.warn('[VideoEditor] fps 缺失，使用默认值 30'), 30);
                                    updateVideoCurrentFrame(activeVideo.id, finalFrame, finalFrame / safeFps);
                                    updateActiveImageIndex(finalFrame);
                                }
                                // playbackImageData 由 currentFrame effect 统一管理
                            }}
                            onPlayPause={handlePlayPause}
                            isPlaying={isPlaying}
                            defaultMuted={isMuted}
                            processingProgress={0}
                        />
                    )}
                </div>

                {/* 顶层：标注编辑器 */}
                <div className={`AnnotationLayer ${isPlaying ? 'video-playing' : ''}`}>
                    {currentImageData && activeVideo.videoSize.width > 0 && (
                        <Editor
                            size={canvasEditorSize}
                            imageData={currentImageData}
                        />
                    )}
                </div>
            </div>

            {/* 底部：时间轴 */}
            <div className="TimelineSection" style={{ height: timelineHeight }}>
                <VideoTimeline
                    duration={activeVideo.duration}
                    currentTime={activeVideo.currentTime}
                    frames={activeVideo.totalFrames}
                    currentFrame={activeVideo.currentFrame}
                    fps={activeVideo.fps}
                    onFrameChange={handleFrameChange}
                    size={timelineSize}
                    isPlaying={isPlaying}
                    keyframes={keyframes}
                    annotatedFrames={annotatedFrames}
                    onPlayPause={handlePlayPause}
                    isMuted={isMuted}
                    onToggleMute={handleToggleMute}
                />
            </div>
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    activeVideo: state.video?.activeVideo || null,
    imagesData: state.labels.imagesData,
    activeImageIndex: state.labels.activeImageIndex,
    language: state.general.language
});

const mapDispatchToProps = {
    updateVideoCurrentFrame,
    updateVideoPlayingStatus,
    updateVideoMetadata,
    updateImageDataById,
    updateActiveImageIndex,
    addImageData,
    toggleImageSelection
};

export default connect(mapStateToProps, mapDispatchToProps)(VideoEditor);

