import { ContextType } from '../../../data/enums/ContextType';
import './EditorTopNavigationBar.scss';
import React, { useEffect, useMemo, useCallback, useState, useRef } from 'react';
import classNames from 'classnames';
import { AppState } from '../../../store';
import { store } from '../../../index';
import { connect } from 'react-redux';
import { updateSmartAnnotationActiveStatus, updateImageDragModeStatus, updateActivePopupType, updateCustomCursorStyle } from '../../../store/general/actionCreators';
import { PopupWindowType } from '../../../data/enums/PopupWindowType';
import { CustomCursorStyle } from '../../../data/enums/CustomCursorStyle';
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
import { updateFullImageInferenceStatus, toggleImageAILabelsVisibility, toggleImageSegmentationLabelsVisibility, addInferenceHistory } from '../../../store/ai/actionCreators';
import { AIDetectionActions } from '../../../logic/actions/AIDetectionActions';
import { AISegmentationActions } from '../../../logic/actions/AISegmentationActions';
import { DetectionAPIDetector } from '../../../ai/DetectionAPIDetector';
import { SegmentationAPIDetector } from '../../../ai/SegmentationAPIDetector';
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
    updateSmartAnnotationActiveStatusAction: (smartAnnotationActive: boolean) => any;
    updateActivePopupTypeAction: (popupType: PopupWindowType) => any;
    updateFullImageInferenceStatus: (isInProgress: boolean) => any;
    toggleImageAILabelsVisibility: (imageId: string) => any;
    toggleImageSegmentationLabelsVisibility: (imageId: string) => any;
    addInferenceHistory: (imageId: string, detectedCount: number, success?: boolean) => any;
    imageDragMode: boolean;
    smartAnnotationActive: boolean;
    isFullImageInferenceInProgress: boolean;
    imageAIStates: Map<string, { aiLabelsVisible: boolean; segmentationLabelsVisible: boolean; inferenceHistory: Array<any> }>;
    activeLabelType: LabelType;
    activeLabelViewType: LabelType;
    language: Language;
    isAIDisabled: boolean;
    activeImageIndex: number;
    imagesData: ImageData[];
    hasDetectionModel: boolean;
    updateActiveLabelType: (activeLabelType: LabelType) => any;
    updateActiveLabelViewType: (activeLabelViewType: LabelType) => any;
}

