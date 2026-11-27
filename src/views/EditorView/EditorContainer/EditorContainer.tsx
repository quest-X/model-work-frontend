import {useVideoInferenceFlow} from './useVideoInferenceFlow';
import React, {useState, useEffect, useCallback, useRef} from 'react';
import {connect} from 'react-redux';
import {Direction} from '../../../data/enums/Direction';
import {ISize} from '../../../interfaces/ISize';
import {Settings} from '../../../settings/Settings';
import {AppState} from '../../../store';
import {ImageData} from '../../../store/labels/types';
import {VideoData} from '../../../store/video/types';
import ImagesList from '../SideNavigationBar/ImagesList/ImagesList';
import QueueList from '../SideNavigationBar/QueueList/QueueList';
import HistoryTasks from '../SideNavigationBar/HistoryTasks/HistoryTasks';
import LabelsToolkit from '../SideNavigationBar/LabelsToolkit/LabelsToolkit';
import {SideNavigationBar} from '../SideNavigationBar/SideNavigationBar';
import {VerticalEditorButton} from '../VerticalEditorButton/VerticalEditorButton';
import './EditorContainer.scss';
import {ContextManager} from '../../../logic/hotkey/ContextManager';
import {ContextType} from '../../../data/enums/ContextType';
import {GeneralSelector} from '../../../store/selectors/GeneralSelector';
import EditorTopNavigationBar from '../EditorTopNavigationBar/EditorTopNavigationBar';
import {ProjectType} from '../../../data/enums/ProjectType';
import {useDropzone, DropzoneOptions} from 'react-dropzone';
import {updateActivePopupType} from '../../../store/general/actionCreators';
import {addQueueItems, updateQueueItem} from '../../../store/queue/actionCreators';
import {QueueActions} from '../../../logic/actions/QueueActions';
import {QueueItem, QueueItemType} from '../../../store/queue/types';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {sortBy} from 'lodash';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import InferenceResultsButton from '../InferenceResultsButton/InferenceResultsButton';
import InferenceResultsView from '../InferenceResultsView/InferenceResultsView';
import BatchStatisticsView from '../BatchStatisticsView/BatchStatisticsView';
import {AutoSaveService} from '../../../services/AutoSaveService';
import {TaskManagerButton} from '../TaskManager/TaskManagerButton';
import {TaskManagerPanel} from '../TaskManager/TaskManagerPanel';
import {EditorModel} from '../../../staticModels/EditorModel';
import {store} from '../../../index';
import {PendingImportFiles} from '../../../utils/PendingImportFiles';
import {DataBatchSyncService} from '../../../services/DataBatchSyncService';
import {EditorViewportContent} from './EditorViewportContent';
import {useDatasetDirtyTracking} from './useDatasetDirtyTracking';
import {createDroppedMediaQueueItems, VideoImportProgress} from './EditorFileImport';
import {version as appVersion} from '../../../../package.json';

import {appEdition} from '../../../utils/AppEdition';
import {SidePanelOpenState, useAutoCollapseSidePanels} from './useAutoCollapseSidePanels';

