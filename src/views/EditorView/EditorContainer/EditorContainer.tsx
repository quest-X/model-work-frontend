import React, {useState, useEffect} from 'react';
import {connect} from 'react-redux';
import {Direction} from '../../../data/enums/Direction';
import {ISize} from '../../../interfaces/ISize';
import {Settings} from '../../../settings/Settings';
import {AppState} from '../../../store';
import {ImageData} from '../../../store/labels/types';
import {VideoData} from '../../../store/video/types';
import ImagesList from '../SideNavigationBar/ImagesList/ImagesList';
import QueueList from '../SideNavigationBar/QueueList/QueueList';
import LabelsToolkit from '../SideNavigationBar/LabelsToolkit/LabelsToolkit';
import {SideNavigationBar} from '../SideNavigationBar/SideNavigationBar';
import {VerticalEditorButton} from '../VerticalEditorButton/VerticalEditorButton';
import './EditorContainer.scss';
import Editor from '../Editor/Editor';
import VideoEditor from '../VideoEditor/VideoEditor';
import {ContextManager} from '../../../logic/context/ContextManager';
import {ContextType} from '../../../data/enums/ContextType';
import EditorBottomNavigationBar from '../EditorBottomNavigationBar/EditorBottomNavigationBar';
import EditorTopNavigationBar from '../EditorTopNavigationBar/EditorTopNavigationBar';
import {ProjectType} from '../../../data/enums/ProjectType';
import {useDropzone, DropzoneOptions} from 'react-dropzone';
import {addImageData, updateImageData, updateActiveImageIndex} from '../../../store/labels/actionCreators';
import {updateActivePopupType} from '../../../store/general/actionCreators';
import {addVideoData, updateVideoMode} from '../../../store/video/actionCreators';
import {addQueueItems, setActiveQueueItem, updateQueueItem} from '../../../store/queue/actionCreators';
import {QueueItem, QueueItemType, QueueItemStatus} from '../../../store/queue/types';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {ImageDataUtil} from '../../../utils/ImageDataUtil';
import {sortBy} from 'lodash';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import InferenceResultsButton from '../InferenceResultsButton/InferenceResultsButton';
import InferenceResultsView from '../InferenceResultsView/InferenceResultsView';
import {AutoSaveService} from '../../../services/AutoSaveService';
import {v4 as uuidv4} from 'uuid';
import {ImageRepository} from '../../../logic/imageRepository/ImageRepository';
// import {inferenceEventEmitter, InferenceResultsEvent} from '../../../logic/actions/AISegmentationActions';

interface IProps {
    windowSize: ISize;
    activeImageIndex: number;
    imagesData: ImageData[];
    activeContext: ContextType;
    projectType: ProjectType;
    language: Language;
    isVideoMode: boolean;
    activeVideo: VideoData | null;
    queueItems: QueueItem[];
    activeQueueItemId: string | null;
    addImageDataAction: (imageData: ImageData[]) => any;
    updateImageDataAction: (imageData: ImageData[]) => any;
    updateActiveImageIndexAction: (activeImageIndex: number) => any;
    updateActivePopupTypeAction: (activePopupType: PopupWindowType) => any;
    addVideoDataAction: (videoData: VideoData) => any;
    updateVideoModeAction: (isVideoMode: boolean) => any;
    addQueueItemsAction: (items: QueueItem[]) => any;
    setActiveQueueItemAction: (itemId: string | null) => any;
    updateQueueItemAction: (itemId: string, updates: Partial<QueueItem>) => any;
}

