import { ContextType } from '../../../data/enums/ContextType';
import './EditorTopNavigationBar.scss';
import React, { useEffect, useMemo, useCallback } from 'react';
import classNames from 'classnames';
import { AppState } from '../../../store';
import { connect } from 'react-redux';
import { updateCrossHairVisibleStatus, updateImageDragModeStatus } from '../../../store/general/actionCreators';
import { GeneralSelector } from '../../../store/selectors/GeneralSelector';
import { ViewPointSettings } from '../../../settings/ViewPointSettings';
import { ImageButton } from '../../Common/ImageButton/ImageButton';
import { ViewPortActions } from '../../../logic/actions/ViewPortActions';
import { LabelsSelector } from '../../../store/selectors/LabelsSelector';
import { LabelType } from '../../../data/enums/LabelType';
import { AISelector } from '../../../store/selectors/AISelector';
import { updateActiveLabelType, updateActiveLabelViewType } from '../../../store/labels/actionCreators';
import { ISize } from '../../../interfaces/ISize';
import { AIActions } from '../../../logic/actions/AIActions';
import { Fade, styled, Tooltip, tooltipClasses, TooltipProps } from '@mui/material';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {EditorModel} from '../../../staticModels/EditorModel';
import { ImageUtil } from '../../../utils/ImageUtil';
import { updateFullImageInferenceStatus, toggleImageAILabelsVisibility, addInferenceHistory } from '../../../store/ai/actionCreators';
import { AIDetectionActions } from '../../../logic/actions/AIDetectionActions';
import { DetectionAPIDetector } from '../../../ai/DetectionAPIDetector';
import { AIStateStorageManager } from '../../../utils/AIStateStorageManager';
import { AIModelsSelector } from '../../../store/selectors/AIModelsSelector';
import { EditorActions } from '../../../logic/actions/EditorActions';
const BUTTON_SIZE: ISize = { width: 30, height: 30 };
const BUTTON_PADDING: number = 10;

const StyledTooltip = styled(({ className, ...props }: TooltipProps) => (
    <Tooltip {...props} classes={{ popper: className }} />
  ))(({ theme }) => ({
    [`& .${tooltipClasses.tooltip}`]: {
        backgroundColor: '#171717',
        color: '#ffffff',
        boxShadow: theme.shadows[1],
        fontSize: 12,
        maxWidth: 200,
        textAlign: 'center'
    },
  }));

const getButtonWithTooltip = (
    key: string,
    tooltipMessage: string,
    imageSrc: string,
    imageAlt: string,
    isActive: boolean,
    href?: string,
    onClick?: () => any,
    isDisabled?: boolean
): React.ReactElement => {
    return <StyledTooltip
        key={key}
        disableFocusListener={true}
        title={tooltipMessage}
        TransitionComponent={Fade}
        TransitionProps={{ timeout: 600 }}
        placement='bottom'
    >
        <div>
            <ImageButton
                buttonSize={BUTTON_SIZE}
                padding={BUTTON_PADDING}
                image={imageSrc}
                imageAlt={imageAlt}
                href={href}
                onClick={isDisabled ? undefined : onClick}
                isActive={isActive}
                isDisabled={isDisabled}
            />
        </div>
    </StyledTooltip>;
};

interface IProps {
    activeContext: ContextType;
    updateImageDragModeStatusAction: (imageDragMode: boolean) => any;
    updateCrossHairVisibleStatusAction: (crossHairVisible: boolean) => any;
    updateFullImageInferenceStatus: (isInProgress: boolean) => any;
    toggleImageAILabelsVisibility: (imageId: string) => any;
    addInferenceHistory: (imageId: string, detectedCount: number, success?: boolean) => any;
    imageDragMode: boolean;
    crossHairVisible: boolean;
    isFullImageInferenceInProgress: boolean;
    imageAIStates: Map<string, { aiLabelsVisible: boolean; segmentationLabelsVisible: boolean; inferenceHistory: Array<any> }>;
    activeLabelType: LabelType;
    language: Language;
    isAIDisabled: boolean;
    activeImageIndex: number;
    aiModels: any;
    updateActiveLabelType: (activeLabelType: LabelType) => any;
    updateActiveLabelViewType: (activeLabelViewType: LabelType) => any;
}

