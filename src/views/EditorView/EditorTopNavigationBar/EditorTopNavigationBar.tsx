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
import { ImageData } from '../../../store/labels/types';
import { LabelType } from '../../../data/enums/LabelType';
import { AISelector } from '../../../store/selectors/AISelector';
import { updateActiveLabelType, updateActiveLabelViewType } from '../../../store/labels/actionCreators';
import { ISize } from '../../../interfaces/ISize';
import { AIActions } from '../../../logic/actions/AIActions';
import { Fade, styled, Switch, Tooltip, tooltipClasses, TooltipProps } from '@mui/material';
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

const IOSSwitch = styled(Switch)(() => ({
    width: 36,
    height: 20,
    padding: 0,
    '& .MuiSwitch-switchBase': {
        padding: 2,
        color: '#bbb',
        '&.Mui-checked': {
            transform: 'translateX(16px)',
            color: '#fff',
            '& + .MuiSwitch-track': {
                backgroundColor: '#2196f3',
                opacity: 1,
            },
        },
        '&.Mui-disabled': {
            color: '#555',
            '& + .MuiSwitch-track': {
                backgroundColor: '#333',
                opacity: 0.5,
            },
        },
    },
    '& .MuiSwitch-thumb': {
        width: 16,
        height: 16,
        boxShadow: 'none',
    },
    '& .MuiSwitch-track': {
        borderRadius: 10,
        backgroundColor: '#555',
        opacity: 1,
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
    imagesData: ImageData[];
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
        imagesData,
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

    // 确保检测模型可用的辅助函数
    const ensureDetectionModel = useCallback((): boolean => {
        const detectionModel = getModelByType('detection');
        if (detectionModel === null) {
            return DetectionAPIDetector.isEnabled();
        }
        const aiModel = detectionModel as any;
        if (!aiModel.url) return false;
        DetectionAPIDetector.setConfig({ url: aiModel.url, enabled: true });
        return true;
    }, [getModelByType]);

    // 缓存的目标检测调用函数
    const fullImageDetectionOnClick = useCallback(() => {
        const activeImageData = LabelsSelector.getActiveImageData();

        if (!activeImageData) return;
        if (isFullImageInferenceInProgress) return;

        // 检查是否有多选图像（选中数量 > 1）
        const selectedImages = imagesData.filter((img: ImageData) => img.isSelected);
        const isBatchMode = selectedImages.length > 1;

        if (isBatchMode) {
            // 批量模式：对所有选中的图像进行检测
            if (!ensureDetectionModel()) return;
            updateFullImageInferenceStatus(true);
            AIDetectionActions.detectBatch(selectedImages);
            return;
        }

        // 单张模式：原有逻辑
        const imageAIState = imageAIStates.get(activeImageData.id) || {
            aiLabelsVisible: false,
            inferenceHistory: []
        };

        const currentHasAILabels = activeImageData.labelRects.some((rect: any) => rect.isCreatedByAI);

        if (!imageAIState.aiLabelsVisible) {
            if (!currentHasAILabels) {
                if (!ensureDetectionModel()) return;
                updateFullImageInferenceStatus(true);
                queueMicrotask(() => {
                    AIDetectionActions.detectObjects(activeImageData);
                });
            } else {
                toggleImageAILabelsVisibility(activeImageData.id);
                queueMicrotask(() => { EditorActions.fullRender(); });
            }
        } else {
            toggleImageAILabelsVisibility(activeImageData.id);
            queueMicrotask(() => { EditorActions.fullRender(); });
        }
    }, [imageAIStates, imagesData, isFullImageInferenceInProgress, ensureDetectionModel, updateFullImageInferenceStatus, toggleImageAILabelsVisibility]);

    // 标注工具点击处理 - 统一的处理函数
    const onToolClick = useCallback((toolType: LabelType) => {
        // 同时切换工具类型和视图类型，实现工具与标签页的完全绑定
        updateActiveLabelType(toolType);
        updateActiveLabelViewType(toolType);
    }, [updateActiveLabelType, updateActiveLabelViewType]);

    // 推理结果显示/隐藏（eye 按钮）
    const toggleAILabelsOnClick = useCallback(() => {
        const activeImageData = LabelsSelector.getActiveImageData();
        if (!activeImageData) return;
        toggleImageAILabelsVisibility(activeImageData.id);
        queueMicrotask(() => { EditorActions.fullRender(); });
    }, [toggleImageAILabelsVisibility]);

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
                        'zoom-max',
                        currentTexts.editorTopNavBar.maxZoom,
                        'ico/zoom-max.png',
                        'zoom-max',
                        false,
                        undefined,
                        () => ViewPortActions.setOneForOneZoom()
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
            </div>
            <div className='ButtonWrapper'>
                {/* Hand/drag mode hidden — edit mode already supports edge-drag */}
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
                {/* Point and Line tools hidden
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
                */}
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
            </div>
            <div className='ButtonWrapper'>
                {useMemo(() => {
                    const activeImageData = LabelsSelector.getActiveImageData();
                    const hasImage = imagesData.length > 0;
                    const aiState = activeImageData ? imageAIStates.get(activeImageData.id) : null;
                    const aiLabelsVisible = aiState?.aiLabelsVisible ?? false;
                    const hasAI = hasImage && (activeImageData?.labelRects?.some((r: any) => r.isCreatedByAI) || false);
                    const isDisabled = !hasImage || !hasAI;
                    const icon = isDisabled ? 'ico/eye-slash.png'
                        : aiLabelsVisible ? 'ico/eye.png' : 'ico/eye-off.png';

                    return getButtonWithTooltip(
                        'toggle-ai-labels',
                        isDisabled ? '无推理结果' : aiLabelsVisible ? '隐藏推理结果' : '显示推理结果',
                        icon,
                        'toggle-ai-labels',
                        aiLabelsVisible,
                        undefined,
                        isDisabled ? undefined : toggleAILabelsOnClick,
                        isDisabled
                    );
                }, [imageAIStates, imagesData, activeImageIndex, toggleAILabelsOnClick])}
            </div>
            {useMemo(() => {
                const activeImageData = LabelsSelector.getActiveImageData();
                const detectionAvailable = hasDetectionModel;

                const hasImage = imagesData.length > 0;
                let isOn = false;
                let isDisabled = !detectionAvailable || !hasImage;
                let label = currentTexts.editorTopNavBar.enableDetection;

                if (!detectionAvailable) {
                    label = currentTexts.editorTopNavBar.cannotDetect;
                } else if (isFullImageInferenceInProgress) {
                    label = currentTexts.editorTopNavBar.detectionInProgress;
                    isOn = true;
                } else {
                    const selectedImages = imagesData.filter((img: ImageData) => img.isSelected);
                    const isBatchMode = selectedImages.length > 1;
                    const imagesToCheck = isBatchMode ? selectedImages : (activeImageData ? [activeImageData] : []);

                    if (imagesToCheck.length > 0) {
                        const allInferredAndVisible = imagesToCheck.every((img: ImageData) => {
                            const imgAIState = imageAIStates.get(img.id) || { aiLabelsVisible: false, inferenceHistory: [] };
                            const hasDetectionLabels = img.labelRects?.some((rect: any) => rect.isCreatedByAI) ||
                                                       img.labelPoints?.some((point: any) => point.isCreatedByAI) ||
                                                       img.labelLines?.some((line: any) => line.isCreatedByAI);
                            return imgAIState.aiLabelsVisible && hasDetectionLabels;
                        });
                        isOn = allInferredAndVisible;
                        label = isOn ? currentTexts.editorTopNavBar.disableDetection : currentTexts.editorTopNavBar.enableDetection;
                    }
                }

                return (
                    <StyledTooltip
                        key="inference-toggle"
                        disableFocusListener={true}
                        title={label}
                        TransitionComponent={Fade}
                        TransitionProps={{ timeout: 600 }}
                        placement='bottom'
                    >
                        <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto', gap: 6, height: '100%' }}>
                            <span style={{ color: '#aaa', fontSize: 12, whiteSpace: 'nowrap' }}>
                                {isOn ? currentTexts.editorTopNavBar.disableDetection : currentTexts.editorTopNavBar.enableDetection}
                            </span>
                            <IOSSwitch
                                checked={isOn}
                                disabled={isDisabled}
                                onChange={fullImageDetectionOnClick}
                            />
                        </div>
                    </StyledTooltip>
                );
            }, [hasDetectionModel, isFullImageInferenceInProgress, imageAIStates, imagesData, activeImageIndex, currentTexts, fullImageDetectionOnClick])}
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
    imagesData: state.labels.imagesData,
    aiModels: state
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditorTopNavigationBar);