const EditorTopNavigationBar: React.FC<IProps> = React.memo((
    {
        activeContext,
        updateImageDragModeStatusAction,
        updateSmartAnnotationActiveStatusAction,
        updateActivePopupTypeAction,
        updateFullImageInferenceStatus,
        toggleImageAILabelsVisibility,
        toggleImageSegmentationLabelsVisibility,
        addInferenceHistory,
        imageDragMode,
        smartAnnotationActive,
        isFullImageInferenceInProgress,
        imageAIStates,
        activeLabelType,
        activeLabelViewType,
        language,
        isAIDisabled,
        activeImageIndex,
        imagesData,
        hasDetectionModel,
        updateActiveLabelType,
        updateActiveLabelViewType,
    }) => {
    const currentTexts = useMemo(() => LanguageConfig[language], [language]);
    
    
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
        // 开启拖拽模式时自动关闭智能标注
        if (!imageDragMode && smartAnnotationActive) {
            updateSmartAnnotationActiveStatusAction(false);
        }
    }, [imageDragMode, smartAnnotationActive, updateImageDragModeStatusAction, updateSmartAnnotationActiveStatusAction]);

    // 顶部工具栏点击 —— 只切换「编辑工具」(activeLabelType → 渲染引擎)
    // 侧栏视图 (activeLabelViewType) 由左侧 LabelsToolkit tab 独立控制，两者解耦
    // 绘制矩形框 / 绘制多边形 / 智能标注 / 查看所有标签 四个工具互斥
    const onToolClick = useCallback((toolType: LabelType) => {
        if (smartAnnotationActive) {
            // 点击其他工具 → 关掉智能标注
            updateSmartAnnotationActiveStatusAction(false);
        }
        updateActiveLabelType(toolType);
        // 切换工具时重置 cursor 到 DEFAULT —— 避免从 ALL 视图切过来时 GRAB 光标残留
        store.dispatch(updateCustomCursorStyle(CustomCursorStyle.DEFAULT));
    }, [smartAnnotationActive, updateSmartAnnotationActiveStatusAction, updateActiveLabelType]);

    // 显示/隐藏标签按钮 —— 同时控制矩形框和多边形
    // 默认可见：未被显式隐藏前两个 flag 都是 true
    const toggleAILabelsOnClick = useCallback(() => {
        const activeImageData = LabelsSelector.getActiveImageData();
        if (!activeImageData) return;
        const aiState = imageAIStates.get(activeImageData.id);
        const rectsVisible = aiState?.aiLabelsVisible ?? true;
        const polysVisible = aiState?.segmentationLabelsVisible ?? true;
        const anyVisible = rectsVisible || polysVisible;
        // 若任一可见 → 全部隐藏；若都不可见 → 全部显示
        const target = !anyVisible;
        if (rectsVisible !== target) {
            toggleImageAILabelsVisibility(activeImageData.id);
        }
        if (polysVisible !== target) {
            toggleImageSegmentationLabelsVisibility(activeImageData.id);
        }
        queueMicrotask(() => { EditorActions.fullRender(); });
    }, [toggleImageAILabelsVisibility, toggleImageSegmentationLabelsVisibility, imageAIStates]);

    // ── 推理下拉菜单 ──
    const [inferenceMode, setInferenceMode] = useState<'detection' | 'segmentation' | 'both'>('detection');
    const [showInferenceMenu, setShowInferenceMenu] = useState(false);
    const inferenceMenuRef = useRef<HTMLDivElement>(null);
    const [detModelName, setDetModelName] = useState('');
    const [segModelName, setSegModelName] = useState('');
    // 后端权威：/health 返回 model_type / segmentation_model_type 字段
    // 'custom' 表示用户上传的自定义模型；'detection' / 'segmentation' 表示内置权重。
    // 前端不再用正则自己猜，而是信任后端分类。
    type BackendModelType = 'custom' | 'detection' | 'segmentation' | '';
    const [detModelType, setDetModelType] = useState<BackendModelType>('');
    const [segModelType, setSegModelType] = useState<BackendModelType>('');

    // built-in 展示时剥掉扩展名 (.pt/.onnx)，自定义保留扩展名让用户一眼分辨
    const formatName = (name: string, isCustom: boolean) => {
        if (!name) return '';
        return isCustom ? name : name.replace(/\.(pt|onnx)$/i, '');
    };
    const detIsCustom = detModelType === 'custom';
    const segIsCustom = segModelType === 'custom';
    // 自定义 label：可能同时有 det 和 seg 都是自定义 → 用 " + " 连起来
    const customLabel = useMemo(() => {
        const parts: string[] = [];
        if (detIsCustom && detModelName) parts.push(detModelName);
        if (segIsCustom && segModelName) parts.push(segModelName);
        return parts.join(' + ');
    }, [detIsCustom, segIsCustom, detModelName, segModelName]);

    // 智能标注需要 SAM 系列分割模型；后端 segmentation_model_type === 'segmentation' 且名字匹配 SAM 家族
    const isSAMLoaded = useMemo(
        () => /^(sam2|sam_|mobile_sam|FastSAM)/i.test(segModelName),
        [segModelName]
    );

    // 智能标注按钮的点击：未加载 SAM 时打开模型加载弹窗，否则切换模式
    // 事件路由由 AllLabelsRenderEngine → rectEngine 负责，SAM 劫持在 rectEngine 里
    const smartAnnotationOnClick = useCallback(() => {
        if (!isSAMLoaded) {
            // 引导用户去加载 SAM 模型
            updateActivePopupTypeAction(PopupWindowType.CALL_MODEL);
            return;
        }
        const willActivate = !smartAnnotationActive;
        updateSmartAnnotationActiveStatusAction(willActivate);
        if (willActivate) {
            // 激活：挂 AllLabelsRenderEngine（smart 劫持走 rectEngine）
            updateActiveLabelType(LabelType.ALL);
            if (imageDragMode) {
                updateImageDragModeStatusAction(false);
            }
        } else {
            // 关闭：工具跟随当前侧栏视图 —— 用户在分割视图里就落到绘制多边形，
            // 在检测视图里就落到绘制矩形框，查看全部里就落到 ALL 手拖模式。
            updateActiveLabelType(activeLabelViewType);
        }
    }, [isSAMLoaded, smartAnnotationActive, imageDragMode, activeLabelViewType, updateSmartAnnotationActiveStatusAction, updateImageDragModeStatusAction, updateActiveLabelType, updateActivePopupTypeAction]);

    // 智能标注激活时自动把推理下拉切到「分割模型」—— 智能标注本就是用 SAM 分割，
    // 推理按钮同步到分割模式才能一键跑全图 SAM 作为起点；取消时回到默认「检测模型」
    useEffect(() => {
        setInferenceMode(smartAnnotationActive ? 'segmentation' : 'detection');
    }, [smartAnnotationActive]);

    // 轮询后端获取当前模型名 / 类型 + 自动切换推理模式
    // 保留扩展名 (.pt / .onnx)，built-in 模型在渲染下拉时通过 formatName 剥离。
    // model_type / segmentation_model_type 来自后端 /health (v2.1.1+)。
    useEffect(() => {
        const fetchModels = () => {
            const url = DetectionAPIDetector.getConfig().url.replace('/detect', '/health');
            fetch(url).then(r => r.json()).then(data => {
                if (data.model) setDetModelName(data.model);
                if (data.segmentation_model) setSegModelName(data.segmentation_model);
                if (data.model_type === 'custom' || data.model_type === 'detection' || data.model_type === 'segmentation') {
                    setDetModelType(data.model_type);
                }
                if (data.segmentation_model_type === 'custom' || data.segmentation_model_type === 'detection' || data.segmentation_model_type === 'segmentation') {
                    setSegModelType(data.segmentation_model_type);
                }
                // 自动切换：当 LoadDetectionModelPopup 加载了新模型后
                if (EditorModel.lastLoadedModelService) {
                    setInferenceMode(EditorModel.lastLoadedModelService);
                    EditorModel.lastLoadedModelService = null;
                }
            }).catch(() => {});
        };
        fetchModels();
        const timer = setInterval(fetchModels, 5000);
        return () => clearInterval(timer);
    }, []);

    // 点击外部关闭下拉
    useEffect(() => {
        if (!showInferenceMenu) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (inferenceMenuRef.current && !inferenceMenuRef.current.contains(e.target as Node)) {
                setShowInferenceMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showInferenceMenu]);

    const runInference = useCallback((mode: 'detection' | 'segmentation' | 'both') => {
        setShowInferenceMenu(false);
        if (isFullImageInferenceInProgress) return;

        const activeImageData = LabelsSelector.getActiveImageData();
        if (!activeImageData) return;

        const selectedImages = imagesData.filter((img: ImageData) => img.isSelected);
        const isBatchMode = selectedImages.length > 1;
        const targets = isBatchMode ? selectedImages : [activeImageData];

        updateFullImageInferenceStatus(true);

        const runDetection = async () => {
            if (isBatchMode) {
                await AIDetectionActions.detectBatch(targets);
            } else {
                await new Promise<void>(resolve => {
                    AIDetectionActions.detectObjects(activeImageData);
                    // detectObjects 没返回 Promise，用 setTimeout 兜底
                    setTimeout(resolve, 500);
                });
            }
        };
        const runSegmentation = async () => {
            await AISegmentationActions.segmentBatch(targets);
        };

        if (mode === 'detection') {
            runDetection();
        } else if (mode === 'segmentation') {
            runSegmentation();
        } else {
            // 'both' = 自定义模式：按后端返回的 model_type 实际类型路由
            //   - 仅 det slot 是自定义 → 跑 detection
            //   - 仅 seg slot 是自定义 → 跑 segmentation
            //   - 两边都是自定义 → 先 det 再 seg
            //   - 都不是自定义 → 兜底跑 det+seg（用户当前加载的内置模型）
            (async () => {
                if (detIsCustom && !segIsCustom) {
                    await runDetection();
                } else if (!detIsCustom && segIsCustom) {
                    await runSegmentation();
                } else {
                    await runDetection();
                    await runSegmentation();
                }
            })();
        }
    }, [imagesData, isFullImageInferenceInProgress, updateFullImageInferenceStatus, detIsCustom, segIsCustom]);

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
                {
                    getButtonWithTooltip(
                        'tool-all',
                        currentTexts.labelTypes?.toolAll || '查看所有标签',
                        'ico/all.png',
                        'tool-all',
                        !smartAnnotationActive && activeLabelType === LabelType.ALL,
                        undefined,
                        () => onToolClick(LabelType.ALL)
                    )
                }
                {
                    getButtonWithTooltip(
                        'tool-rect',
                        currentTexts.labelTypes?.toolRect || '绘制矩形框',
                        'ico/rectangle.png',
                        'tool-rect',
                        !smartAnnotationActive && activeLabelType === LabelType.RECT,
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
                        currentTexts.labelTypes?.toolPolygon || '绘制多边形',
                        'ico/polygon.png',
                        'tool-polygon',
                        !smartAnnotationActive && activeLabelType === LabelType.POLYGON,
                        undefined,
                        () => onToolClick(LabelType.POLYGON)
                    )
                }
            </div>
            <div className='ButtonWrapper'>
                {/* 智能标注按钮：只有加载了 SAM 家族模型才显示 */}
                {isSAMLoaded && getButtonWithTooltip(
                    'smart-annotation',
                    currentTexts.editorTopNavBar.smartAnnotationOn,
                    'ico/cross-hair.png',
                    'smart-annotation',
                    smartAnnotationActive,
                    undefined,
                    smartAnnotationOnClick
                )}
                {useMemo(() => {
                    const activeImageData = LabelsSelector.getActiveImageData();
                    const hasImage = imagesData.length > 0;
                    const aiState = activeImageData ? imageAIStates.get(activeImageData.id) : null;
                    // 默认可见（reducer lazy-init 也是 true）
                    const rectsVisible = aiState?.aiLabelsVisible ?? true;
                    const polysVisible = aiState?.segmentationLabelsVisible ?? true;
                    const anyVisible = rectsVisible || polysVisible;
                    // 图像上有任何标签（rect 或 polygon，AI 或手动）就可以用切换按钮
                    const hasAnyLabel = hasImage && (
                        (activeImageData?.labelRects?.length || 0) > 0 ||
                        (activeImageData?.labelPolygons?.length || 0) > 0
                    );
                    const isDisabled = !hasImage || !hasAnyLabel;
                    const icon = isDisabled ? 'ico/eye-slash.png'
                        : anyVisible ? 'ico/eye.png' : 'ico/eye-off.png';

                    return getButtonWithTooltip(
                        'toggle-ai-labels',
                        anyVisible ? '隐藏标签' : '显示标签',
                        icon,
                        'toggle-ai-labels',
                        anyVisible,
                        undefined,
                        isDisabled ? undefined : toggleAILabelsOnClick,
                        isDisabled
                    );
                }, [imageAIStates, imagesData, activeImageIndex, toggleAILabelsOnClick])}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto', gap: 6, height: '100%' }}>
                <select
                    value={inferenceMode}
                    onChange={e => setInferenceMode(e.target.value as any)}
                    disabled={isFullImageInferenceInProgress}
                    style={{
                        background: '#333',
                        color: imagesData.length === 0 ? '#666' : '#ccc',
                        border: '1px solid #555',
                        borderRadius: 4,
                        fontSize: 11,
                        padding: '2px 4px',
                        cursor: 'pointer',
                        outline: 'none',
                    }}
                >
                    <option value="both">{`${language === 'zh' ? '自定义' : 'Custom'}${customLabel ? ` (${customLabel})` : ''}`}</option>
                    <option value="detection">{`${language === 'zh' ? '检测模型' : 'Detection'}${detModelName && !detIsCustom ? ` (${formatName(detModelName, false)})` : ''}`}</option>
                    <option value="segmentation">{`${language === 'zh' ? '分割模型' : 'Segmentation'}${segModelName && !segIsCustom ? ` (${formatName(segModelName, false)})` : ''}`}</option>
                </select>
                <button
                    disabled={imagesData.length === 0}
                    onClick={() => isFullImageInferenceInProgress ? updateFullImageInferenceStatus(false) : runInference(inferenceMode)}
                    style={{
                        background: isFullImageInferenceInProgress ? '#c62828' : '#333',
                        color: imagesData.length === 0 ? '#666' : isFullImageInferenceInProgress ? '#fff' : '#ccc',
                        border: '1px solid #555',
                        borderRadius: 4,
                        padding: '2px 10px',
                        fontSize: 11,
                        cursor: imagesData.length === 0 ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {isFullImageInferenceInProgress
                        ? (language === 'zh' ? '停止' : 'Stop')
                        : (() => {
                            const selected = imagesData.filter((img: ImageData) => img.isSelected);
                            const count = selected.length > 1 ? selected.length : imagesData.length > 0 ? 1 : 0;
                            const label = language === 'zh' ? '推理' : 'Infer';
                            return count > 1 ? `${label} x${count}` : label;
                        })()}
                </button>
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
    updateSmartAnnotationActiveStatusAction: updateSmartAnnotationActiveStatus,
    updateActivePopupTypeAction: updateActivePopupType,
    updateFullImageInferenceStatus,
    toggleImageAILabelsVisibility,
    toggleImageSegmentationLabelsVisibility,
    addInferenceHistory,
    updateActiveLabelType,
    updateActiveLabelViewType
};

const mapStateToProps = (state: AppState) => ({
    activeContext: state.general.activeContext,
    imageDragMode: state.general.imageDragMode,
    smartAnnotationActive: state.general.smartAnnotationActive,
    isFullImageInferenceInProgress: state.ai.isFullImageInferenceInProgress,
    imageAIStates: state.ai.imageAIStates,
    activeLabelType: state.labels.activeLabelType,
    activeLabelViewType: state.labels.activeLabelViewType,
    language: state.general.language,
    isAIDisabled: state.ai.isAIDisabled,
    activeImageIndex: state.labels.activeImageIndex,
    imagesData: state.labels.imagesData,
    hasDetectionModel: AIModelsSelector.hasModelsOfType(state, 'detection') || DetectionAPIDetector.isEnabled()
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditorTopNavigationBar);