const EditorTopNavigationBar: React.FC<IProps> = React.memo((
    {
        activeContext,
        updateImageDragModeStatusAction,
        updateCrossHairVisibleStatusAction,
        updateFullImageInferenceStatus,
        toggleImageAILabelsVisibility,
        addInferenceHistory,
        imageDragMode,
        crossHairVisible,
        isFullImageInferenceInProgress,
        imageAIStates,
        activeLabelType,
        language,
        isAIDisabled,
        activeImageIndex,
        aiModels,
        updateActiveLabelType,
        updateActiveLabelViewType,
    }) => {
    const currentTexts = useMemo(() => LanguageConfig[language], [language]);
    
    // 缓存的辅助函数：根据模型类型获取可用的AI模型
    const getModelByType = useCallback((modelType: 'detection' | 'segmentation') => {
        const modelOfType = AIModelsSelector.getActiveModelByType(aiModels, modelType);
        if (modelOfType) {
            return modelOfType;
        }
        return null;
    }, [aiModels]);
    
    // 缓存的辅助函数：检查是否有可用的检测模型（只检查用户接入的模型）
    const hasDetectionModel = useMemo(() => {
        return AIModelsSelector.hasModelsOfType(aiModels, 'detection') || DetectionAPIDetector.isEnabled();
    }, [aiModels]);
    
    // 辅助函数：检查图片是否真的有AI生成的标签
    const hasAILabels = (imageData: any): boolean => {
        if (!imageData || !imageData.labelRects) return false;
        return imageData.labelRects.some((rect: any) => rect.isCreatedByAI);
    };
    
    // 新的设计不需要复杂的状态同步，因为状态完全基于用户操作和分割历史
    const getClassName = () => {
        return classNames(
            'EditorTopNavigationBar',
            {
                'with-context': activeContext === ContextType.EDITOR
            }
        );
    };

    const imageDragOnClick = useCallback(() => {
        // 切换标签拖拽模式
        updateImageDragModeStatusAction(!imageDragMode);
        // 如果开启拖拽模式，自动关闭十字光标
        if (!imageDragMode && crossHairVisible) {
            updateCrossHairVisibleStatusAction(false);
        }
    }, [imageDragMode, crossHairVisible, updateImageDragModeStatusAction, updateCrossHairVisibleStatusAction]);

    const crossHairOnClick = useCallback(() => {
        // 切换十字光标
        updateCrossHairVisibleStatusAction(!crossHairVisible);
        // 如果开启十字光标，自动关闭拖拽模式
        if (!crossHairVisible && imageDragMode) {
            updateImageDragModeStatusAction(false);
        }
    }, [crossHairVisible, imageDragMode, updateCrossHairVisibleStatusAction, updateImageDragModeStatusAction]);

    // 缓存的目标检测调用函数
    const fullImageDetectionOnClick = useCallback(() => {
        const activeImageData = LabelsSelector.getActiveImageData();
        
        if (!activeImageData) {
            console.error('❌ 没有活动图像数据');
            return;
        }

        if (isFullImageInferenceInProgress) {
            console.log('🔄 检测正在进行中，忽略点击');
            return;
        }

        const imageAIState = imageAIStates.get(activeImageData.id) || { 
            aiLabelsVisible: false, 
            inferenceHistory: [] 
        };

        // 检查当前图片是否有AI标签（预计算避免重复检查）
        const hasAILabels = activeImageData.labelRects.some((rect: any) => rect.isCreatedByAI);
        
        // 如果点击时要显示标签（从闭眼到睁眼）
        if (!imageAIState.aiLabelsVisible) {
            if (!hasAILabels) {
                // 检查是否有可用的检测模型
                const detectionModel = getModelByType('detection');
                if (detectionModel === null) {
                    if (!DetectionAPIDetector.isEnabled()) return;
                } else {
                    const aiModel = detectionModel as any;
                    if (!aiModel.url) return;
                    // 将 Redux 里存的 URL 同步给 DetectionAPIDetector
                    DetectionAPIDetector.setConfig({ url: aiModel.url, enabled: true });
                }

                // 设置检测状态为进行中
                updateFullImageInferenceStatus(true);

                // 使用微任务调用检测，避免阻塞主线程
                queueMicrotask(() => {
                    AIDetectionActions.detectObjects(activeImageData);
                });
            } else {
                // 直接切换显示状态，立即响应
                toggleImageAILabelsVisibility(activeImageData.id);
                // 立即触发canvas重绘，确保与标签页同步
                queueMicrotask(() => {
                    EditorActions.fullRender();
                });
            }
        } else {
            // 隐藏标签，立即响应
            toggleImageAILabelsVisibility(activeImageData.id);
            // 立即触发canvas重绘，确保与标签页同步
            queueMicrotask(() => {
                EditorActions.fullRender();
            });
        }
    }, [imageAIStates, isFullImageInferenceInProgress, getModelByType, updateFullImageInferenceStatus, toggleImageAILabelsVisibility]);

    // 标注工具点击处理 - 统一的处理函数
    const onToolClick = useCallback((toolType: LabelType) => {
        // 同时切换工具类型和视图类型，实现工具与标签页的完全绑定
        updateActiveLabelType(toolType);
        updateActiveLabelViewType(toolType);
    }, [updateActiveLabelType, updateActiveLabelViewType]);


    const withAI = (
        ((activeLabelType === LabelType.RECT || activeLabelType === LabelType.ALL) && AISelector.isAISSDObjectDetectorModelLoaded()) ||
        ((activeLabelType === LabelType.RECT || activeLabelType === LabelType.ALL) && AISelector.isAIYOLOObjectDetectorModelLoaded()) ||
        ((activeLabelType === LabelType.RECT || activeLabelType === LabelType.ALL) && AISelector.isRoboflowAPIModelLoaded()) ||
        (activeLabelType === LabelType.POINT && AISelector.isAIPoseDetectorModelLoaded())
    )

    return (
        <div className={getClassName()}>
            <div className='ButtonWrapper'>
                {
                    getButtonWithTooltip(
                        'zoom-in',
                        currentTexts.editorTopNavBar.zoomIn,
                        'ico/zoom-in.png',
                        'zoom-in',
                        false,
                        undefined,
                        () => ViewPortActions.zoomIn()
                    )
                }
                {
                    getButtonWithTooltip(
                        'zoom-out',
                        currentTexts.editorTopNavBar.zoomOut,
                        'ico/zoom-out.png',
                        'zoom-out',
                        false,
                        undefined,
                        () => ViewPortActions.zoomOut()
                    )
                }
                {
                    getButtonWithTooltip(
                        'zoom-fit',
                        currentTexts.editorTopNavBar.fitImage,
                        'ico/zoom-fit.png',
                        'zoom-fit',
                        false,
                        undefined,
                        () => ViewPortActions.setDefaultZoom()
                    )
                }
                {
                    getButtonWithTooltip(
                        'zoom-max',
                        currentTexts.editorTopNavBar.maxZoom,
                        'ico/zoom-max.png',
                        'zoom-max',
                        false,
                        undefined,
                        () => ViewPortActions.setOneForOneZoom()
                    )
                }
            </div>
            <div className='ButtonWrapper'>
                {
                    getButtonWithTooltip(
                        'label-drag-mode',
                        imageDragMode ? currentTexts.editorTopNavBar.imageDragModeOn : currentTexts.editorTopNavBar.imageDragModeOff,
                        'ico/hand.png',
                        'label-drag-mode',
                        imageDragMode,
                        undefined,
                        imageDragOnClick
                    )
                }
                {
                    getButtonWithTooltip(
                        'cursor-cross-hair',
                        crossHairVisible ? currentTexts.editorTopNavBar.crossHairOn : currentTexts.editorTopNavBar.crossHairOff,
                        'ico/cross-hair.png',
                        'cross-hair',
                        crossHairVisible,
                        undefined,
                        crossHairOnClick
                    )
                }
            </div>
            <div className='ButtonWrapper'>
                {
                    getButtonWithTooltip(
                        'tool-all',
                        currentTexts.labelTypes?.all || '全部标签',
                        'ico/all.png',
                        'tool-all',
                        activeLabelType === LabelType.ALL,
                        undefined,
                        () => onToolClick(LabelType.ALL)
                    )
                }
                {
                    getButtonWithTooltip(
                        'tool-rect',
                        currentTexts.labelTypes?.rect || '矩形框',
                        'ico/rectangle.png',
                        'tool-rect',
                        activeLabelType === LabelType.RECT,
                        undefined,
                        () => onToolClick(LabelType.RECT)
                    )
                }
                {
                    getButtonWithTooltip(
                        'tool-point',
                        currentTexts.labelTypes?.point || '点',
                        'ico/point.png',
                        'tool-point',
                        activeLabelType === LabelType.POINT,
                        undefined,
                        () => onToolClick(LabelType.POINT)
                    )
                }
                {
                    getButtonWithTooltip(
                        'tool-line',
                        currentTexts.labelTypes?.line || '线条',
                        'ico/line.png',
                        'tool-line',
                        activeLabelType === LabelType.LINE,
                        undefined,
                        () => onToolClick(LabelType.LINE)
                    )
                }
                {/* Polygon tool hidden - segmentation not available
                {
                    getButtonWithTooltip(
                        'tool-polygon',
                        currentTexts.labelTypes?.polygon || '多边形',
                        'ico/polygon.png',
                        'tool-polygon',
                        activeLabelType === LabelType.POLYGON,
                        undefined,
                        () => onToolClick(LabelType.POLYGON)
                    )
                }
                */}
            </div>
            <div className='ButtonWrapper'>
{useMemo(() => {
                    const activeImageData = LabelsSelector.getActiveImageData();
                    const detectionAvailable = hasDetectionModel;
                    
                    // 检测按钮状态完全独立，不依赖分割功能
                    let buttonText, buttonIcon, isActive, isDisabled;
                    
                    if (!detectionAvailable) {
                        // 没有检测模型时
                        buttonText = currentTexts.editorTopNavBar.cannotDetect;
                        buttonIcon = 'ico/eye-slash.png';
                        isActive = false;
                        isDisabled = true;
                    } else if (isFullImageInferenceInProgress) {
                        // 检测进行中
                        buttonText = currentTexts.editorTopNavBar.detectionInProgress;
                        buttonIcon = 'ico/eye.png';
                        isActive = true;
                        isDisabled = false;
                    } else {
                        // 检测可用时，检查当前图片是否有AI标签来决定按钮状态
                        if (activeImageData) {
                            const imageAIState = imageAIStates.get(activeImageData.id) || { 
                                aiLabelsVisible: false,
                                segmentationLabelsVisible: false,
                                inferenceHistory: [] 
                            };
                            
                            // 检查是否真的有检测产生的AI标签（排除分割标签）
                            const hasActualDetectionLabels = activeImageData.labelRects?.some(rect => rect.isCreatedByAI) ||
                                                            activeImageData.labelPoints?.some(point => point.isCreatedByAI) ||
                                                            activeImageData.labelLines?.some(line => line.isCreatedByAI);
                            // 注意：多边形标签主要由分割产生，所以不包含在检测标签检查中
                            
                            if (imageAIState.aiLabelsVisible && hasActualDetectionLabels) {
                                // 当前显示检测标签，按钮为"关闭"状态
                                buttonText = currentTexts.editorTopNavBar.disableDetection;
                                buttonIcon = 'ico/eye.png';
                                isActive = true;
                            } else if (hasActualDetectionLabels && !imageAIState.aiLabelsVisible) {
                                // 有检测标签但未显示，按钮为"开启"状态
                                buttonText = currentTexts.editorTopNavBar.enableDetection;
                                buttonIcon = 'ico/eye-off.png';
                                isActive = false;
                            } else {
                                // 没有检测标签，按钮为"检测"状态
                                buttonText = currentTexts.editorTopNavBar.enableDetection;
                                buttonIcon = 'ico/eye-off.png';
                                isActive = false;
                            }
                        } else {
                            // 没有活动图片时
                            buttonText = currentTexts.editorTopNavBar.enableDetection;
                            buttonIcon = 'ico/eye-off.png';
                            isActive = false;
                        }
                        isDisabled = false;
                    }
                    
                    return getButtonWithTooltip(
                        'full-image-detection',
                        buttonText,
                        buttonIcon,
                        'full-image-detection',
                        isActive,
                        undefined,
                        isDisabled ? undefined : fullImageDetectionOnClick,
                        isDisabled
                    );
                }, [hasDetectionModel, isFullImageInferenceInProgress, imageAIStates, activeImageIndex, currentTexts, fullImageDetectionOnClick])}
            </div>
            {withAI && <div className='ButtonWrapper'>
                    {
                        getButtonWithTooltip(
                            'accept-all',
                            currentTexts.editorTopNavBar.acceptAllDetections,
                            'ico/accept-all.png',
                            'accept-all',
                            false,
                            undefined,
                            () => AIActions.acceptAllSuggestedLabels(LabelsSelector.getActiveImageData())
                        )
                    }
                    {
                        getButtonWithTooltip(
                            'reject-all',
                            currentTexts.editorTopNavBar.rejectAllDetections,
                            'ico/reject-all.png',
                            'reject-all',
                            false,
                            undefined,
                            () => AIActions.rejectAllSuggestedLabels(LabelsSelector.getActiveImageData())
                        )
                    }
                </div>}
            {/* InferenceToggle hidden - segmentation not available */}
            {/* <InferenceToggle /> */}
        </div>
    );
});

const mapDispatchToProps = {
    updateImageDragModeStatusAction: updateImageDragModeStatus,
    updateCrossHairVisibleStatusAction: updateCrossHairVisibleStatus,
    updateFullImageInferenceStatus,
    toggleImageAILabelsVisibility,
    addInferenceHistory,
    updateActiveLabelType,
    updateActiveLabelViewType
};

const mapStateToProps = (state: AppState) => ({
    activeContext: state.general.activeContext,
    imageDragMode: state.general.imageDragMode,
    crossHairVisible: state.general.crossHairVisible,
    isFullImageInferenceInProgress: state.ai.isFullImageInferenceInProgress,
    imageAIStates: state.ai.imageAIStates,
    activeLabelType: state.labels.activeLabelType,
    language: state.general.language,
    isAIDisabled: state.ai.isAIDisabled,
    activeImageIndex: state.labels.activeImageIndex,
    aiModels: state
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditorTopNavigationBar);