const EditorContainer: React.FC<IProps> = (
    {
        windowSize,
        activeImageIndex,
        imagesData,
        activeContext,
        projectType,
        language,
        isVideoMode,
        activeVideo,
        queueItems,
        activeQueueItemId,
        addImageDataAction,
        updateImageDataAction,
        updateActiveImageIndexAction,
        updateActivePopupTypeAction,
        addVideoDataAction,
        updateVideoModeAction,
        addQueueItemsAction,
        setActiveQueueItemAction,
        updateQueueItemAction
    }) => {
    const [leftTabStatus, setLeftTabStatus] = useState(true);
    const [rightTabStatus, setRightTabStatus] = useState(true);
    const [showInferenceResults, setShowInferenceResults] = useState<boolean>(false);
    const [showQueueList, setShowQueueList] = useState<boolean>(false);
    
    const currentTexts = LanguageConfig[language];
    
    // 监听推理完成事件，自动切换到推理结果视图
    useEffect(() => {
        const handleInferenceResults = (event: any) => {
            if (event.type === 'SHOW_INFERENCE_RESULTS' && event.results.length > 0) {
                // 自动切换到推理结果视图
                setRightTabStatus(true);
                setShowInferenceResults(true);
                if (activeContext !== ContextType.RIGHT_NAVBAR) {
                    ContextManager.switchCtx(ContextType.RIGHT_NAVBAR);
                }
                console.log('Auto-switched to inference results view with', event.results.length, 'objects');
            }
        };
        
        // inferenceEventEmitter.addListener(handleInferenceResults);
        
        return () => {
            // inferenceEventEmitter.removeListener(handleInferenceResults);
        };
    }, [activeContext]);


    // 监听数据变化并触发自动保存
    // 使用 ref 来避免频繁触发
    const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
    
    useEffect(() => {
        // 当图像数据或标注数据变化时触发保存
        if (imagesData.length > 0) {
            // 清除之前的定时器
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
            
            // 设置新的定时器
            saveTimeoutRef.current = setTimeout(() => {
                AutoSaveService.saveCurrentState();
                saveTimeoutRef.current = null;
            }, 1000); // 1秒延迟，避免频繁保存
        }
        
        // cleanup 函数
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = null;
            }
        };
    }, [imagesData, activeImageIndex, language]);

    // 生成缩略图辅助函数
    const generateThumbnail = async (file: File): Promise<string | undefined> => {
        return new Promise((resolve) => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        const maxSize = 100;
                        let width = img.width;
                        let height = img.height;
                        
                        if (width > height) {
                            if (width > maxSize) {
                                height *= maxSize / width;
                                width = maxSize;
                            }
                        } else {
                            if (height > maxSize) {
                                width *= maxSize / height;
                                height = maxSize;
                            }
                        }
                        
                        canvas.width = width;
                        canvas.height = height;
                        ctx?.drawImage(img, 0, 0, width, height);
                        resolve(canvas.toDataURL());
                    };
                    img.src = e.target?.result as string;
                };
                reader.readAsDataURL(file);
            } else if (file.type.startsWith('video/')) {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.onloadedmetadata = () => {
                    video.currentTime = 0;
                };
                const videoUrl = URL.createObjectURL(file);
                video.onseeked = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const maxSize = 100;
                    let width = video.videoWidth;
                    let height = video.videoHeight;

                    if (width > height) {
                        if (width > maxSize) {
                            height *= maxSize / width;
                            width = maxSize;
                        }
                    } else {
                        if (height > maxSize) {
                            width *= maxSize / height;
                            height = maxSize;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    ctx?.drawImage(video, 0, 0, width, height);
                    URL.revokeObjectURL(videoUrl);
                    resolve(canvas.toDataURL());
                };
                video.onerror = () => {
                    URL.revokeObjectURL(videoUrl);
                    resolve(undefined);
                };
                video.src = videoUrl;
            } else {
                resolve(undefined);
            }
        });
    };

    // 从文件路径提取文件夹名称
    const getFolderName = (path: string): string | null => {
        const parts = path.split('/');
        if (parts.length > 1) {
            return parts[parts.length - 2];
        }
        return null;
    };

    // 拖拽上传功能 - 支持图片和视频（仅拖拽，不支持点击）
    const {acceptedFiles, getRootProps, getInputProps, isDragActive} = useDropzone({
        noClick: true, // 禁用点击上传，只支持拖拽
        accept: {
            'image/*': ['.jpeg', '.png', '.jpg'],
            'video/*': ['.mp4', '.mov', '.avi', '.webm']
        },
        onDrop: async (files) => {
            if (files.length > 0) {
                const sortedFiles = sortBy(files, (item: File) => item.name);
                
                // 检查是否包含视频文件
                const videoFiles = sortedFiles.filter(file => file.type.startsWith('video/'));
                const imageFiles = sortedFiles.filter(file => file.type.startsWith('image/'));
                
                // 按照文件路径分组图像
                const filesByFolder = new Map<string, File[]>();
                for (const file of imageFiles) {
                    const folderPath = (file as any).webkitRelativePath || file.name;
                    const folderName = getFolderName(folderPath) || 'images';
                    
                    if (!filesByFolder.has(folderName)) {
                        filesByFolder.set(folderName, []);
                    }
                    filesByFolder.get(folderName)!.push(file);
                }

                // 添加到队列
                const newQueueItems: QueueItem[] = [];
                
                // 添加视频文件（每个单独）
                for (const videoFile of videoFiles) {
                    const thumbnail = await generateThumbnail(videoFile);
                    const item: QueueItem = {
                        id: uuidv4(),
                        name: videoFile.name,
                        type: QueueItemType.VIDEO,
                        file: videoFile,
                        status: QueueItemStatus.PENDING,
                        uploadedAt: Date.now(),
                        thumbnail
                    };
                    newQueueItems.push(item);
                }

                // 添加图像文件（按文件夹分组）
                for (const [folderName, files] of filesByFolder.entries()) {
                    if (files.length === 1) {
                        const file = files[0];
                        const thumbnail = await generateThumbnail(file);
                        const item: QueueItem = {
                            id: uuidv4(),
                            name: file.name,
                            type: QueueItemType.IMAGE,
                            file: file,
                            status: QueueItemStatus.PENDING,
                            uploadedAt: Date.now(),
                            thumbnail
                        };
                        newQueueItems.push(item);
                    } else {
                        const sortedFolderFiles = files.sort((a, b) => a.name.localeCompare(b.name));
                        const thumbnail = await generateThumbnail(sortedFolderFiles[0]);
                        const item: QueueItem = {
                            id: uuidv4(),
                            name: `${folderName} (${files.length}张图像)`,
                            type: QueueItemType.FOLDER,
                            files: sortedFolderFiles,
                            status: QueueItemStatus.PENDING,
                            uploadedAt: Date.now(),
                            thumbnail
                        };
                        newQueueItems.push(item);
                    }
                }

                addQueueItemsAction(newQueueItems);
                
                // 检查当前是否有内容（视频或图片）
                const hasContent = (isVideoMode && activeVideo) || (!isVideoMode && imagesData.length > 0);
                
                if (hasContent) {
                    // 如果当前有内容，只添加到队列，不替换当前内容
                    // 如果有视频文件，自动切换到最新的视频
                    if (videoFiles.length > 0 && newQueueItems.length > 0) {
                        // 找到最新的视频队列项（第一个，因为新添加的项在数组开头）
                        const latestVideoItem = newQueueItems.find(item => item.type === QueueItemType.VIDEO);
                        if (latestVideoItem) {
                            // 保存当前文件的缓存
                            const currentFileId = ImageRepository.getActiveFileId();
                            if (currentFileId && imagesData.length > 0) {
                                ImageRepository.saveFileCache(currentFileId, imagesData);
                            }
                            
                            // 清空当前显示
                            ImageRepository.clearCurrentDisplay();
                            updateImageDataAction([]);
                            updateActiveImageIndexAction(0);
                            
                            // 尝试恢复目标文件的缓存
                            const cachedData = ImageRepository.restoreFileCache(latestVideoItem.id);
                            
                            setActiveQueueItemAction(latestVideoItem.id);
                            updateQueueItemAction(latestVideoItem.id, { status: QueueItemStatus.PROCESSING });
                            
                            try {
                                if (cachedData) {
                                    // 有缓存：直接恢复
                                    updateVideoModeAction(true);
                                    const videoData: VideoData = {
                                        id: latestVideoItem.id,
                                        fileData: latestVideoItem.file!,
                                        loadStatus: false,
                                        duration: 0,
                                        fps: 30,
                                        totalFrames: 0,
                                        videoSize: { width: 0, height: 0 },
                                        currentFrame: 0,
                                        currentTime: 0,
                                        isPlaying: false,
                                        frames: new Map()
                                    };
                                    addVideoDataAction(videoData);
                                    updateImageDataAction(cachedData);
                                    updateActiveImageIndexAction(0);
                                    ImageRepository.setActiveFileId(latestVideoItem.id);
                                } else {
                                    // 无缓存：重新加载
                                    const videoData: VideoData = {
                                        id: latestVideoItem.id,
                                        fileData: latestVideoItem.file!,
                                        loadStatus: false,
                                        duration: 0,
                                        fps: 30,
                                        totalFrames: 0,
                                        videoSize: { width: 0, height: 0 },
                                        currentFrame: 0,
                                        currentTime: 0,
                                        isPlaying: false,
                                        frames: new Map()
                                    };
                                    updateVideoModeAction(true);
                                    addVideoDataAction(videoData);
                                    ImageRepository.setActiveFileId(latestVideoItem.id);
                                }
                                
                                updateQueueItemAction(latestVideoItem.id, { status: QueueItemStatus.COMPLETED });
                            } catch (error) {
                                console.error('[EditorContainer] 加载视频失败:', error);
                                updateQueueItemAction(latestVideoItem.id, { 
                                    status: QueueItemStatus.ERROR, 
                                    error: error instanceof Error ? error.message : '加载失败'
                                });
                            }
                        }
                    }
                    // 如果只有图片文件，只添加到队列，不自动切换
                } else {
                    // 如果当前没有内容，使用原有逻辑（替换模式）
                    if (videoFiles.length > 0) {
                        // 视频模式：只处理第一个视频文件，清空图像数据
                        updateImageDataAction([]);
                        updateActiveImageIndexAction(0);
                        
                        const videoFile = videoFiles[0];
                        const videoData: VideoData = {
                            id: newQueueItems[0]?.id || uuidv4(),
                            fileData: videoFile,
                            loadStatus: false,
                            duration: 0,
                            fps: 30,
                            totalFrames: 0,
                            videoSize: { width: 0, height: 0 },
                            currentFrame: 0,
                            currentTime: 0,
                            isPlaying: false,
                            frames: new Map()
                        };
                        
                        updateVideoModeAction(true);
                        addVideoDataAction(videoData);
                        
                        // 设置活动队列项
                        if (newQueueItems.length > 0) {
                            setActiveQueueItemAction(newQueueItems[0].id);
                            updateQueueItemAction(newQueueItems[0].id, { status: QueueItemStatus.COMPLETED });
                            ImageRepository.setActiveFileId(newQueueItems[0].id);
                        }
                    } else if (imageFiles.length > 0) {
                        // 图片模式：替换（不是添加）图像数据
                        updateVideoModeAction(false);
                        updateActiveImageIndexAction(0);
                        updateImageDataAction(imageFiles.map((file: File) => ImageDataUtil.createImageDataFromFileData(file)));
                        
                        // 设置活动队列项
                        if (newQueueItems.length > 0) {
                            setActiveQueueItemAction(newQueueItems[0].id);
                            updateQueueItemAction(newQueueItems[0].id, { status: QueueItemStatus.COMPLETED });
                            ImageRepository.setActiveFileId(newQueueItems[0].id);
                        }
                    }
                }
                
                // 上传后立即触发保存
                setTimeout(() => {
                    AutoSaveService.saveCurrentState();
                }, 500);
            }
        }
    } as DropzoneOptions);

    const calculateEditorSize = (): ISize => {
        if (windowSize) {
            const leftTabWidth = leftTabStatus ? Settings.SIDE_NAVIGATION_BAR_WIDTH_OPEN_PX : Settings.SIDE_NAVIGATION_BAR_WIDTH_CLOSED_PX;
            const rightTabWidth = rightTabStatus ? Settings.SIDE_NAVIGATION_BAR_WIDTH_OPEN_PX : Settings.SIDE_NAVIGATION_BAR_WIDTH_CLOSED_PX;
            return {
                width: windowSize.width - leftTabWidth - rightTabWidth,
                height: windowSize.height - Settings.TOP_NAVIGATION_BAR_HEIGHT_PX
                    - Settings.EDITOR_BOTTOM_NAVIGATION_BAR_HEIGHT_PX - Settings.EDITOR_TOP_NAVIGATION_BAR_HEIGHT_PX,
            }
        }
        else
            return null;
    };

    const leftSideBarButtonOnClick = () => {
        // 如果左侧导航栏关闭，则打开并显示图像
        if (!leftTabStatus) {
            setLeftTabStatus(true);
            setShowQueueList(false);
            ContextManager.switchCtx(ContextType.LEFT_NAVBAR);
        }
        // 如果左侧导航栏打开且当前显示图像，则关闭导航栏
        else if (leftTabStatus && !showQueueList) {
            setLeftTabStatus(false);
            ContextManager.restoreCtx();
        }
        // 如果左侧导航栏打开但显示队列，则切换到图像
        else {
            setShowQueueList(false);
        }
    };

    const queueButtonOnClick = () => {
        // 如果左侧导航栏关闭，则打开并显示队列
        if (!leftTabStatus) {
            setLeftTabStatus(true);
            setShowQueueList(true);
            ContextManager.switchCtx(ContextType.LEFT_NAVBAR);
        }
        // 如果左侧导航栏打开且当前显示队列，则关闭导航栏
        else if (leftTabStatus && showQueueList) {
            setLeftTabStatus(false);
            setShowQueueList(false);
            ContextManager.restoreCtx();
        }
        // 如果左侧导航栏打开但显示图像，则切换到队列
        else {
            setShowQueueList(true);
        }
    };

    const leftSideBarCompanionRender = () => {
        return <>
            <VerticalEditorButton
                label={currentTexts.images}
                image={'/ico/camera.png'}
                imageAlt={'images'}
                onClick={leftSideBarButtonOnClick}
                isActive={leftTabStatus && !showQueueList}
                style={{top: '81px'}}
            />
            <VerticalEditorButton
                label={currentTexts.queue}
                image={'/ico/files.png'}
                imageAlt={'queue'}
                onClick={queueButtonOnClick}
                isActive={leftTabStatus && showQueueList}
                style={{top: '160px'}}
            />
            <div className='VersionWatermark' onClick={() => updateActivePopupTypeAction(PopupWindowType.CHANGELOG)}>v1.2.0</div>
        </>
    };

    const leftSideBarRender = () => {
        return showQueueList ? <QueueList/> : <ImagesList/>
    };

    const rightSideBarButtonOnClick = () => {
        // 如果右侧导航栏关闭，则打开并显示标签
        if (!rightTabStatus) {
            setRightTabStatus(true);
            setShowInferenceResults(false);
            ContextManager.switchCtx(ContextType.RIGHT_NAVBAR);
        }
        // 如果右侧导航栏打开且当前显示标签，则关闭导航栏
        else if (rightTabStatus && !showInferenceResults) {
            setRightTabStatus(false);
            ContextManager.restoreCtx();
        }
        // 如果右侧导航栏打开但显示推理结果，则切换到标签
        else {
            setShowInferenceResults(false);
        }
    };

    const inferenceResultsButtonOnClick = () => {
        // 如果右侧导航栏关闭，则打开并显示推理结果
        if (!rightTabStatus) {
            setRightTabStatus(true);
            setShowInferenceResults(true);
            ContextManager.switchCtx(ContextType.RIGHT_NAVBAR);
        }
        // 如果右侧导航栏打开且当前显示推理结果，则关闭导航栏
        else if (rightTabStatus && showInferenceResults) {
            setRightTabStatus(false);
            setShowInferenceResults(false);
            ContextManager.restoreCtx();
        }
        // 如果右侧导航栏打开但显示标签，则切换到推理结果
        else {
            setShowInferenceResults(true);
        }
    };

    const rightSideBarCompanionRender = () => {
        return <>
            <VerticalEditorButton
                label={currentTexts.labels}
                image={'/ico/tags.png'}
                imageAlt={'labels'}
                onClick={rightSideBarButtonOnClick}
                isActive={rightTabStatus && !showInferenceResults}
                style={{top: '81px'}}
            />
            <InferenceResultsButton 
                onToggle={inferenceResultsButtonOnClick}
                isActive={rightTabStatus && showInferenceResults}
            />
        </>
    };

    const rightSideBarRender = () => {
        return showInferenceResults ? <InferenceResultsView/> : <LabelsToolkit/>
    };

    return (
        <div className='EditorContainer'>
            <SideNavigationBar
                direction={Direction.LEFT}
                isOpen={leftTabStatus}
                isWithContext={activeContext === ContextType.LEFT_NAVBAR}
                renderCompanion={leftSideBarCompanionRender}
                renderContent={leftSideBarRender}
                key='left-side-navigation-bar'
            />
            <div 
                {...getRootProps({
                    className: `EditorWrapper ${isVideoMode ? 'VideoMode' : ''} ${isDragActive ? 'drag-active' : ''}`,
                    onMouseDown: (e) => {
                        // 只有在非拖拽状态下才切换上下文
                        if (!isDragActive) {
                            ContextManager.switchCtx(ContextType.EDITOR);
                        }
                    }
                })}
                key='editor-wrapper'
            >
                <input {...getInputProps()} style={{ display: 'none' }} />
                {projectType === ProjectType.OBJECT_DETECTION && <EditorTopNavigationBar
                    key='editor-top-navigation-bar'
                />}
                {isVideoMode && activeVideo ? (
                    // 视频编辑模式
                    <VideoEditor
                        editorSize={calculateEditorSize()}
                        key='video-editor'
                    />
                ) : imagesData.length > 0 && activeImageIndex < imagesData.length && imagesData[activeImageIndex] ? (
                    // 图片编辑模式
                    <>
                        <Editor
                            size={calculateEditorSize()}
                            imageData={imagesData[activeImageIndex]}
                            key='editor'
                        />
                        <EditorBottomNavigationBar
                            imageData={imagesData[activeImageIndex]}
                            size={calculateEditorSize()}
                            totalImageCount={imagesData.length}
                            key='editor-bottom-navigation-bar'
                        />
                    </>
                ) : (
                    <div className={`EmptyProjectView ${isDragActive ? 'drag-active' : ''}`}>
                        <div className='EmptyProjectContent'>
                            <img
                                draggable={false}
                                alt={'empty-project'}
                                src={'ico/box-opened.png'}
                            />
                            <h2>{currentTexts.welcomeTitle}</h2>
                            <p>{isDragActive ? currentTexts.dragActiveMessage : currentTexts.welcomeDescription}</p>
                        </div>
                    </div>
                )}
            </div>
            <SideNavigationBar
                direction={Direction.RIGHT}
                isOpen={rightTabStatus}
                isWithContext={activeContext === ContextType.RIGHT_NAVBAR}
                renderCompanion={rightSideBarCompanionRender}
                renderContent={rightSideBarRender}
                key='right-side-navigation-bar'
            />
        </div>
    );
};

const mapDispatchToProps = {
    addImageDataAction: addImageData,
    updateImageDataAction: updateImageData,
    updateActiveImageIndexAction: updateActiveImageIndex,
    updateActivePopupTypeAction: updateActivePopupType,
    addVideoDataAction: addVideoData,
    updateVideoModeAction: updateVideoMode,
    addQueueItemsAction: addQueueItems,
    setActiveQueueItemAction: setActiveQueueItem,
    updateQueueItemAction: updateQueueItem
};

const mapStateToProps = (state: AppState) => ({
    windowSize: state.general.windowSize,
    activeImageIndex: state.labels.activeImageIndex,
    imagesData: state.labels.imagesData,
    activeContext: state.general.activeContext,
    projectType: state.general.projectData.type,
    language: state.general.language,
    isVideoMode: state.video?.isVideoMode || false,
    activeVideo: state.video?.activeVideo || null,
    queueItems: state.queue?.items || [],
    activeQueueItemId: state.queue?.activeQueueItemId || null
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditorContainer);