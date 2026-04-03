import React, { useState, useCallback, useEffect } from 'react';
import { connect } from 'react-redux';
import './VideoEditor.scss';
import VideoPlayer from '../VideoPlayer/VideoPlayer';
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
import { AutoSaveService } from '../../../services/AutoSaveService';
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
    const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
    const [loadedThumbnailCount, setLoadedThumbnailCount] = useState(0);
    const [totalFrameCount, setTotalFrameCount] = useState(0);
    const [isMuted, setIsMuted] = useState<boolean>(true); // 静音状态，默认静音
    const [processingProgress, setProcessingProgress] = useState(0); // 视频处理进度 (0-100)
    const tempVideoRef = React.useRef<HTMLVideoElement>(null);
    const thumbnailCanvasRef = React.useRef<HTMLCanvasElement>(null);
    const isGeneratingRef = React.useRef(false);
    const generationIdRef = React.useRef(0); // cancellation token for thumbnail generation

    // 使用 ref 存储最新的 imagesData，避免在 useEffect 依赖中包含它
    const imagesDataRef = React.useRef<ImageData[]>(imagesData);
    useEffect(() => {
        imagesDataRef.current = imagesData;
    }, [imagesData]);

    // 初始化视频URL
    useEffect(() => {
        if (activeVideo?.fileData) {
            // 递增 generation ID，取消所有进行中的缩略图生成
            generationIdRef.current++;
            const url = URL.createObjectURL(activeVideo.fileData);
            setVideoUrl(url);
            return () => {
                const currentImagesData = imagesDataRef.current;
                // 仅在 repository 未被清空时保存缓存（避免覆盖 QueueActions 已保存的有效缓存）
                if (activeVideo.id && currentImagesData.length > 0) {
                    const firstImg = currentImagesData[0];
                    if (firstImg && ImageRepository.getById(firstImg.id)) {
                        ImageRepository.saveFileCache(activeVideo.id, currentImagesData);
                    }
                }

                URL.revokeObjectURL(url);
                generationIdRef.current++; // 取消清理时仍在运行的生成
                if (tempVideoRef.current) {
                    tempVideoRef.current.src = '';
                    (tempVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current = null;
                }
                if (thumbnailCanvasRef.current) {
                    (thumbnailCanvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = null;
                }
                isGeneratingRef.current = false;
            };
        }
        return undefined;
    }, [activeVideo?.fileData, activeVideo?.id]);
    
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

    // 确保当前帧的图像被设置为活动图像
    // 注意：在视频模式下，即使图像还没有加载到 ImageRepository，Editor 也可以工作
    // 因为 VideoPrimaryRenderEngine 不依赖图像对象，而是直接在 VideoPlayer 的 Canvas 上标注
    const lastFrameForImageRef = React.useRef<number>(-1);
    useEffect(() => {
        if (activeVideo && imagesData.length > 0) {
            // 只在帧号变化时执行，避免播放时频繁执行
            if (activeVideo.currentFrame !== lastFrameForImageRef.current) {
                lastFrameForImageRef.current = activeVideo.currentFrame;
                
                const currentImageData = imagesData[activeVideo.currentFrame];
                if (currentImageData && currentImageData.id) {
                    const image = ImageRepository.getById(currentImageData.id);
                    if (image) {
                        EditorActions.setActiveImage(image);
                    } else {
                        // 如果图像还没有加载，仍然设置活动图像（视频模式下可以工作）
                        // Editor 会使用 VideoPlayer 的 Canvas 进行标注
                    }
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

    // 懒加载更多缩略图（当浏览到接近已加载的末尾时）
    useEffect(() => {
        if (!activeVideo || imagesData.length === 0 || loadedThumbnailCount >= totalFrameCount) {
            return;
        }

        // 如果视频正在播放，暂停懒加载以避免干扰
        if (isPlaying) {
            return;
        }

        // 情况1: 用户点击/浏览到了还未加载缩略图的帧，立即加载该区域
        if (activeImageIndex >= loadedThumbnailCount && !isGeneratingRef.current) {
            const batchSize = 30; // 加载包含当前帧的一批
            const startFrame = loadedThumbnailCount;
            const endFrame = Math.min(activeImageIndex + batchSize, totalFrameCount);
            
            generateThumbnailsInRangeRef.current?.(
                startFrame,
                endFrame,
                imagesData,
                activeVideo.fps,
                activeVideo.videoSize
            );
        }
        // 情况2: 用户接近已加载的末尾，预加载下一批
        else if (activeImageIndex >= loadedThumbnailCount - 10 && !isGeneratingRef.current) {
            const batchSize = 20; // 每次预加载20帧
            const nextEndFrame = Math.min(loadedThumbnailCount + batchSize, totalFrameCount);
            
            generateThumbnailsInRangeRef.current?.(
                loadedThumbnailCount,
                nextEndFrame,
                imagesData,
                activeVideo.fps,
                activeVideo.videoSize
            );
        }
    }, [activeImageIndex, loadedThumbnailCount, totalFrameCount, activeVideo, imagesData, isPlaying]);

    // 生成指定范围的缩略图 - 使用 useRef 存储函数以避免循环依赖
    const generateThumbnailsInRangeRef = React.useRef<
        (startFrame: number, endFrame: number, frameImageDataArray: ImageData[], fps: number, videoSize: ISize) => Promise<void>
    >();

    generateThumbnailsInRangeRef.current = async (
        startFrame: number,
        endFrame: number,
        frameImageDataArray: ImageData[],
        fps: number,
        videoSize: ISize
    ) => {
        if (isGeneratingRef.current) return;
        if (isPlaying) return;

        isGeneratingRef.current = true;
        const currentGenerationId = generationIdRef.current;
        
        const thumbnailSize = 150;
        
        // 创建或获取缩略图画布
        let thumbnailCanvas = thumbnailCanvasRef.current;
        if (!thumbnailCanvas) {
            thumbnailCanvas = document.createElement('canvas');
            thumbnailCanvas.width = thumbnailSize;
            thumbnailCanvas.height = thumbnailSize;
            thumbnailCanvasRef.current = thumbnailCanvas;
        }
        const thumbnailCtx = thumbnailCanvas.getContext('2d');
        
            // 创建或获取临时视频元素（使用独立的video element避免与主播放器冲突）
            let tempVideo = tempVideoRef.current;
            if (!tempVideo) {
                tempVideo = document.createElement('video');
                tempVideo.src = videoUrl;
                tempVideo.muted = true;
                tempVideo.preload = 'auto';
                tempVideo.playsInline = true; // 避免全屏播放
                tempVideoRef.current = tempVideo;
                
                // 等待视频可以播放
                await new Promise<void>((resolve) => {
                    tempVideo.onloadedmetadata = () => {
                        resolve();
                    };
                });
            }
        
            const actualEnd = Math.min(endFrame, frameImageDataArray.length);
            const totalToGenerate = actualEnd - startFrame;
            const startTime = performance.now();
            
            for (let i = startFrame; i < actualEnd; i++) {
                try {
                    // 检查是否被取消（视频切换）
                    if (generationIdRef.current !== currentGenerationId) {
                        isGeneratingRef.current = false;
                        return;
                    }
                    const time = i / fps;
                    tempVideo.currentTime = time;
                    
                    // 等待视频跳转完成
                    await new Promise<void>((resolve) => {
                        tempVideo.onseeked = () => resolve();
                    });
                    
                    // 在缩略图画布上绘制当前帧
                    const scale = Math.min(
                        thumbnailSize / videoSize.width,
                        thumbnailSize / videoSize.height
                    );
                    const scaledWidth = videoSize.width * scale;
                    const scaledHeight = videoSize.height * scale;
                    const offsetX = (thumbnailSize - scaledWidth) / 2;
                    const offsetY = (thumbnailSize - scaledHeight) / 2;
                    
                    thumbnailCtx.fillStyle = '#000';
                    thumbnailCtx.fillRect(0, 0, thumbnailSize, thumbnailSize);
                    thumbnailCtx.drawImage(
                        tempVideo,
                        offsetX,
                        offsetY,
                        scaledWidth,
                        scaledHeight
                    );
                    
                    // 将画布转换为图像 - 为每一帧创建独立的 Image 对象
                    // 使用较低的质量 (0.5) 以加快生成速度，减少内存占用
                    const thumbnailDataUrl = thumbnailCanvas.toDataURL('image/jpeg', 0.5);
                    
                    // 使用 Promise 确保图像完全加载后再存储
                    await new Promise<void>((resolve) => {
                        const thumbnailImage = new Image();
                        thumbnailImage.onload = () => {
                            // 图像加载完成后再存储到 Repository
                            ImageRepository.storeImage(frameImageDataArray[i].id, thumbnailImage);
                            
                            // 更新 imageData 的 loadStatus 并触发 Redux 更新，让 ImagePreview 组件知道图像已就绪
                            const updatedImageData = { ...frameImageDataArray[i], loadStatus: true };
                            frameImageDataArray[i] = updatedImageData;
                            updateImageDataById(updatedImageData.id, updatedImageData);
                            
                            resolve();
                        };
                        // 设置 src 会触发加载
                        thumbnailImage.src = thumbnailDataUrl;
                    });
                    
                    setLoadedThumbnailCount(i + 1);
                    
                    // 更新进度（只在初始批次时更新）
                    if (startFrame === 0) {
                        const progress = Math.round(((i + 1) / actualEnd) * 100);
                        setProcessingProgress(progress);
                    }
                    
                    // 每10帧让出主线程，避免阻塞UI（减少频率以加快速度）
                    if ((i - startFrame) % 10 === 0 && i > startFrame) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                } catch (error) {
                    console.error(`[VideoEditor] 6. 生成第 ${i} 帧缩略图失败:`, error);
                }
            }
            
            isGeneratingRef.current = false;
    };

    // 处理第一帧绘制完成 - 生成缩略图版本用于显示（与其他帧保持一致）
    const handleFirstFrameDrawn = useCallback(
        (canvas: HTMLCanvasElement) => {
            // 使用 ref 获取最新的 imagesData，避免闭包过期
            const currentImagesData = imagesDataRef.current;
            if (!activeVideo || currentImagesData.length === 0) return;

            const firstFrameImageData = currentImagesData[0];
            if (!firstFrameImageData) {
                return;
            }
            
            // 如果第一帧已经加载，只需要确保活动图像已设置
            if (firstFrameImageData.loadStatus) {
                const existingImage = ImageRepository.getById(firstFrameImageData.id);
                if (existingImage) {
                    EditorActions.setActiveImage(existingImage);
                    console.log('[VideoEditor] 2. 第一帧图像已存在，已设置为活动图像');
                }
                return;
            }
            
            console.log('[VideoEditor] 3. 从 VideoPlayer Canvas 中生成第一帧缩略图...');
            
            // 生成缩略图版本用于显示（与其他帧保持一致：150x150，JPEG格式，0.7质量）
            const thumbnailSize = 150;
            const thumbnailCanvas = document.createElement('canvas');
            thumbnailCanvas.width = thumbnailSize;
            thumbnailCanvas.height = thumbnailSize;
            const thumbnailCtx = thumbnailCanvas.getContext('2d');
            
            if (thumbnailCtx && activeVideo.videoSize.width > 0 && activeVideo.videoSize.height > 0) {
                // 计算缩放比例，保持宽高比
                const scale = Math.min(
                    thumbnailSize / activeVideo.videoSize.width,
                    thumbnailSize / activeVideo.videoSize.height
                );
                const scaledWidth = activeVideo.videoSize.width * scale;
                const scaledHeight = activeVideo.videoSize.height * scale;
                const offsetX = (thumbnailSize - scaledWidth) / 2;
                const offsetY = (thumbnailSize - scaledHeight) / 2;
                
                // 填充黑色背景
                thumbnailCtx.fillStyle = '#000';
                thumbnailCtx.fillRect(0, 0, thumbnailSize, thumbnailSize);
                
                // 在缩略图画布上绘制第一帧（从原始Canvas缩放）
                thumbnailCtx.drawImage(
                    canvas,
                    offsetX,
                    offsetY,
                    scaledWidth,
                    scaledHeight
                );
                
                // 将缩略图转换为JPEG格式（与其他帧保持一致）
                // 使用较低的质量 (0.5) 以加快生成速度
                const thumbnailDataUrl = thumbnailCanvas.toDataURL('image/jpeg', 0.5);
                
                // 创建缩略图图像对象
                const thumbnailImage = new Image();
                thumbnailImage.onload = () => {
                    // 存储缩略图到 ImageRepository（用于显示）
                    // 注意：Editor在视频模式下使用VideoPlayer的Canvas，不依赖ImageRepository
                    // 所以这里存储缩略图用于ImagePreview显示是可以的
                    ImageRepository.storeImage(firstFrameImageData.id, thumbnailImage);
                    
                    // 更新 ImageData 的 loadStatus
                    const updatedImageData = { ...firstFrameImageData, loadStatus: true };
                    updateImageDataById(updatedImageData.id, updatedImageData);
                    
                    // 设置第一帧为活动图像，这样 Editor 可以立即初始化
                    // Editor会使用VideoPlayer的Canvas，不依赖这个缩略图
                    EditorActions.setActiveImage(thumbnailImage);
                    
                    console.log('[VideoEditor] 4. 第一帧缩略图已生成并存储 - 与其他帧保持一致（150x150 JPEG）');
                };
                thumbnailImage.onerror = (error) => {
                    console.error('[VideoEditor] 5. 加载第一帧缩略图失败:', error);
                    // 即使失败也更新loadStatus，避免阻塞
                    const updatedImageData = { ...firstFrameImageData, loadStatus: true };
                    updateImageDataById(updatedImageData.id, updatedImageData);
                };
                thumbnailImage.src = thumbnailDataUrl;
            } else {
                // 如果无法生成缩略图，至少更新loadStatus
                const updatedImageData = { ...firstFrameImageData, loadStatus: true };
                updateImageDataById(updatedImageData.id, updatedImageData);
            }
        },
        [activeVideo, imagesData, updateImageDataById]
    );

    // 处理视频元数据加载
    const handleVideoMetadataLoaded = useCallback(
        async (duration: number, frames: number, fps: number, videoSize: ISize) => {
            if (!activeVideo) return;
            updateVideoMetadata(activeVideo.id, duration, fps, frames, videoSize);
            
            // ========== 检查是否已经有缓存的 imagesData ==========
            // 验证缓存属于当前视频（通过 activeFileId）且帧数匹配
            const cachedFileId = ImageRepository.getActiveFileId();
            if (imagesData.length > 0 && imagesData.length === frames && cachedFileId === activeVideo.id) {
                const loadedCount = imagesData.filter(img => img.loadStatus).length;
                const loadedPercentage = (loadedCount / frames) * 100;
                
                console.log(`[VideoEditor] 7. 检测到 ImageData 缓存，共 ${imagesData.length} 帧，已加载 ${loadedCount} 帧 (${loadedPercentage.toFixed(1)}%)`);
                
                // 只有当至少50%的帧已加载时，才认为是有效缓存
                // 这样可以处理刷新浏览器后 ImageRepository 被清空的情况
                if (loadedCount > frames * 0.5) {
                    console.log(`[VideoEditor] 8. 缓存有效（${loadedPercentage.toFixed(1)}% 已加载），跳过重新生成`);
                    
                    // 确保第一帧被选中
                    if (activeImageIndex === null || activeImageIndex < 0 || activeImageIndex >= imagesData.length) {
                        updateActiveImageIndex(0);
                    }
                    updateVideoCurrentFrame(activeVideo.id, 0, 0);
                    
                    // 设置缩略图计数
                    setLoadedThumbnailCount(loadedCount);
                    setTotalFrameCount(frames);
                    
                    return; // 跳过重新生成
                } else {
                    console.log(`[VideoEditor] 9. 缓存无效（仅 ${loadedPercentage.toFixed(1)}% 已加载），将重新生成所有缩略图`);
                    // 不返回，继续执行下面的生成逻辑
                    // 但保留标注数据（imagesData 中的标注信息）
                }
            }
            
            // ========== 如果没有缓存或缓存无效，执行生成逻辑 ==========
            // 检查是否需要生成缩略图
            const needsRegeneration = imagesData.length === 0 || 
                                      (imagesData.length === frames && imagesData.filter(img => img.loadStatus).length <= frames * 0.5);
            
            if (needsRegeneration) {
                const hasExistingData = imagesData.length === frames;
                console.log(`[VideoEditor] ${hasExistingData ? '10. 缓存无效' : '10. 首次加载'}，共 ${frames} 帧，开始生成缩略图...`);
                setTotalFrameCount(frames);
                setIsGeneratingThumbnails(true);
                
                let frameImageDataArray: ImageData[] = [];
                
                // 如果已有数据（缓存无效情况），保留标注信息，只重置 loadStatus
                if (hasExistingData) {
                    console.log(`[VideoEditor] 11. 保留已有标注数据，重置加载状态...`);
                    frameImageDataArray = imagesData.map(img => ({
                        ...img,
                        loadStatus: false // 重置加载状态，等缩略图重新生成
                    }));
                    // 更新 Redux 中的数据
                    frameImageDataArray.forEach(img => {
                        updateImageDataById(img.id, img);
                    });
                } else {
                    // 首次加载：创建新的 ImageData 对象
                    console.log(`[VideoEditor] 11. 开始创建 ${frames} 个帧的 ImageData 对象...`);
                    for (let i = 0; i < frames; i++) {
                        const frameImageData = ImageDataUtil.createImageDataFromFileData(activeVideo.fileData);
                        frameImageData.loadStatus = false; // 改为 false，等缩略图生成后再设置为 true
                        // 第一帧默认设置为选中状态，显示蓝色勾
                        if (i === 0) {
                            frameImageData.isSelected = true;
                            console.log('[VideoEditor] 12. 第一帧的 isSelected 已设置为 true');
                        }
                        frameImageDataArray.push(frameImageData);
                    }
                    
                    // 先添加所有帧数据到 store
                    addImageData(frameImageDataArray);
                }
                
                console.log(`[VideoEditor] 13. ImageData 准备完成，数组长度: ${frameImageDataArray.length}`);
                
                // 验证顺序
                console.log('[VideoEditor] 14. 验证帧顺序: 前5帧ID:', frameImageDataArray.slice(0, 5).map((d, i) => `[${i}]:${d.id.substring(0, 8)}`));
                
                // 立即设置第一帧为活动图像（不等待缩略图生成，这样用户可以立即开始标注）
                // 注意：第一帧的图像将从 VideoPlayer 的 Canvas 中提取
                if (frameImageDataArray.length > 0) {
                    const firstFrameImageData = frameImageDataArray[0];
                    
                    // 1. 确保第一帧的 isSelected 为 true（显示蓝色勾）
                    if (!hasExistingData) {
                        // 首次加载时设置
                        if (!firstFrameImageData.isSelected) {
                            const updatedFirstFrame = { ...firstFrameImageData, isSelected: true };
                            updateImageDataById(firstFrameImageData.id, updatedFirstFrame);
                            console.log('[VideoEditor] 15. 第一帧的 isSelected 已设置为 true - 蓝色勾应显示');
                        } else {
                            console.log('[VideoEditor] 15. 第一帧的 isSelected 已为 true - 蓝色勾应显示');
                        }
                    }
                    
                    // 2. 使用 setTimeout 确保 Redux store 更新完成后再设置 activeImageIndex
                    // 这样可以避免时序问题
                    setTimeout(() => {
                        // 更新视频当前帧为第0帧
                        updateVideoCurrentFrame(activeVideo.id, 0, 0);
                        console.log('[VideoEditor] 16. 视频当前帧已设置为第0帧');
                        
                        // 更新活动图像索引为第0帧（这样左侧列表会立即高亮第一帧）
                        updateActiveImageIndex(0);
                        console.log('[VideoEditor] 17. 活动图像索引已设置为0 - 左侧列表已选中第一帧');
                        
                        // 第一帧的图像将在 onFirstFrameDrawn 回调中从 Canvas 提取并设置
                        // 这样可以确保 Editor 组件可以立即初始化并开始标注
                    }, 0);
                }
                
                // 智能决定初始加载数量：
                // - 短视频（<300帧，约10秒@30fps）：加载全部
                // - 中等视频（300-1800帧，约10-60秒）：加载前150帧（5秒）
                // - 长视频（>1800帧，约>60秒）：加载前300帧（10秒）
                let initialLoadCount: number;
                if (frames <= 300) {
                    initialLoadCount = frames; // 短视频全部加载
                } else if (frames <= 1800) {
                    initialLoadCount = Math.min(150, frames); // 中等视频加载前5秒
                } else {
                    initialLoadCount = Math.min(300, frames); // 长视频加载前10秒
                }
                
                console.log(`\n[VideoEditor] 18. 视频总帧数: ${frames}, 初始加载策略: 加载前 ${initialLoadCount} 帧`);
                console.log(`[VideoEditor] 19. 开始生成初始缩略图 (0 -> ${initialLoadCount-1})...`);
                
                await generateThumbnailsInRangeRef.current?.(0, initialLoadCount, frameImageDataArray, fps, videoSize);
                
                setIsGeneratingThumbnails(false);
                setProcessingProgress(0); // 重置进度
                console.log(`[VideoEditor] 20. 初始缩略图生成完成 (${initialLoadCount}/${frames} 帧)\n`);
            }
        },
        [activeVideo, updateVideoMetadata, addImageData, imagesData.length, videoUrl, updateVideoCurrentFrame, updateActiveImageIndex, activeImageIndex, imagesData, updateImageDataById]
    );

    // 处理时间轴拖动
    const handleTimelineSeek = useCallback(
        (time: number) => {
            if (!activeVideo) return;
            const frameNumber = Math.floor(time * activeVideo.fps);
            updateVideoCurrentFrame(activeVideo.id, frameNumber, time);
        },
        [activeVideo, updateVideoCurrentFrame]
    );

    // 处理帧变化
    const handleFrameChange = useCallback(
        (frameNumber: number) => {
            if (!activeVideo) return;
            const timestamp = frameNumber / activeVideo.fps;
            updateVideoCurrentFrame(activeVideo.id, frameNumber, timestamp);
            
            // 更新活动图像索引以匹配当前帧
            if (frameNumber !== activeImageIndex) {
                updateActiveImageIndex(frameNumber);
            }
        },
        [activeVideo, activeImageIndex, updateVideoCurrentFrame, updateActiveImageIndex]
    );

    // 处理播放/暂停
    const handlePlayPause = useCallback(async () => {
        if (!activeVideo) return;
        // 如果当前不在播放（包括视频结束后），下次一定是播放
        const newPlayingStatus = !isPlaying;
        
        // 如果开始播放，先检查是否有足够的缓冲帧
        if (newPlayingStatus && !isGeneratingRef.current) {
            const currentFrame = activeVideo.currentFrame;
            const bufferSize = 60; // 需要2秒缓冲（假设30fps）
            const requiredFrame = Math.min(currentFrame + bufferSize, totalFrameCount);
            
            // 如果缓冲不足，先加载必要的帧
            if (loadedThumbnailCount < requiredFrame) {
                console.log(`[VideoEditor] 播放缓冲: 当前加载到帧 ${loadedThumbnailCount}, 需要加载到帧 ${requiredFrame}`);
                
                // 快速加载缓冲区
                await generateThumbnailsInRangeRef.current?.(
                    loadedThumbnailCount,
                    requiredFrame,
                    imagesData,
                    activeVideo.fps,
                    activeVideo.videoSize
                );
            }
        }
        
        setIsPlaying(newPlayingStatus);
        updateVideoPlayingStatus(activeVideo.id, newPlayingStatus);
        
        // 如果开始播放，确保停止缩略图生成并重置跳帧计数器
        if (newPlayingStatus) {
            isGeneratingRef.current = false;
            frameSkipCountRef.current = 0;
            lastFrameRef.current = -1;
        }
    }, [activeVideo, isPlaying, updateVideoPlayingStatus, loadedThumbnailCount, totalFrameCount, imagesData]);

    // 处理静音切换
    const handleToggleMute = useCallback(() => {
        setIsMuted(prev => !prev);
    }, []);

    // 处理视频时间更新
    const lastFrameRef = React.useRef<number>(-1);
    const frameSkipCountRef = React.useRef<number>(0);
    const lastUpdateTimeRef = React.useRef<number>(0); // 记录上次更新时间，用于节流
    const handleVideoTimeUpdate = useCallback(
        (time: number, frame: number) => {
            if (!activeVideo) return;
            
            // 检测跳帧：如果播放中且帧号跳跃超过阈值，输出警告
            // 重要：如果帧号从大跳到小（比如从300跳到0），说明视频被重置了，应该重置 lastFrameRef
            // 注意：对于高帧率视频（>60fps），requestVideoFrameCallback 可能因主线程繁忙而延迟
            // 导致检测到跳帧，这是正常的，不应该视为错误
            if (isPlaying && lastFrameRef.current >= 0) {
                const frameDiff = frame - lastFrameRef.current;
                
                // 如果帧号大幅倒退（超过总帧数的一半），说明视频被重置了
                if (frameDiff < -activeVideo.totalFrames / 2) {
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
            
            // 调试日志：仅在播放时每60帧输出一次，减少日志频率
            if (isPlaying && frame % 60 === 0 && frameSkipCountRef.current > 0) {
                console.log(`[VideoEditor] 23. 播放中 - 帧: ${frame}, 时间: ${time.toFixed(2)}s, 跳帧统计: ${frameSkipCountRef.current} 次`);
            }
            
            // 优化：减少 Redux 更新频率，避免阻塞 requestVideoFrameCallback
            // 只在帧号变化时更新，并且限制更新频率（约30fps，33ms）
            const now = Date.now();
            const frameChanged = frame !== activeVideo.currentFrame;
            const timeSinceLastUpdate = now - lastUpdateTimeRef.current;
            // 限制更新频率为约30fps（33ms），减少 Redux 更新次数，避免阻塞回调
            const shouldUpdate = frameChanged && timeSinceLastUpdate >= 33;
            
            if (shouldUpdate) {
                // 同步更新，但频率已降低，不会过度阻塞回调
                updateVideoCurrentFrame(activeVideo.id, frame, time);
                lastUpdateTimeRef.current = now;
                
                // 更新当前帧对应的图像索引（播放时逐帧更新，让左侧列表动态高亮）
                // 只在帧号变化时更新，避免不必要的更新
                if (frame !== activeImageIndex) {
                    updateActiveImageIndex(frame);
                }
            }
        },
        [activeVideo, activeImageIndex, updateVideoCurrentFrame, updateActiveImageIndex, isPlaying]
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

    // 获取已标注的帧列表（使用原始 index，不是过滤后的 index）
    const annotatedFrames = imagesData.reduce<number[]>((acc, img, index) => {
        if (img.labelRects.length > 0 || img.labelPoints.length > 0 ||
            img.labelPolygons.length > 0 || img.labelLines.length > 0) {
            acc.push(index);
        }
        return acc;
    }, []);

    // 获取关键帧列表
    const keyframes = Array.from(activeVideo.frames.values())
        .filter(frame => frame.isKeyframe)
        .map(frame => frame.frameNumber);

    const currentImageData = imagesData[activeVideo.currentFrame];

    return (
        <div className="VideoEditor">
            {/* 合并的视频播放和标注区域 */}
            <div className="VideoAnnotationSection" style={{ height: videoAndAnnotationHeight }}>
                {/* 底层：视频播放器 */}
                <div className="VideoPlayerLayer">
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
                            }
                        }}
                        onPlayPause={handlePlayPause}
                        isPlaying={isPlaying}
                        defaultMuted={isMuted}
                        processingProgress={processingProgress}
                    />
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
                    onSeek={handleTimelineSeek}
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