interface IProps {
    windowSize: ISize;
    activeImageIndex: number;
    imagesData: ImageData[];
    activeContext: ContextType;
    projectType: ProjectType;
    language: Language;
    isVideoMode: boolean;
    inferenceInProgress: boolean;
    activeVideo: VideoData | null;
    queueItems: QueueItem[];
    activeQueueItemId: string | null;
    updateActivePopupTypeAction: (activePopupType: PopupWindowType) => void;
    addQueueItemsAction: (items: QueueItem[]) => void;
    updateQueueItemAction: (itemId: string, updates: Partial<QueueItem>) => void;
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
        inferenceInProgress,
        activeVideo,
        queueItems,
        activeQueueItemId,
        updateActivePopupTypeAction,
        addQueueItemsAction,
        updateQueueItemAction
    }) => {
    const [leftTabStatus, setLeftTabStatus] = useState(true);
    const [rightTabStatus, setRightTabStatus] = useState(true);
    const [showInferenceResults, setShowInferenceResults] = useState<boolean>(false);
    const [showBatchStatistics, setShowBatchStatistics] = useState<boolean>(false);
    const [leftPanel, setLeftPanel] = useState<'images' | 'queue' | 'history'>('images');
    const previewImageId = useVideoInferenceFlow(activeVideo?.id, inferenceInProgress,
        () => { setLeftTabStatus(true); setLeftPanel('images'); setRightTabStatus(true);
            setShowBatchStatistics(false); setShowInferenceResults(true); },
        () => { setRightTabStatus(true); setShowBatchStatistics(true); setShowInferenceResults(false); }, activeVideo?.fps);
    const [isWindowDragActive, setIsWindowDragActive] = useState(false);
    const [videoProcessing, setVideoProcessing] = useState<VideoImportProgress | null>(null);

    // Task Manager 浮动面板开关 + 固定状态 + 按钮 ref
    const [taskPanelOpen, setTaskPanelOpen] = useState(false);
    const [taskPanelPinned, setTaskPanelPinned] = useState(false);
    const taskButtonRef = useRef<HTMLDivElement>(null);
    const taskClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 画布被挤到不可用时自动收起左右内容侧栏，空间恢复后重新展开此前被自动折叠的面板。
    const applyAutoSidePanelState = (next: SidePanelOpenState, previous: SidePanelOpenState) => {
        setLeftTabStatus(next.leftTabStatus);
        setRightTabStatus(next.rightTabStatus);
        const closedPanel = (previous.leftTabStatus && !next.leftTabStatus)
            || (previous.rightTabStatus && !next.rightTabStatus);
        if (!closedPanel) return;
        // 侧栏各自压过一层上下文历史，回退到编辑器上下文，避免快捷键继续被侧栏拦截。
        for (let attempt = 0; attempt < 2; attempt++) {
            const active = GeneralSelector.getActiveContext();
            if (active !== ContextType.LEFT_NAVBAR && active !== ContextType.RIGHT_NAVBAR) break;
            ContextManager.restoreCtx();
            if (GeneralSelector.getActiveContext() === active) break;
        }
    };
    useAutoCollapseSidePanels(
        windowSize?.width,
        {leftTabStatus, rightTabStatus},
        applyAutoSidePanelState
    );

    useDatasetDirtyTracking({
        activeQueueItemId,
        imagesData,
        queueItems,
        updateQueueItem: updateQueueItemAction,
    });

    const handleTaskButtonClick = useCallback(() => {
        if (taskClickTimer.current !== null) {
            // 双击：固定/取消固定
            clearTimeout(taskClickTimer.current);
            taskClickTimer.current = null;
            setTaskPanelOpen(true);
            setTaskPanelPinned(p => !p);
        } else {
            taskClickTimer.current = setTimeout(() => {
                taskClickTimer.current = null;
                // 单击：切换开关，关闭时清除固定
                setTaskPanelOpen(o => {
                    if (o) setTaskPanelPinned(false);
                    return !o;
                });
            }, 220);
        }
    }, []);

    // 监听 window 级别的拖拽，确保 canvas/Scrollbars 不会阻断 drop 事件
    useEffect(() => {
        let dragCounter = 0;
        const onDragEnter = () => { dragCounter++; setIsWindowDragActive(true); };
        const onDragLeave = () => { dragCounter--; if (dragCounter <= 0) { dragCounter = 0; setIsWindowDragActive(false); } };
        const onDrop = () => { dragCounter = 0; setIsWindowDragActive(false); };
        window.addEventListener('dragenter', onDragEnter);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('drop', onDrop);
        return () => {
            window.removeEventListener('dragenter', onDragEnter);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop', onDrop);
        };
    }, []);
    
    const currentTexts = LanguageConfig[language];
    
    // 批量推理完成后自动弹出统计面板
    useEffect(() => {
        const handleBatchComplete = (e: Event) => {
            if (isVideoMode) return;
            const count = (e as CustomEvent).detail?.count ?? 0;
            if (count > 2) {
                EditorModel.lastBatchInferenceImageCount = 0;
                setRightTabStatus(true);
                setShowBatchStatistics(true);
                setShowInferenceResults(false);
            }
        };
        window.addEventListener('batchInferenceComplete', handleBatchComplete);
        return () => window.removeEventListener('batchInferenceComplete', handleBatchComplete);
    }, [isVideoMode]);

    // 监听标注数据变化并触发自动保存
    // 5 秒防抖：只有 imagesData 引用变化（标注增删改）才触发，
    // 切帧(activeImageIndex)和切语言不触发保存。
    const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (imagesData.length > 0) {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }

            saveTimeoutRef.current = setTimeout(() => {
                AutoSaveService.saveCurrentState();
                saveTimeoutRef.current = null;
            }, 5000); // 5秒防抖，避免频繁保存
        }

        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = null;
            }
        };
    }, [imagesData]);

    // 拖拽上传功能 - 支持图片和视频（仅拖拽，不支持点击）
    // handleFileDrop 也被 QueueList 侧边栏的 opensight:drop-files 事件复用
    const handleFileDrop = useCallback(async (files: File[]) => {
            if (files.length > 0) {
                const sortedFiles = sortBy(files, (item: File) => item.name);

                // 标注文件优先：拦截并转交导入弹窗
                const ANNOTATION_EXTS = ['.json', '.txt', '.xml', '.zip'];
                const annotationFiles = sortedFiles.filter(f =>
                    ANNOTATION_EXTS.some(ext => f.name.toLowerCase().endsWith(ext))
                );
                if (annotationFiles.length > 0) {
                    PendingImportFiles.set(annotationFiles);
                    updateActivePopupTypeAction(PopupWindowType.IMPORT_ANNOTATIONS);
                    return;
                }

                const newQueueItems = await createDroppedMediaQueueItems(sortedFiles, setVideoProcessing);

                addQueueItemsAction(newQueueItems);

                // 始终自动切换到新上传的第一个队列项
                if (newQueueItems.length > 0) {
                    await QueueActions.switchToQueueItem(newQueueItems[0], imagesData);
                }

                const activeBatchData = store.getState().labels.imagesData;
                const labelNames = store.getState().labels.labels;
                newQueueItems
                    .filter(item => item.type !== QueueItemType.VIDEO)
                    .forEach((item, index) => {
                        DataBatchSyncService.syncQueueItem(
                            item,
                            index === 0 ? activeBatchData : [],
                            labelNames,
                        ).catch(() => undefined);
                    });
                
                // 上传后立即触发保存
                setTimeout(() => {
                    AutoSaveService.saveCurrentState();
                }, 500);
            }
    }, [imagesData, addQueueItemsAction, updateActivePopupTypeAction]);

    const {getRootProps, getInputProps, isDragActive, open: openFileDialog} = useDropzone({
        noClick: true,
        noKeyboard: true,
        accept: {
            'image/*': ['.jpeg', '.png', '.jpg'],
            'video/*': ['.mp4', '.mov', '.avi', '.webm'],
            'application/json': ['.json'],
            'text/plain': ['.txt'],
            'application/xml': ['.xml'],
            'text/xml': ['.xml'],
            'application/zip': ['.zip'],
            'application/x-zip-compressed': ['.zip'],
            'application/octet-stream': ['.zip'],
        },
        onDrop: handleFileDrop,
    } as DropzoneOptions);

    useEffect(() => {
        const handler = (e: Event) => handleFileDrop((e as CustomEvent<File[]>).detail);
        window.addEventListener('opensight:drop-files', handler);
        return () => window.removeEventListener('opensight:drop-files', handler);
    }, [handleFileDrop]);

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

    const selectLeftPanel = (panel: 'images' | 'queue' | 'history') => {
        if (!leftTabStatus) {
            setLeftTabStatus(true);
            setLeftPanel(panel);
            ContextManager.switchCtx(ContextType.LEFT_NAVBAR);
        }
        else if (leftPanel === panel) {
            setLeftTabStatus(false);
            ContextManager.restoreCtx();
        }
        else {
            setLeftPanel(panel);
        }
    };

    const leftSideBarCompanionRender = () => {
        return <>
            <VerticalEditorButton
                label={currentTexts.images}
                image={'/ico/camera.png'}
                imageAlt={'images'}
                onClick={() => selectLeftPanel('images')}
                isActive={leftTabStatus && leftPanel === 'images'}
                style={{top: '81px'}}
            />
            <VerticalEditorButton
                label={language === Language.CHINESE ? '工作任务' : 'Work Tasks'}
                image={'/ico/files.png'}
                imageAlt={'tasks'}
                onClick={() => selectLeftPanel(leftPanel === 'images' ? 'queue' : leftPanel)}
                isActive={leftTabStatus && leftPanel !== 'images'}
                style={{top: '167px'}}
            />
            <div className='VersionWatermark' onClick={() => updateActivePopupTypeAction(PopupWindowType.CHANGELOG)}>
                v{appVersion}({appEdition})
            </div>
        </>
    };

    const leftSideBarRender = () => {
        if (leftPanel === 'images') return <ImagesList/>;
        return <div className='QueueHistoryPanel'>
            <div className='QueueHistoryPanel__header'>
                <div className='QueueHistoryPanel__tabs' role='group'
                    aria-label={language === Language.CHINESE ? '任务视图' : 'Task views'}>
                    <button type='button' aria-pressed={leftPanel === 'queue'}
                        onClick={() => setLeftPanel('queue')}>
                        {currentTexts.queue}
                    </button>
                    <button type='button' aria-pressed={leftPanel === 'history'}
                        onClick={() => setLeftPanel('history')}>
                        {language === Language.CHINESE ? '历史任务' : 'Task History'}
                    </button>
                </div>
            </div>
            {leftPanel === 'queue' ? <QueueList/> :
                <HistoryTasks language={language} embedded/>}
        </div>;
    };

    type RightPanel = 'labels' | 'inference' | 'statistics';
    const activeRightPanel: RightPanel = showBatchStatistics ? 'statistics' : showInferenceResults ? 'inference' : 'labels';

    const switchRightPanel = (target: RightPanel) => {
        if (!rightTabStatus) {
            setRightTabStatus(true);
            ContextManager.switchCtx(ContextType.RIGHT_NAVBAR);
        } else if (activeRightPanel === target) {
            setRightTabStatus(false);
            ContextManager.restoreCtx();
            // reset
            setShowInferenceResults(false);
            setShowBatchStatistics(false);
            return;
        }
        setShowInferenceResults(target === 'inference');
        setShowBatchStatistics(target === 'statistics');
    };

    const rightSideBarButtonOnClick = () => switchRightPanel('labels');
    const inferenceResultsButtonOnClick = () => switchRightPanel('inference');
    const batchStatisticsButtonOnClick = () => switchRightPanel('statistics');

    const rightSideBarCompanionRender = () => {
        return <>
            <VerticalEditorButton
                label={currentTexts.labels}
                image={'/ico/tags.png'}
                imageAlt={'labels'}
                onClick={rightSideBarButtonOnClick}
                isActive={rightTabStatus && activeRightPanel === 'labels'}
                style={{top: '81px'}}
            />
            <InferenceResultsButton
                onToggle={inferenceResultsButtonOnClick}
                isActive={rightTabStatus && activeRightPanel === 'inference'}
            />
            <VerticalEditorButton
                label={language === Language.CHINESE ? '统计情况' : 'Statistics'}
                image={'/ico/stats.png'}
                imageAlt={'batch statistics'}
                onClick={batchStatisticsButtonOnClick}
                isActive={rightTabStatus && activeRightPanel === 'statistics'}
                style={{top: '253px'}}
            />
            <TaskManagerButton
                buttonRef={taskButtonRef}
                isActive={taskPanelOpen}
                isPinned={taskPanelPinned}
                onClick={handleTaskButtonClick}
            />
        </>
    };

    const rightSideBarRender = () => {
        if (showBatchStatistics) return <BatchStatisticsView/>;
        if (showInferenceResults) return <InferenceResultsView previewImageId={previewImageId}/>;
        return <LabelsToolkit/>;
    };

    const activeQueueItem = queueItems.find(item => item.id === activeQueueItemId);
    const isCameraMode = activeQueueItem?.type === QueueItemType.CAMERA;

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
                    className: `EditorWrapper ${isVideoMode ? 'VideoMode' : ''} ${isCameraMode ? 'CameraMode' : ''} ${isDragActive ? 'drag-active' : ''}`,
                    onMouseDown: () => {
                        // 只有在非拖拽状态下才切换上下文
                        if (!isDragActive) {
                            ContextManager.switchCtx(ContextType.EDITOR);
                        }
                    }
                })}
                key='editor-wrapper'
            >
                <input {...getInputProps()} style={{ display: 'none' }} />
                {/* 拖拽捕获层：当 canvas/Scrollbars 存在时确保 drop 事件能被 dropzone 接收。
                    top: 40px 让 EditorTopNavigationBar（高度即 40px）保留自己的背景，
                    避免拖拽时整条工具栏也被蓝色蒙层覆盖。 */}
                {isWindowDragActive && (
                    <div style={{
                        position: 'absolute',
                        top: projectType === ProjectType.OBJECT_DETECTION ? 40 : 0,
                        left: 0, right: 0, bottom: 0,
                        zIndex: 500, pointerEvents: 'all',
                        backgroundColor: isDragActive ? 'rgba(0, 120, 212, 0.08)' : 'transparent'
                    }} />
                )}
                {projectType === ProjectType.OBJECT_DETECTION && <EditorTopNavigationBar
                    key='editor-top-navigation-bar'
                />}
                <EditorViewportContent
                    activeQueueItem={activeQueueItem}
                    language={language}
                    isVideoMode={isVideoMode && !!activeVideo}
                    imageData={imagesData[activeImageIndex]}
                    totalImageCount={imagesData.length}
                    size={calculateEditorSize()}
                    videoProcessing={videoProcessing}
                    isDragActive={isDragActive}
                    openFileDialog={openFileDialog}
                />
            </div>
            <SideNavigationBar
                direction={Direction.RIGHT}
                isOpen={rightTabStatus}
                isWithContext={activeContext === ContextType.RIGHT_NAVBAR}
                renderCompanion={rightSideBarCompanionRender}
                renderContent={rightSideBarRender}
                key='right-side-navigation-bar'
            />
            {taskPanelOpen && (
                <TaskManagerPanel
                    onClose={() => { setTaskPanelOpen(false); setTaskPanelPinned(false); }}
                    excludeRef={taskButtonRef}
                    anchorRef={taskButtonRef}
                    pinned={taskPanelPinned}
                />
            )}
        </div>
    );
};

const mapDispatchToProps = {
    updateActivePopupTypeAction: updateActivePopupType,
    addQueueItemsAction: addQueueItems,
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
    inferenceInProgress: !!state.video?.isVideoMode && state.ai.isFullImageInferenceInProgress,
    activeVideo: state.video?.activeVideo || null,
    queueItems: state.queue?.items || [],
    activeQueueItemId: state.queue?.activeQueueItemId || null
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditorContainer);
