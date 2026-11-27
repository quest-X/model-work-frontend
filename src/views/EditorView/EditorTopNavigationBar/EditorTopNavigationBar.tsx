import {getSigineSelection, SigineSelection, updateSigineSelection} from '../../../utils/SigineInfra';
import SigineInfraChoice from '../SigineInfraChoice';
import {requestedImageIndices} from '../../../utils/InferenceTargets';
import { ContextType } from '../../../data/enums/ContextType';
import './EditorTopNavigationBar.scss';
import React, { useEffect, useLayoutEffect, useMemo, useCallback, useState, useRef } from 'react';
import classNames from 'classnames';
import { AppState } from '../../../store';
import { store } from '../../../index';
import { connect } from 'react-redux';
import { updateSmartAnnotationActiveStatus, updateImageDragModeStatus, updateActivePopupType, updateCustomCursorStyle, updateEraserMode, updateEraserFineMode, updateTrackingModeStatus, updateSamNegativeMode } from '../../../store/general/actionCreators';
import { PopupWindowType } from '../../../data/enums/PopupWindowType';
import { CustomCursorStyle } from '../../../data/enums/CustomCursorStyle';
import { ImageButton } from '../../Common/ImageButton/ImageButton';
import { ViewPortActions } from '../../../logic/actions/ViewPortActions';
import { LabelsSelector } from '../../../store/selectors/LabelsSelector';
import { ImageData } from '../../../store/labels/types';
import { LabelType } from '../../../data/enums/LabelType';
import { AISelector } from '../../../store/selectors/AISelector';
import { updateActiveLabelType as updateActiveLabelTypeAction, updateActiveLabelViewType as updateActiveLabelViewTypeAction } from '../../../store/labels/actionCreators';
import { ISize } from '../../../interfaces/ISize';
import { AIActions } from '../../../logic/actions/AIActions';
import { Fade, styled, Tooltip, tooltipClasses, TooltipProps } from '@mui/material';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {EditorModel} from '../../../staticModels/EditorModel';
import { updateFullImageInferenceStatus as updateFullImageInferenceStatusAction, toggleImageAILabelsVisibility as toggleImageAILabelsVisibilityAction, toggleImageSegmentationLabelsVisibility as toggleImageSegmentationLabelsVisibilityAction, addInferenceHistory as addInferenceHistoryAction } from '../../../store/ai/actionCreators';
import { AIDetectionActions } from '../../../logic/actions/AIDetectionActions';
import { AISegmentationActions } from '../../../logic/actions/AISegmentationActions';
import { DetectionAPIDetector } from '../../../ai/DetectionAPIDetector';
import { getEngineBaseUrl, getExtensionEngineBaseUrl } from '../../../utils/DefaultBackendUrl';
import { ActiveModel } from '../../../ai/ActiveModel';
import { SimilaritySearchMode } from '../../../ai/SimilaritySearchPresetStore';
import { ScriptStore } from '../../../ai/ScriptStore';
import { PipelineStore } from '../../../ai/PipelineStore';
import { SmartAnnotationActions } from '../../../logic/actions/SmartAnnotationActions';
import { AIModelsSelector } from '../../../store/selectors/AIModelsSelector';
import { YOLO_MODEL_FAMILIES, SEG_MODEL_FAMILIES, prepareModelLoad, YOLOModelFamily } from '../../PopupView/CallModelPopup/CallModelPopup';
import { getHostSystem, showsTensorRTPlaceholder, supportsCoreML } from '../../../utils/HostSystem';
import { EditorActions } from '../../../logic/actions/EditorActions';
import { ObjectTrackingActions } from '../../../logic/actions/ObjectTrackingActions';
import { submitNewNotification, deleteNotificationById } from '../../../store/notifications/actionCreators';
import { getTimelineRange, FrameRange } from '../VideoTimeline/VideoTimeline';
import { NotificationUtil } from '../../../utils/NotificationUtil';
import { inferModelTaskFromName } from '../../../utils/ModelTaskUtil';
import {CanvasMultiViewTrigger} from '../MultiView/CanvasMultiViewTrigger';
import {runDirectVisualSearch} from '../../../services/DirectVisualSearchService';
const imageHasLabels = (image: ImageData | null): boolean =>
    (image?.labelRects?.length || 0) > 0 || (image?.labelPolygons?.length || 0) > 0;

const BUTTON_SIZE: ISize = { width: 30, height: 30 };
const BUTTON_PADDING: number = 10;

// 顶栏宽度不足时按此顺序把按钮组收进“更多工具”菜单（先收次要的）。
const TOOLBAR_GROUP_ORDER = ['accept-reject', 'annotation-tools', 'zoom', 'drawing-tools'] as const;
type ToolbarGroupKey = typeof TOOLBAR_GROUP_ORDER[number];
const TOOLBAR_GROUP_GAP = 11; // 组间距 + 右侧分隔线
const TOOLBAR_OVERFLOW_WIDTH = 32;

interface SimilarityVectorCollection {
    name: string;
    display_name?: string;
    scene_id: string;
    scene_name: string;
    target_id: string;
    target_name: string;
    version: number;
    data_version?: number;
    granularity: 'image' | 'bbox';
    count: number;
    compatible: boolean;
    compatibility_reason?: string | null;
}

interface SimilarityIngestJob {
    collection: string;
    state: string;
    dataset_id: string;
    data_version?: number;
    finished_at?: string | null;
    updated_at?: string | null;
}

interface SimilaritySearchConfig {
    mode: SimilaritySearchMode;
    sceneId: string;
    sceneName: string;
    targetId: string;
    targetName: string;
    collectionName: string;
    collectionVersion: number;
    dataVersion: number;
    datasetId?: string;
}

type InferenceChoice = {id: string; label: string} & (
    {kind: 'model'; name: string}
    | {kind: 'sigine'; selection?: SigineSelection}
    | {kind: 'retrieval'; config: SimilaritySearchConfig}
);

const sortSimilarityCollections = (collections: SimilarityVectorCollection[]): SimilarityVectorCollection[] =>
    [...collections].sort((left, right) => {
        const leftLabel = left.display_name || left.target_name || left.name;
        const rightLabel = right.display_name || right.target_name || right.name;
        return leftLabel.localeCompare(rightLabel) || left.version - right.version;
    });

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
    onClick?: () => void,
    isDisabled?: boolean,
    onDoubleClick?: () => void,
    externalClassName?: string,
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
                onDoubleClick={isDisabled ? undefined : onDoubleClick}
                isActive={isActive}
                isDisabled={isDisabled}
                externalClassName={externalClassName}
            />
        </div>
    </StyledTooltip>;
};

interface IProps {
    activeContext: ContextType;
    updateImageDragModeStatusAction: (imageDragMode: boolean) => void;
    updateSmartAnnotationActiveStatusAction: (smartAnnotationActive: boolean) => void;
    updateTrackingModeStatusAction: (trackingMode: boolean) => void;
    trackingMode: boolean;
    trackingInProgress: boolean;
    updateActivePopupTypeAction: (popupType: PopupWindowType) => void;
    updateFullImageInferenceStatus: (isInProgress: boolean) => void;
    toggleImageAILabelsVisibility: (imageId: string) => void;
    toggleImageSegmentationLabelsVisibility: (imageId: string) => void;
    addInferenceHistory: (imageId: string, detectedCount: number, success?: boolean) => void;
    imageDragMode: boolean;
    smartAnnotationActive: boolean;
    samNegativeMode: boolean;
    updateSamNegativeModeAction: (v: boolean) => void;
    eraserMode: boolean;
    eraserFineMode: boolean;
    updateEraserModeAction: (eraserMode: boolean) => void;
    isFullImageInferenceInProgress: boolean;
    imageAIStates: AppState['ai']['imageAIStates'];
    activeLabelType: LabelType;
    activeLabelViewType: LabelType;
    language: Language;
    isAIDisabled: boolean;
    activeImageIndex: number;
    imagesData: ImageData[];
    hasDetectionModel: boolean;
    hasExtensionEngine: boolean;
    updateActiveLabelType: (activeLabelType: LabelType) => void;
    updateActiveLabelViewType: (activeLabelViewType: LabelType) => void;
}

function getLabelToggleState(imageCount: number, imageAIStates: IProps['imageAIStates']) {
    const activeImageData = LabelsSelector.getActiveImageData();
    const hasImage = imageCount > 0;
    const aiState = activeImageData ? imageAIStates.get(activeImageData.id) : null;
    const rectsVisible = aiState?.aiLabelsVisible ?? true;
    const polysVisible = aiState?.segmentationLabelsVisible ?? true;
    const anyVisible = rectsVisible || polysVisible;
    const hasAnyLabel = hasImage && (
        imageHasLabels(activeImageData)
    );
    const isDisabled = !hasImage || !hasAnyLabel;
    const icon = isDisabled ? 'ico/eye-slash.png'
        : anyVisible ? 'ico/eye.png' : 'ico/eye-off.png';
    return {anyVisible, isDisabled, icon};
}

function getInferenceTargets(imagesData: ImageData[], activeImageData: ImageData, range: FrameRange | null) {
    const indices = requestedImageIndices(imagesData.length);
    if (indices) return {isBatchMode: indices.length > 1, targets: indices.map(index => imagesData[index])};
    const selectedImages = imagesData.filter((img: ImageData) => img.isSelected);
    const targets = range
        ? imagesData.slice(range.startFrame, range.endFrame + 1)
        : selectedImages.length > 0 ? selectedImages : [activeImageData];
    return {isBatchMode: targets.length > 1, targets};
}

function getSmartAnnotationTooltip(smartAnnotationActive: boolean, samNegativeMode: boolean, language: Language): string {
    return smartAnnotationActive
    ? (samNegativeMode
        ? (language === 'zh' ? '负点模式（单击关闭）' : 'Negative mode (click to close)')
        : (language === 'zh' ? '正点模式（单击关闭/双击切负点）' : 'Positive mode (click off / dbl-click neg)'))
    : (language === 'zh' ? '智能标注（单击正点/双击负点）' : 'Smart Annotation (click pos / dbl-click neg)');
}

function inferenceUnavailable(noImages: boolean, multi: boolean, noModels: boolean, similar: boolean, sigine: boolean) {
    return noImages || (multi && noModels && !similar && !sigine);
}
function hasInference(models: unknown[], sigine: boolean) { return models.length > 0 || sigine; }

const EditorTopNavigationBar: React.FC<IProps> = React.memo(function EditorTopNavigationBarView(
    {
        activeContext,
        updateImageDragModeStatusAction,
        updateSmartAnnotationActiveStatusAction,
        updateTrackingModeStatusAction,
        trackingMode,
        trackingInProgress,
        updateActivePopupTypeAction,
        updateFullImageInferenceStatus,
        toggleImageAILabelsVisibility,
        toggleImageSegmentationLabelsVisibility,
        imageDragMode,
        smartAnnotationActive,
        samNegativeMode,
        updateSamNegativeModeAction,
        eraserMode,
        eraserFineMode,
        updateEraserModeAction,
        isFullImageInferenceInProgress,
        imageAIStates,
        activeLabelType,
        activeLabelViewType,
        language,
        activeImageIndex,
        imagesData,
        updateActiveLabelType,
    }: IProps) {
    const currentTexts = useMemo(() => LanguageConfig[language], [language]);


    // 辅助函数：检查图片是否真的有AI生成的标签


    // 新的设计不需要复杂的状态同步，因为状态完全基于用户操作和分割历史
    const getClassName = () => {
        return classNames(
            'EditorTopNavigationBar',
            {
                'with-context': activeContext === ContextType.EDITOR
            }
        );
    };



    // 顶部工具栏点击 —— 只切换「编辑工具」(activeLabelType → 渲染引擎)
    // 侧栏视图 (activeLabelViewType) 由左侧 LabelsToolkit tab 独立控制，两者解耦
    // 绘制矩形框 / 绘制多边形 / 智能标注 / 查看所有标签 四个工具互斥
    const onToolClick = useCallback((toolType: LabelType) => {
        if (smartAnnotationActive) {
            updateSmartAnnotationActiveStatusAction(false);
        }
        // 切换任何工具时无条件关闭橡皮擦（避免 stale closure 漏掉 eraserMode=true 的情况）
        updateEraserModeAction(false);
        updateActiveLabelType(toolType);
        // 切换工具时重置 cursor 到 DEFAULT —— 避免从 ALL 视图切过来时 GRAB 光标残留
        store.dispatch(updateCustomCursorStyle(CustomCursorStyle.DEFAULT));
    }, [smartAnnotationActive, updateSmartAnnotationActiveStatusAction, updateActiveLabelType, updateEraserModeAction]);

    // 橡皮擦按钮 —— 2 状态切换：整体擦除 ↔ 局部擦除
    // 首次点击激活橡皮擦（进入整体擦除），之后每次点击在整体/局部之间切换
    // 退出橡皮擦：点击其他工具按钮（查看标签/绘制矩形框/绘制多边形）
    const eraserOnClick = useCallback(() => {
        if (!eraserMode) {
            // 未激活 → 默认局部擦除
            updateEraserModeAction(true);
            store.dispatch(updateEraserFineMode(true));
            if (smartAnnotationActive) updateSmartAnnotationActiveStatusAction(false);
            if (trackingMode) updateTrackingModeStatusAction(false);
            if (imageDragMode) updateImageDragModeStatusAction(false);
            updateActiveLabelType(LabelType.ALL);
            store.dispatch(updateCustomCursorStyle(CustomCursorStyle.DEFAULT));
        } else {
            // 已激活 → 在整体/局部之间切换
            store.dispatch(updateEraserFineMode(!eraserFineMode));
        }
    }, [eraserMode, eraserFineMode, smartAnnotationActive, trackingMode, imageDragMode, updateEraserModeAction,
        updateSmartAnnotationActiveStatusAction, updateTrackingModeStatusAction, updateImageDragModeStatusAction, updateActiveLabelType]);

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

    // ── 时间轴选区（Shift+拖拽）──
    const [timelineRange, setTimelineRange] = useState<FrameRange | null>(getTimelineRange());
    useEffect(() => {
        const handler = () => setTimelineRange(getTimelineRange());
        window.addEventListener('timelineRangeChange', handler);
        return () => window.removeEventListener('timelineRangeChange', handler);
    }, []);

    // ── 顶栏自适应：空间不足时按优先级把按钮组收进“更多工具”菜单 ──
    const withAI = (activeLabelType === LabelType.RECT || activeLabelType === LabelType.ALL)
        && AISelector.isRoboflowAPIModelLoaded();
    const toolbarRef = useRef<HTMLDivElement>(null);
    const toolbarRightRef = useRef<HTMLDivElement>(null);
    const toolbarGroupRefs = useRef<Partial<Record<ToolbarGroupKey, HTMLDivElement | null>>>({});
    const toolbarGroupWidthsRef = useRef<Partial<Record<ToolbarGroupKey, number>>>({});
    const toolbarOverflowRef = useRef<HTMLDivElement>(null);
    const [collapsedToolbarGroups, setCollapsedToolbarGroups] = useState<ToolbarGroupKey[]>([]);
    const [toolbarOverflowOpen, setToolbarOverflowOpen] = useState(false);

    const measureToolbar = useCallback(() => {
        const bar = toolbarRef.current;
        if (!bar) return;
        // 组被收进菜单后不再参与布局，记住上次量到的自然宽度即可继续计算。
        (Object.keys(toolbarGroupRefs.current) as ToolbarGroupKey[]).forEach(key => {
            const width = toolbarGroupRefs.current[key]?.getBoundingClientRect().width ?? 0;
            if (width > 0) toolbarGroupWidthsRef.current[key] = width;
        });
        const present = TOOLBAR_GROUP_ORDER.filter(key => key !== 'accept-reject' || withAI);
        const available = bar.clientWidth - BUTTON_PADDING;
        let total = toolbarRightRef.current?.getBoundingClientRect().width ?? 0;
        present.forEach(key => { total += (toolbarGroupWidthsRef.current[key] ?? 0) + TOOLBAR_GROUP_GAP; });
        const next: ToolbarGroupKey[] = [];
        if (total > available) {
            let remaining = total;
            for (const key of TOOLBAR_GROUP_ORDER) {
                if (!present.includes(key)) continue;
                remaining -= (toolbarGroupWidthsRef.current[key] ?? 0) + TOOLBAR_GROUP_GAP;
                next.push(key);
                if (remaining + TOOLBAR_OVERFLOW_WIDTH <= available) break;
            }
        }
        setCollapsedToolbarGroups(prev =>
            prev.length === next.length && prev.every((key, index) => key === next[index]) ? prev : next);
        if (next.length === 0) setToolbarOverflowOpen(false);
    }, [withAI]);

    useLayoutEffect(() => { measureToolbar(); });

    useEffect(() => {
        const bar = toolbarRef.current;
        if (!bar || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(() => measureToolbar());
        observer.observe(bar);
        return () => observer.disconnect();
    }, [measureToolbar]);

    useEffect(() => {
        if (!toolbarOverflowOpen) return undefined;
        const handlePointerDown = (event: MouseEvent) => {
            if (!toolbarOverflowRef.current?.contains(event.target as Node)) setToolbarOverflowOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setToolbarOverflowOpen(false);
        };
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [toolbarOverflowOpen]);

    // ── 推理下拉菜单 ──
    const [showInferenceMenu, setShowInferenceMenu] = useState(false);
    const inferenceMenuRef = useRef<HTMLDivElement>(null);
    const [selectedModelNames, setSelectedModelNames] = useState<string[]>([]);
    const [useModelMultiSelect, setUseModelMultiSelect] = useState(false);
    const [sigineModelName, setSigineModelName] = useState(() =>
        localStorage.getItem('opensight.sigineInfra') === 'true' ? (getSigineSelection()?.model || 'Sigine') : '');
    const [sigineModelSelection, setSigineModelSelection] = useState(getSigineSelection);
    const [sigineModelCount, setSigineModelCount] = useState<number | null>(null);
    const onSigineModelChange = useCallback((model: string, selection?: SigineSelection) => {
        setSigineModelName(model);
        setSigineModelSelection(previous => previous?.source_id === selection?.source_id && previous?.model === selection?.model
            ? previous : selection);
    }, []);
    const sigineInfraSelected = !!sigineModelName;
    const [runningModelLabel, setRunningModelLabel] = useState('');
    const sigineModelLabel = `Sigine INFRA(${sigineModelName})`;
    const [similaritySearchSelected, setSimilaritySearchSelected] = useState(false);
    const [similarityCollections, setSimilarityCollections] = useState<SimilarityVectorCollection[]>([]);
    const [similarityJobs, setSimilarityJobs] = useState<SimilarityIngestJob[]>([]);
    const [similarityOptionsLoading, setSimilarityOptionsLoading] = useState(false);
    const [similarityOptionsError, setSimilarityOptionsError] = useState<string | null>(null);
    const [similaritySearchConfig, setSimilaritySearchConfig] = useState<SimilaritySearchConfig | null>(null);
    const [retainedInferenceChoices, setRetainedInferenceChoices] = useState<InferenceChoice[]>([]);
    const multiInferenceCancelledRef = useRef(false);
    const pendingModelSwitchesRef = useRef<Map<string, Promise<boolean>>>(new Map());
    // 用于区分智能标注按钮的单击 vs 双击（延迟单击 200ms）
    const smartClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // 自定义脚本激活标记 —— 监听 ScriptStore 变更事件刷新
    // ✱ 位置语义：preprocess 激活 → 模型名前面；postprocess 激活 → 后面
    const [hasPreScript, setHasPreScript] = useState<boolean>(() => ScriptStore.hasPreprocess() && PipelineStore.isActivated('preprocess'));
    const [hasPostScript, setHasPostScript] = useState<boolean>(() => ScriptStore.hasPostprocess() && PipelineStore.isActivated('postprocess'));
    useEffect(() => {
        const sync = () => {
            setHasPreScript(ScriptStore.hasPreprocess() && PipelineStore.isActivated('preprocess'));
            setHasPostScript(ScriptStore.hasPostprocess() && PipelineStore.isActivated('postprocess'));
        };
        window.addEventListener('opensight:script-changed', sync);
        const unsubPipeline = PipelineStore.subscribe(sync);
        return () => {
            window.removeEventListener('opensight:script-changed', sync);
            unsubPipeline();
        };
    }, []);
    // 多模型：后端同时保持多个模型在内存，前端下拉展示所有已加载模型
    const [loadedModels, setLoadedModels] = useState<string[]>([]);
    const [activeModelName, setActiveModelName] = useState('');
    // 后端返回的每个模型的 task 类型（detect/segment/classify/pose）
    const [modelTasks, setModelTasks] = useState<Record<string, string>>({});
    // 后端两个 slot 的当前占用
    const [detSlotName, setDetSlotName] = useState<string>('');
    const [segSlotName, setSegSlotName] = useState<string>('');
    // 磁盘上所有模型（/available-models 返回），每类选一个作为内置代表
    const [availableModels, setAvailableModels] = useState<Array<{ name: string; type: string }>>([]);

    // 展示完整文件名（含扩展名），方便用户辨认模型


    // 智能标注需要 SAM 系列分割模型；检查已加载模型中是否有 SAM 家族
    const isSAMLoaded = useMemo(
        () => loadedModels.some(name => /^(sam2|sam3|sam_|mobile_sam|FastSAM)/i.test(name)),
        [loadedModels]
    );
    // 目标跟踪需要 memory-based SAM 家族（SAM 2 / SAM 3），只有它们有跨帧 memory attention
    // SAM 1 / MobileSAM / FastSAM / YOLO-seg 没有 tracking 能力，按钮保持 disabled
    const isTrackingModelLoaded = useMemo(
        () => loadedModels.some(name => /^(sam2|sam3)/i.test(name)),
        [loadedModels]
    );

    // 智能标注按钮：单击 = 激活正点 / 关闭，双击 = 激活负点
    // 用 200ms 延迟区分单击与双击，避免双击时先触发单击
    const smartAnnotationOnClick = useCallback(() => {
        if (!isSAMLoaded) {
            updateActivePopupTypeAction(PopupWindowType.CALL_MODEL);
            return;
        }
        if (smartClickTimerRef.current) {
            clearTimeout(smartClickTimerRef.current);
            smartClickTimerRef.current = null;
        }
        smartClickTimerRef.current = setTimeout(() => {
            smartClickTimerRef.current = null;
            if (smartAnnotationActive) {
                // 已激活 → 关闭智能标注
                // 保持 ALL 视图，否则切回 RECT 视图时 SAM 生成的 polygon 会不可见
                updateSmartAnnotationActiveStatusAction(false);
                updateSamNegativeModeAction(false);
                updateActiveLabelType(LabelType.ALL);
            } else {
                // 未激活 → 激活正点模式
                updateSmartAnnotationActiveStatusAction(true);
                updateSamNegativeModeAction(false);
                updateActiveLabelType(LabelType.ALL);
                if (trackingMode) updateTrackingModeStatusAction(false);
                if (imageDragMode) updateImageDragModeStatusAction(false);
            }
        }, 200);
    }, [isSAMLoaded, smartAnnotationActive, trackingMode, imageDragMode, activeLabelViewType,
        updateSmartAnnotationActiveStatusAction, updateSamNegativeModeAction,
        updateActiveLabelType, updateTrackingModeStatusAction, updateImageDragModeStatusAction,
        updateActivePopupTypeAction]);

    // 智能标注按钮双击 → 激活负点模式
    const smartAnnotationOnDoubleClick = useCallback(() => {
        if (!isSAMLoaded) {
            updateActivePopupTypeAction(PopupWindowType.CALL_MODEL);
            return;
        }
        // 取消待执行的单击
        if (smartClickTimerRef.current) {
            clearTimeout(smartClickTimerRef.current);
            smartClickTimerRef.current = null;
        }
        updateSamNegativeModeAction(true);
        if (!smartAnnotationActive) {
            updateSmartAnnotationActiveStatusAction(true);
            updateActiveLabelType(LabelType.ALL);
            if (trackingMode) updateTrackingModeStatusAction(false);
            if (imageDragMode) updateImageDragModeStatusAction(false);
        }
    }, [isSAMLoaded, smartAnnotationActive, trackingMode, imageDragMode,
        updateSmartAnnotationActiveStatusAction, updateSamNegativeModeAction,
        updateActiveLabelType, updateTrackingModeStatusAction, updateImageDragModeStatusAction,
        updateActivePopupTypeAction]);

    // 检索按钮：只负责切换 trackingMode，不涉及正/负点逻辑
    const trackingOnClick = useCallback(() => {
        if (!isTrackingModelLoaded) {
            updateActivePopupTypeAction(PopupWindowType.CALL_MODEL);
            return;
        }
        const willActivate = !trackingMode;
        updateTrackingModeStatusAction(willActivate);
        if (willActivate) {
            // 激活检索 → 关闭智能标注和其他互斥模式
            if (smartAnnotationActive) {
                updateSmartAnnotationActiveStatusAction(false);
                updateSamNegativeModeAction(false);
            }
            if (imageDragMode) updateImageDragModeStatusAction(false);
            if (eraserMode) updateEraserModeAction(false);
        }
    }, [isTrackingModelLoaded, trackingMode, smartAnnotationActive, imageDragMode, eraserMode,
        updateTrackingModeStatusAction, updateSmartAnnotationActiveStatusAction, updateSamNegativeModeAction,
        updateImageDragModeStatusAction, updateEraserModeAction, updateActivePopupTypeAction]);

    // 智能标注激活时自动切换到 SAM 模型
    useEffect(() => {
        if (smartAnnotationActive) {
            const samModel = loadedModels.find(name => /^(sam2|sam3|sam_|mobile_sam|FastSAM)/i.test(name));
            if (samModel && samModel !== activeModelName) {
                const url = `${getEngineBaseUrl()}/switch-model`;
                fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: samModel }),
                }).then(r => r.json()).then(() => {
                    setActiveModelName(samModel);
                }).catch(() => { /* Keep the last model state when the engine is unavailable. */ });
            }
        }
    }, [smartAnnotationActive, loadedModels, activeModelName]);

    // 切换模型：调用后端 /switch-model，立即乐观更新；切换成功后强制刷新一次状态
    const fetchModelsRef = useRef<() => void>();
    const switchModel = useCallback((modelName: string): Promise<boolean> => {
        const pendingSwitch = pendingModelSwitchesRef.current.get(modelName);
        if (pendingSwitch) return pendingSwitch;
        if (modelName === detSlotName || modelName === segSlotName) {
            setActiveModelName(modelName);
            return Promise.resolve(true);
        }

        setActiveModelName(modelName); // 乐观更新，轮询不会覆盖
        const url = `${getEngineBaseUrl()}/switch-model`;
        const request = fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelName }),
        }).then(r => {
            if (!r.ok) throw new Error(`Switch model failed: HTTP ${r.status}`);
            return r.json();
        }).then(data => {
            if (data.active) setActiveModelName(data.active);
            fetchModelsRef.current?.();
            return true;
        }).catch(() => false).finally(() => {
            pendingModelSwitchesRef.current.delete(modelName);
        });
        pendingModelSwitchesRef.current.set(modelName, request);
        return request;
    }, [detSlotName, segSlotName]);

    // 轮询后端获取已加载模型列表 + 模型类型
    // 注意：health 返回的 "model" 始终是 detection slot，不反映用户的最后选择。
    // activeModelName 仅在首次加载或用户主动切换时设置，轮询不覆盖。
    const initializedRef = useRef(false);
    const loadedModelsRef = useRef<string[]>([]);
    const lastConnectedRef = useRef(false);
    useEffect(() => {
        const fetchModels = (): Promise<boolean> => {
            const baseUrl = getEngineBaseUrl();
            const healthPromise = fetch(`${baseUrl}/health`).then(r => r.json()).then(data => {
                window.dispatchEvent(new CustomEvent('opensight:backend-status', { detail: { connected: true } }));
                if (data.model_tasks) setModelTasks(data.model_tasks);
                setDetSlotName(data.model || '');
                setSegSlotName(data.segmentation_model || '');
                // 同步给非 React 模块（SmartAnnotation / Tracking）用，避免再 fetch 一次
                ActiveModel.setDetection(data.model || '');
                ActiveModel.setSegmentation(data.segmentation_model || '');

                // 初次加载也支持仅有分割模型的训练结果。
                const initialModel = [data.model, data.segmentation_model].find(name => name && name !== 'none');
                if (!initializedRef.current && initialModel) {
                    setActiveModelName(initialModel);
                    initializedRef.current = true;
                }

                // 检测到新模型被加载 → 自动切到新模型
                if (data.loaded_models) {
                    const prev = loadedModelsRef.current;
                    const curr = data.loaded_models as string[];
                    if (initializedRef.current) {
                        const newModels = curr.filter(m => !prev.includes(m));
                        if (newModels.length > 0) {
                            setActiveModelName(newModels[newModels.length - 1]);
                        }
                    }
                    loadedModelsRef.current = curr;
                    setLoadedModels(curr);
                }

                if (EditorModel.lastLoadedModelService) {
                    EditorModel.lastLoadedModelService = null;
                }
                return true;
            }).catch(() => {
                window.dispatchEvent(new CustomEvent('opensight:backend-status', { detail: { connected: false } }));
                return false;
            });
            // 磁盘上所有模型（供 slot 被自定义占用时选一个内置代表）
            fetch(`${baseUrl}/available-models`).then(r => r.json()).then(data => {
                if (Array.isArray(data.models)) setAvailableModels(data.models);
            }).catch(() => { /* Keep the last model state when the engine is unavailable. */ });
            return healthPromise;
        };
        fetchModelsRef.current = fetchModels;

        // 自适应轮询：未连接时用短间隔（2s）快速发现刚启动的后端，
        // 一旦连上就退回 30s（v2.6.0 起的节流，避免推理时打满 health 通道）。
        // 切换模型时由 switchModel 主动调 fetchModelsRef 强制刷新，不靠轮询。
        const CONNECTED_INTERVAL = 30000;
        const DISCONNECTED_INTERVAL = 2000;
        let timer: ReturnType<typeof setInterval>;
        const tick = () => {
            if (document.hidden) return;
            const wasConnected = lastConnectedRef.current;
            fetchModels().then((connected) => {
                if (connected !== wasConnected) {
                    lastConnectedRef.current = connected;
                    clearInterval(timer);
                    timer = setInterval(tick, connected ? CONNECTED_INTERVAL : DISCONNECTED_INTERVAL);
                }
            });
        };
        fetchModels().then((connected) => {
            lastConnectedRef.current = connected;
            timer = setInterval(tick, connected ? CONNECTED_INTERVAL : DISCONNECTED_INTERVAL);
        });
        const onModelLoaded = () => fetchModels();
        window.addEventListener('opensight:model-loaded', onModelLoaded);
        return () => {
            clearInterval(timer);
            window.removeEventListener('opensight:model-loaded', onModelLoaded);
        };
    }, []);

    // 点击外部关闭下拉
    useEffect(() => {
        if (!showInferenceMenu) return undefined;
        const handleClickOutside = (e: MouseEvent) => {
            if (inferenceMenuRef.current && !inferenceMenuRef.current.contains(e.target as Node)) {
                setShowInferenceMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showInferenceMenu]);

    const loadSimilaritySearchOptions = useCallback(async () => {
        setSimilarityOptionsLoading(true);
        setSimilarityOptionsError(null);
        const vectorBaseUrl = `${getExtensionEngineBaseUrl()}/vector_db`;
        try {
            const [collectionsResponse, jobsResponse] = await Promise.all([
                fetch(`${vectorBaseUrl}/collections`),
                fetch(`${vectorBaseUrl}/jobs`),
            ]);
            if (!collectionsResponse.ok || !jobsResponse.ok) {
                throw new Error(`HTTP ${collectionsResponse.status}/${jobsResponse.status}`);
            }
            const collectionsBody = await collectionsResponse.json();
            const jobsBody = await jobsResponse.json();
            setSimilarityCollections(
                Array.isArray(collectionsBody.collections) ? collectionsBody.collections : []
            );
            setSimilarityJobs(Array.isArray(jobsBody.jobs) ? jobsBody.jobs : []);
        } catch (cause) {
            setSimilarityOptionsError(
                language === 'zh'
                    ? `检索方案加载失败：${cause instanceof Error ? cause.message : String(cause)}`
                    : `Failed to load retrieval options: ${cause instanceof Error ? cause.message : String(cause)}`
            );
        } finally {
            setSimilarityOptionsLoading(false);
        }
    }, [language]);

    useEffect(() => {
        if (showInferenceMenu) {
            void loadSimilaritySearchOptions();
        }
    }, [showInferenceMenu, loadSimilaritySearchOptions]);

    // 模型下拉选项（useMemo 避免重复计算）
    const modelDropdownEntries = useMemo(() => {
        const zh = language === 'zh';
        const allBuiltins = [...YOLO_MODEL_FAMILIES, ...SEG_MODEL_FAMILIES].flatMap(f => f.variants);
        const isCustomName = (name: string) => !allBuiltins.includes(name.replace(/\.(pt|onnx)$/i, ''));
        const normalize = (name: string): string =>
            name.endsWith('.pt') || name.endsWith('.onnx') ? name : name + '.pt';
        const toDisplayName = (name: string): string => {
            const base = name.replace(/\.(pt|onnx)$/i, '');
            const family = [...YOLO_MODEL_FAMILIES, ...SEG_MODEL_FAMILIES]
                .find(candidate => candidate.variants.includes(base));
            const owner = family?.name.split('/')[0];
            return owner ? `${owner}/${base}` : name;
        };
        type Cat = 'custom-seg' | 'builtin-seg' | 'custom-det' | 'builtin-det';
        const pickFor = (cat: Cat): string | null => {
            const slotName = cat.endsWith('seg') ? segSlotName : detSlotName;
            if (slotName) {
                const slotIsCustom = isCustomName(slotName);
                const slotMatchesCat = cat.startsWith('custom') ? slotIsCustom : !slotIsCustom;
                if (slotMatchesCat) return slotName;
            }
            if (cat.startsWith('custom')) {
                const expectsSegmentation = cat.endsWith('seg');
                return loadedModels.find(name => {
                    if (!isCustomName(name)) return false;
                    const task = modelTasks[name] || inferModelTaskFromName(name);
                    return expectsSegmentation ? task === 'segment' : task !== 'segment';
                }) || null;
            }
            const found = cat === 'builtin-seg'
                ? availableModels.find(m => m.type === 'segmentation')
                : availableModels.find(m => m.type === 'detection');
            return found ? normalize(found.name) : null;
        };
        const catOrder: Array<{ cat: Cat; label: string }> = [
            { cat: 'custom-det',  label: zh ? '自定义' : 'Custom' },
            { cat: 'custom-seg',  label: zh ? '自定义' : 'Custom' },
            { cat: 'builtin-det', label: zh ? '检测模型' : 'Detection' },
            { cat: 'builtin-seg', label: zh ? '分割模型' : 'Segmentation Model' },
        ];
        const seen = new Set<string>();
        const entries: Array<{
            name: string;
            label: string;
            displayName: string;
            group: 'custom' | 'models';
            task: 'detect' | 'segment';
        }> = [];
        for (const { cat, label } of catOrder) {
            const name = pickFor(cat);
            if (name && !seen.has(name)) {
                seen.add(name);
                entries.push({
                    name,
                    label,
                    displayName: cat.startsWith('custom') ? name : toDisplayName(name),
                    group: cat.startsWith('custom') ? 'custom' : 'models',
                    task: cat.endsWith('seg') ? 'segment' : 'detect',
                });
            }
        }
        return entries;
    }, [language, availableModels, detSlotName, segSlotName, loadedModels, modelTasks]);

    // 模型列表刷新后移除已经不存在的勾选项。
    useEffect(() => {
        setSelectedModelNames(current =>
            current.filter(name => modelDropdownEntries.some(entry => entry.name === name))
        );
    }, [modelDropdownEntries]);

    const availableBaseNames = useMemo(
        () => new Set(availableModels.map(model => model.name.replace(/\.(pt|onnx|mlpackage|mlmodel)$/i, ''))),
        [availableModels]
    );
    const loadedBaseNames = useMemo(
        () => new Set(loadedModels.map(name => name.replace(/\.(pt|onnx|mlpackage|mlmodel)$/i, ''))),
        [loadedModels]
    );
    const loadedFamilyIds = new Set(modelDropdownEntries
        .filter(entry => entry.group === 'models')
        .map(entry => {
            const base = entry.name.replace(/\.(pt|onnx|mlpackage|mlmodel)$/i, '');
            return [...YOLO_MODEL_FAMILIES, ...SEG_MODEL_FAMILIES]
                .find(family => family.variants.includes(base))?.id;
        })
        .filter((id): id is string => !!id));
    const hostSystem = getHostSystem();
    const canUseCoreML = supportsCoreML(hostSystem);
    const showTensorRT = showsTensorRTPlaceholder(hostSystem);

    const openModelLoader = (family: YOLOModelFamily | null, customExt: 'pt' | 'onnx' | 'mlpackage' | null) => {
        prepareModelLoad(family, customExt, getEngineBaseUrl());
        setShowInferenceMenu(false);
        updateActivePopupTypeAction(PopupWindowType.LOAD_DETECTION_MODEL);
    };

    const activeModelEntry = modelDropdownEntries.find(e => e.name === activeModelName);
    const effectiveSelectedModelNames = useMemo(() => useModelMultiSelect
        ? selectedModelNames
        : activeModelEntry ? [activeModelEntry.name] : [], [useModelMultiSelect, selectedModelNames, activeModelEntry]);
    const selectedModelEntries = useMemo(() => modelDropdownEntries.filter(
        entry => effectiveSelectedModelNames.includes(entry.name)
    ), [modelDropdownEntries, effectiveSelectedModelNames]);
    const getSimilarityConfigSummary = () => (similaritySearchConfig
        ? `${similaritySearchConfig.mode === 'dino'
            ? (language === 'zh' ? '快速模式' : 'Fast Mode')
            : (language === 'zh' ? '高精度模式' : 'High-precision Mode')
        }-${similaritySearchConfig.targetName}`
        : '');
    const similarityConfigSummary = getSimilarityConfigSummary();

    // 当前选中项的显示文本

    const retrievalLabel = `${language === 'zh' ? '检索方案' : 'Retrieval plan'} (${similarityConfigSummary})`;
    const getModelButtonLabel = () => {
        const nextModel = useModelMultiSelect ? selectedModelEntries[0] : activeModelEntry;
        return runningModelLabel || (nextModel
        ? (nextModel.group === 'custom' ? `${nextModel.label} (${nextModel.name})` : nextModel.displayName)
        : sigineInfraSelected ? sigineModelLabel
            : similaritySearchSelected ? retrievalLabel
                : useModelMultiSelect ? (language === 'zh' ? '请选择模型' : 'Select models')
                    : loadedModels.length === 0 ? (language === 'zh' ? '未加载模型' : 'No model') : activeModelName);
    };
    const modelButtonLabel = getModelButtonLabel();

    const latestSimilarityJob = useCallback((collectionName: string): SimilarityIngestJob | null => {
        return similarityJobs
            .filter(job =>
                job.collection === collectionName
                && job.state === 'completed'
                && !!job.dataset_id
            )
            .sort((left, right) => {
                const dataVersionDifference = (right.data_version || 0) - (left.data_version || 0);
                if (dataVersionDifference !== 0) return dataVersionDifference;
                const rightTime = Date.parse(right.finished_at || right.updated_at || '') || 0;
                const leftTime = Date.parse(left.finished_at || left.updated_at || '') || 0;
                return rightTime - leftTime;
            })[0] || null;
    }, [similarityJobs]);

    const fastSimilarityCollections = useMemo(
        () => sortSimilarityCollections(similarityCollections.filter(
            collection => collection.compatible && collection.count > 0
        )),
        [similarityCollections]
    );
    const preciseSimilarityCollections = useMemo(
        () => sortSimilarityCollections(similarityCollections.filter(
            collection => !!latestSimilarityJob(collection.name)
        )),
        [similarityCollections, latestSimilarityJob]
    );

    const toggleSimilarityCollection = useCallback((mode: SimilaritySearchMode, collection: SimilarityVectorCollection) => {
        const isSelected = similaritySearchSelected
            && similaritySearchConfig?.mode === mode
            && similaritySearchConfig.collectionName === collection.name;
        if (isSelected) {
            setSimilaritySearchSelected(false);
            setSimilaritySearchConfig(null);
            return;
        }
        const datasetJob = mode === 'l2g' ? latestSimilarityJob(collection.name) : null;
        if (mode === 'l2g' && !datasetJob?.dataset_id) return;
        if (!useModelMultiSelect) {
            setSelectedModelNames(activeModelEntry ? [activeModelEntry.name] : []);
        }
        setUseModelMultiSelect(true);
        setSimilaritySearchConfig({
            mode,
            sceneId: collection.scene_id,
            sceneName: collection.scene_name,
            targetId: collection.target_id,
            targetName: collection.target_name,
            collectionName: collection.name,
            collectionVersion: collection.version,
            dataVersion: collection.data_version || datasetJob?.data_version || 0,
            datasetId: datasetJob?.dataset_id || undefined,
        });
        setSimilaritySearchSelected(true);
    }, [activeModelEntry, latestSimilarityJob, similaritySearchConfig, similaritySearchSelected, useModelMultiSelect]);

    // 判断当前活跃模型是否为分割类型:
    // 1. 优先使用后端 model_tasks（精确，通过 model.task 属性获取）
    // 2. 回退到统一文件名 token 规则（含日期_SEG_项目_... 模型）
    const isSegModel = useMemo(
        () => {
            const task = modelTasks[activeModelName];
            if (task) return task === 'segment';
            return inferModelTaskFromName(activeModelName) === 'segment';
        },
        [activeModelName, modelTasks]
    );

    // 同步选中模型的任务类型到 Redux，供 pipeline popup 读取
    useEffect(() => {
        const task = modelTasks[activeModelName];
        const resolvedTask: string | null = task
            ? task
            : activeModelName
                ? inferModelTaskFromName(activeModelName)
                : null;
        store.dispatch({ type: 'SET_SELECTED_MODEL_TASK', payload: resolvedTask });
    }, [activeModelName, modelTasks]);

    const launchConfiguredSimilaritySearch = useCallback(async (): Promise<boolean> => {
        if (!similaritySearchConfig) return false;
        if (similaritySearchConfig.mode !== 'dino') {
            const note = NotificationUtil.createErrorNotification({
                header: language === 'zh' ? '视觉检索失败' : 'Visual search failed',
                description: language === 'zh'
                    ? '高精度方案暂不返回可写回的精确 bbox 或 mask，请选择快速方案。'
                    : 'The high-precision scheme does not return exact writable bbox or mask geometry yet. Select the fast scheme.',
            });
            store.dispatch(submitNewNotification(note));
            setTimeout(() => store.dispatch(deleteNotificationById(note.id)), 6000);
            return true;
        }
        try {
            const result = await runDirectVisualSearch({
                collectionName: similaritySearchConfig.collectionName,
                topK: 12,
            });
            const note = NotificationUtil.createSuccessNotification({
                header: language === 'zh' ? '视觉检索完成' : 'Visual search completed',
                description: language === 'zh'
                    ? `已直接写回 ${result.accepted} 个 bbox/mask${result.rejected ? `，跳过 ${result.rejected} 个` : ''}`
                    : `Wrote ${result.accepted} bbox/mask results directly${result.rejected ? `; skipped ${result.rejected}` : ''}`,
            });
            store.dispatch(submitNewNotification(note));
            setTimeout(() => store.dispatch(deleteNotificationById(note.id)), 5000);
        } catch (cause) {
            const note = NotificationUtil.createErrorNotification({
                header: language === 'zh' ? '视觉检索失败' : 'Visual search failed',
                description: cause instanceof Error ? cause.message : String(cause),
            });
            store.dispatch(submitNewNotification(note));
            setTimeout(() => store.dispatch(deleteNotificationById(note.id)), 7000);
        }
        return true;
    }, [language, similaritySearchConfig]);

    const runTrackingInference = (activeImageData: ImageData) => {
        const polygons = (activeImageData.labelPolygons || []).filter(p => p.isVisible !== false);
        if (polygons.length === 0) {
            const errNote = NotificationUtil.createErrorNotification({
                header: language === 'zh' ? '检索失败' : 'Retrieval failed',
                description: language === 'zh'
                    ? '当前帧没有可见标注，请先用智能标注创建 seed mask（或取消隐藏已有标注）'
                    : 'No visible annotations on current frame. Create a seed mask first or unhide existing ones.',
            });
            store.dispatch(submitNewNotification(errNote));
            setTimeout(() => store.dispatch(deleteNotificationById(errNote.id)), 5000);
            return;
        }

        const range = getTimelineRange();
        const activeVideo = store.getState().video?.activeVideo;
        const currentFrame = activeVideo?.currentFrame ?? LabelsSelector.getActiveImageIndex();

        // 提取 polygon vertices → [x,y][][]
        const maskPolygons: [number, number][][] = polygons.map(p =>
            p.vertices.map(v => [v.x, v.y] as [number, number])
        );

        const rangeStart = range ? range.startFrame : 0;
        const rangeEnd = range ? range.endFrame : imagesData.length - 1;
        const sessionId = activeVideo?.sessionId || '';
        const modelName = activeModelName;

        // 自动判断方向：seed 帧离选区末端更近时反向检索
        const distToStart = Math.abs(currentFrame - rangeStart);
        const distToEnd = Math.abs(currentFrame - rangeEnd);
        const reverse = distToEnd < distToStart;

        // 反向：从 seed 帧往前走到选区起点；正向：从 seed 帧往后走到选区终点
        const startFrame = reverse ? rangeStart : currentFrame;
        const endFrame = reverse ? currentFrame : rangeEnd;

        // 尝试从第一个 polygon 的 labelId 获取 className
        const labels = store.getState().labels.labels;
        const firstLabelId = polygons[0]?.labelId;
        const labelName = labels.find(l => l.id === firstLabelId);
        const className = labelName?.name || 'retrieved';

        ObjectTrackingActions.startRetrieval({
            sessionId,
            startFrameIdx: startFrame,
            endFrameIdx: endFrame,
            maskPolygons,
            modelName,
            className,
            reverse,
        });
        return;
    };

    const executeInferencePlan = async (
        inferencePlan: Array<{ name: string; task: string }>, targets: ImageData[],
        isBatchMode: boolean,
    ) => {
        const detectionModelCount = inferencePlan.filter(entry => entry.task === 'detect').length;
        const segmentationModelCount = inferencePlan.filter(entry => entry.task === 'segment').length;

        for (const entry of inferencePlan) {
            if (multiInferenceCancelledRef.current) break;

            const model = modelDropdownEntries.find(candidate => candidate.name === entry.name);
            setRunningModelLabel(model ? `${model.label} (${entry.name})` : entry.name);
            updateFullImageInferenceStatus(true);
            const modelReady = await switchModel(entry.name);
            if (!modelReady) {
                updateFullImageInferenceStatus(false);
                continue;
            }
            if (multiInferenceCancelledRef.current) {
                updateFullImageInferenceStatus(false);
                break;
            }

            if (entry.task === 'segment') {
                await AISegmentationActions.segmentBatch(
                    targets,
                    isBatchMode && segmentationModelCount === 1
                );
            } else {
                // 单模型单帧沿用原来的轻量回调路径；多模型单帧改走可等待的
                // detectBatch(false)，确保检测完成后再开始下一项推理。
                if (inferencePlan.length === 1 && !isBatchMode && !similaritySearchSelected && !sigineInfraSelected) {
                    AIDetectionActions.detectObjects(targets[0]);
                } else {
                    await AIDetectionActions.detectBatch(
                        targets,
                        isBatchMode && detectionModelCount === 1
                    );
                }
            }
        }
    };

    const runSigineInference = async (targets: ImageData[]) => {
        if (sigineInfraSelected && !multiInferenceCancelledRef.current) {
            setRunningModelLabel(sigineModelLabel);
            await AIDetectionActions.recognizeSigine(targets, () => multiInferenceCancelledRef.current);
        }
    };

    const runInference = useCallback(async () => {
        setShowInferenceMenu(false);
        if (isFullImageInferenceInProgress) {
            console.log('[Infer] skip: inference already in progress');
            return;
        }

        const activeImageData = LabelsSelector.getActiveImageData();
        if (!activeImageData) {
            console.log('[Infer] skip: no active image data');
            return;
        }
        multiInferenceCancelledRef.current = false;
        console.log('[Infer] entry', {
            isSegModel,
            smartAnnotationActive,
            trackingMode,
            activeModelName,
            selectedModels: selectedModelEntries.map(entry => entry.name),
            hasImage: !!activeImageData,
            imageId: activeImageData.id,
        });

        // ── 智能标注模式：收集 prompt LabelRects，统一发 SAM 推理 ──
        if (smartAnnotationActive) {
            const prompts = SmartAnnotationActions.getPromptRects(activeImageData);
            if (prompts.length === 0) return;
            SmartAnnotationActions.runAllPrompts();
            return;
        }

        // ── 检索模式：用当前帧的 polygon 作为 seed mask 跨帧跟踪 ──
        if (trackingMode) {
            runTrackingInference(activeImageData);
            return;
        }

        // ── 正常推理模式 ──
        // 多选模式按菜单顺序串行执行（检测 → 推理），避免两个批任务争抢全局进度状态。
        const inferencePlan = useModelMultiSelect
            ? selectedModelEntries
            : [{
                name: activeModelName,
                task: isSegModel ? 'segment' as const : 'detect' as const,
            }];
        try {
            if (hasInference(inferencePlan, sigineInfraSelected)) {
                const {isBatchMode, targets} = getInferenceTargets(imagesData, activeImageData, getTimelineRange());
                if (targets.length === 0) return;
                await executeInferencePlan(inferencePlan, targets, isBatchMode);
                await runSigineInference(targets);
            }
            if (similaritySearchSelected && !multiInferenceCancelledRef.current) {
                setRunningModelLabel(retrievalLabel);
                if (!await launchConfiguredSimilaritySearch()) {
                    setShowInferenceMenu(true);
                }
            }
        } finally {
            setRunningModelLabel('');
        }
    }, [
        imagesData,
        isFullImageInferenceInProgress,
        updateFullImageInferenceStatus,
        isSegModel,
        smartAnnotationActive,
        trackingMode,
        language,
        activeModelName,
        selectedModelEntries,
        similaritySearchSelected,
        sigineInfraSelected,
        sigineModelLabel,
        retrievalLabel,
        modelDropdownEntries,
        launchConfiguredSimilaritySearch,
        switchModel,
        useModelMultiSelect,
    ]);

    const renderDrawingTools = (groupRef?: React.Ref<HTMLDivElement>) => (
        <div className='ButtonWrapper DrawingToolsWrapper' ref={groupRef}>
            {
                getButtonWithTooltip(
                    'tool-all',
                    currentTexts.labelTypes?.toolAll || '查看所有标签',
                    'ico/all.png',
                    'tool-all',
                    !smartAnnotationActive && !eraserMode && activeLabelType === LabelType.ALL,
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
                    !smartAnnotationActive && !eraserMode && activeLabelType === LabelType.RECT,
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
                    !smartAnnotationActive && !eraserMode && activeLabelType === LabelType.POLYGON,
                    undefined,
                    () => onToolClick(LabelType.POLYGON)
                )
            }
            <CanvasMultiViewTrigger />
        </div>
    );

    const toggleModel = (name: string) => {
        setUseModelMultiSelect(true);
        if (effectiveSelectedModelNames.includes(name)) {
            setSelectedModelNames(effectiveSelectedModelNames.filter(selected => selected !== name));
        } else {
            setSelectedModelNames([...effectiveSelectedModelNames, name]);
            void switchModel(name);
        }
    };

    const renderModelRow = (e: (typeof modelDropdownEntries)[number]) => {
        const isChecked = effectiveSelectedModelNames.includes(e.name);
        return (
            <label
                key={e.name}
                className="InferenceMenuRow"
                data-selected={isChecked}
            >
                <input type='checkbox' checked={isChecked} onChange={() => toggleModel(e.name)}/>
                {e.displayName}
            </label>
        );
    };

    const gearIcon = (
        <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor'
             strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'
             aria-hidden='true' style={{ flex: 'none' }}>
            <circle cx='12' cy='12' r='3'/>
            <path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'/>
        </svg>
    );

    const renderLoaderRow = (key: string, family: YOLOModelFamily | null,
                             customExt: 'pt' | 'onnx' | 'mlpackage' | null,
                             label: React.ReactNode, disabled = false) => (
        <div key={key} className={`InferenceMenuRow${disabled ? ' disabled' : ''}`}
             style={disabled ? { opacity: 0.4 } : undefined}
             onClick={() => { if (!disabled) openModelLoader(family, customExt); }}>
            {gearIcon}
            {label}
        </div>
    );

    const renderFamilyCatalogRow = (family: YOLOModelFamily) => {
        const downloaded = family.variants.filter(variant => availableBaseNames.has(variant)).length;
        const active = family.variants.filter(variant => loadedBaseNames.has(variant));
        return renderLoaderRow(family.id, family, null, <>
            {family.name}
            {downloaded > 0 && <span style={{ opacity: 0.7 }}> ({downloaded}/{family.variants.length})</span>}
            {active.map(variant => (
                <span key={variant} style={{ marginLeft: 'auto', color: '#4da6ff', fontSize: 10 }}>✓ {variant}</span>
            ))}
        </>);
    };

    const renderCustomLoaderRows = () => (
        <>
            {renderLoaderRow('custom-pt', null, 'pt',
                language === 'zh' ? '模型 .pt 文件' : '.pt model file')}
            {renderLoaderRow('custom-onnx', null, 'onnx',
                language === 'zh' ? '模型 .onnx 文件' : '.onnx model file')}
            {canUseCoreML && renderLoaderRow('custom-mlpackage', null, 'mlpackage',
                language === 'zh' ? '模型 .mlpackage 文件（CoreML / ANE）' : '.mlpackage model file (CoreML / ANE)')}
            {!canUseCoreML && showTensorRT && renderLoaderRow('custom-engine', null, null,
                language === 'zh' ? '模型 .engine / .trt 文件（即将推出）' : '.engine / .trt model file (coming soon)', true)}
        </>
    );

    const renderSimilarityGroup = (mode: SimilaritySearchMode, label: string,
                                   collections: SimilarityVectorCollection[]) => {
        const hasChecked = similaritySearchSelected && similaritySearchConfig?.mode === mode;
        return <details open={hasChecked || undefined}>
            <summary>{label}</summary>
            {collections.map(collection => {
                const isChecked = similaritySearchSelected
                    && similaritySearchConfig?.mode === mode
                    && similaritySearchConfig.collectionName === collection.name;
                return (
                    <label key={collection.name} className="InferenceMenuRow" data-selected={isChecked}>
                        <input type='checkbox' checked={isChecked}
                            onChange={() => toggleSimilarityCollection(mode, collection)}/>
                        {collection.display_name || collection.name}
                    </label>
                );
            })}
            {!collections.length && (
                <div className='InferenceMenuStatus'>
                    {language === 'zh' ? '暂无可用向量库' : 'No vector stores'}
                </div>
            )}
        </details>;
    };

    const renderSimilarityOptions = () => {
        if (similarityOptionsLoading) {
            return <div className='InferenceMenuStatus' role='status'>
                {language === 'zh' ? '正在读取检索方案…' : 'Loading retrieval options…'}
            </div>;
        }
        if (similarityOptionsError) {
            return <div className='InferenceMenuStatus' role='status'>
                <div>{similarityOptionsError}</div>
                <button
                    type='button'
                    onClick={() => void loadSimilaritySearchOptions()}
                    style={{
                        marginTop: 4,
                        border: '1px solid #666',
                        borderRadius: 3,
                        background: '#3a3a3a',
                        color: '#ddd',
                        cursor: 'pointer',
                        fontSize: 11,
                    }}
                >
                    {language === 'zh' ? '重试' : 'Retry'}
                </button>
            </div>;
        }
        return <>
            {renderSimilarityGroup('dino', language === 'zh' ? '快速向量' : 'Fast vector', fastSimilarityCollections)}
            {renderSimilarityGroup('l2g', language === 'zh' ? '高精度向量' : 'High-precision vector', preciseSimilarityCollections)}
        </>;
    };

    const inferenceDisabled = inferenceUnavailable(imagesData.length === 0, useModelMultiSelect,
        selectedModelEntries.length === 0, similaritySearchSelected, sigineInfraSelected);

    const builtinModelCount = new Set([
        ...[...YOLO_MODEL_FAMILIES, ...SEG_MODEL_FAMILIES].flatMap(family => family.variants),
        ...modelDropdownEntries.map(entry => entry.name.replace(/\.(pt|onnx|mlpackage|mlmodel)$/i, '')),
    ]).size;

    const renderSigineInfraChoice = () => (
        <SigineInfraChoice baseUrl={getEngineBaseUrl()} zh={language === 'zh'} onChange={onSigineModelChange}
            onCountChange={setSigineModelCount}/>
    );

    const hasSelectedModel = effectiveSelectedModelNames.length > 0;
    const hasSelectedSimilarity = similaritySearchSelected && !!similaritySearchConfig;
    const hasBuiltinSelection = hasSelectedModel || hasSelectedSimilarity;
    const hasCustomSelected = modelDropdownEntries.some(e => e.group === 'custom'
        && effectiveSelectedModelNames.includes(e.name));
    const hasDetectionSelected = modelDropdownEntries.some(e => e.group === 'models' && e.task === 'detect'
        && effectiveSelectedModelNames.includes(e.name));
    const hasSegmentationSelected = modelDropdownEntries.some(e => e.group === 'models' && e.task === 'segment'
        && effectiveSelectedModelNames.includes(e.name));
    const openWhen = (condition: boolean): true | undefined => condition ? true : undefined;
    const selectedInferenceChoices = useMemo<InferenceChoice[]>(() => [
        ...selectedModelEntries.map(entry => ({id: `model:${entry.name}`, label: entry.displayName, kind: 'model' as const, name: entry.name})),
        ...(sigineInfraSelected ? [{id: `sigine:${JSON.stringify(sigineModelSelection) || sigineModelName}`,
            label: sigineModelLabel, kind: 'sigine' as const, selection: sigineModelSelection}] : []),
        ...(hasSelectedSimilarity ? [{id: `retrieval:${similaritySearchConfig.mode}:${similaritySearchConfig.collectionName}`,
            label: retrievalLabel, kind: 'retrieval' as const, config: similaritySearchConfig}] : []),
    ], [selectedModelEntries, sigineInfraSelected, sigineModelSelection, sigineModelName, sigineModelLabel,
        hasSelectedSimilarity, similaritySearchConfig, retrievalLabel]);

    useEffect(() => {
        setRetainedInferenceChoices(previous => {
            if (!showInferenceMenu) return previous.length ? [] : previous;
            const next = [...new Map([...previous, ...selectedInferenceChoices].map(choice => [choice.id, choice])).values()];
            return next.length === previous.length && next.every((choice, index) => choice === previous[index]) ? previous : next;
        });
    }, [showInferenceMenu, selectedInferenceChoices]);

    const toggleInferenceChoice = (choice: InferenceChoice, checked: boolean) => {
        if (choice.kind === 'model') {
            toggleModel(choice.name);
        } else if (choice.kind === 'sigine') {
            updateSigineSelection(checked, choice.selection);
        } else {
            if (!useModelMultiSelect) setSelectedModelNames(effectiveSelectedModelNames);
            setUseModelMultiSelect(true);
            setSimilaritySearchSelected(checked);
            setSimilaritySearchConfig(checked ? choice.config : null);
        }
    };

    const summaryChoices = [...new Map([...retainedInferenceChoices, ...selectedInferenceChoices].map(choice => [choice.id, choice])).values()];

    const renderInferenceChoices = () => (
        <>
            <details open>
                <summary>{language === 'zh' ? '已选模型' : 'Selected models'} ({selectedInferenceChoices.length})</summary>
                {summaryChoices.length > 0
                    ? summaryChoices.map(choice => {
                        const checked = selectedInferenceChoices.some(selected => selected.id === choice.id);
                        return <label key={choice.id} className='InferenceMenuRow' data-selected={checked}>
                            <input type='checkbox' checked={checked}
                                data-source-id={choice.kind === 'sigine' ? choice.selection?.source_id : undefined}
                                data-model-id={choice.kind === 'sigine' ? choice.selection?.model : undefined}
                                onChange={event => toggleInferenceChoice(choice, event.target.checked)}/>
                            {choice.label}
                        </label>;
                    })
                    : <div className='InferenceMenuStatus'>{language === 'zh' ? '暂未选择模型' : 'No models selected'}</div>}
            </details>
            <details open={openWhen(hasBuiltinSelection)}>
                <summary>{language === 'zh' ? '内置模型' : 'Built-in models'} ({builtinModelCount})</summary>
                <details open={openWhen(hasSelectedModel)}>
                    <summary>{language === 'zh' ? '开源模型' : 'Open-source models'}</summary>
                    <details open={openWhen(hasCustomSelected)}>
                        <summary>{language === 'zh' ? '自定义' : 'Custom'}</summary>
                        {renderCustomLoaderRows()}
                        {modelDropdownEntries.filter(e => e.group === 'custom').map(renderModelRow)}
                    </details>
                    <details open={openWhen(hasDetectionSelected)}>
                        <summary>{language === 'zh' ? '检测模型' : 'Detection models'}</summary>
                        {modelDropdownEntries.filter(e => e.group === 'models' && e.task === 'detect').map(renderModelRow)}
                        {YOLO_MODEL_FAMILIES.filter(family => !loadedFamilyIds.has(family.id)).map(renderFamilyCatalogRow)}
                    </details>
                    <details open={openWhen(hasSegmentationSelected)}>
                        <summary>{language === 'zh' ? '分割模型' : 'Segmentation models'}</summary>
                        {modelDropdownEntries.filter(e => e.group === 'models' && e.task === 'segment').map(renderModelRow)}
                        {SEG_MODEL_FAMILIES.filter(family => !loadedFamilyIds.has(family.id)).map(renderFamilyCatalogRow)}
                    </details>
                </details>
                <details open={openWhen(hasSelectedSimilarity)}>
                    <summary>
                        {language === 'zh' ? '检索方案' : 'Retrieval plan'}
                        {similarityConfigSummary && ` (${similarityConfigSummary})`}
                    </summary>
                    {renderSimilarityOptions()}
                </details>
            </details>
            <details open={openWhen(sigineInfraSelected)}>
                <summary>{language === 'zh' ? '外部模型' : 'External models'} ({sigineModelCount ?? '—'})</summary>
                {renderSigineInfraChoice()}
            </details>
        </>
    );

    const renderInferenceButton = () => (
        <button
            data-action='run-inference'
            disabled={inferenceDisabled}
            onClick={() => {
                if (isFullImageInferenceInProgress) {
                    multiInferenceCancelledRef.current = true;
                    updateFullImageInferenceStatus(false);
                } else {
                    void runInference();
                }
            }}
            style={{
                background: isFullImageInferenceInProgress ? '#c62828' : '#333',
                color: inferenceDisabled
                    ? '#666'
                    : isFullImageInferenceInProgress ? '#fff' : '#ccc',
                border: '1px solid #555',
                borderRadius: 4,
                height: 22,
                lineHeight: '16px',
                padding: '0 10px',
                fontSize: 11,
                cursor: inferenceDisabled
                    ? 'not-allowed'
                    : 'pointer',
                whiteSpace: 'nowrap',
                boxSizing: 'border-box',
            }}
        >
            {isFullImageInferenceInProgress
                ? (language === 'zh' ? '停止' : 'Stop')
                : (() => {
                    const label = trackingMode
                        ? (language === 'zh' ? '检索' : 'Retrieve')
                        : (language === 'zh' ? '推理' : 'Infer');
                    // 时间轴选区优先显示帧数
                    if (timelineRange) {
                        const rangeCount = timelineRange.endFrame - timelineRange.startFrame + 1;
                        return `${label} x${rangeCount}`;
                    }
                    const selected = imagesData.filter((img: ImageData) => img.isSelected);
                    const count = selected.length > 0 ? selected.length : imagesData.length > 0 ? 1 : 0;
                    return `${label} x${count}`;
                })()}
        </button>
    );

    useEffect(() => {
        if (!showInferenceMenu) return undefined;
        const anchor = inferenceMenuRef.current;
        const menu = anchor?.querySelector<HTMLElement>('.InferenceModelMenu');
        if (!menu) return undefined;
        const fitViewport = () => {
            const anchorRect = anchor.getBoundingClientRect();
            const right = document.documentElement.clientWidth - 8;
            menu.style.left = `${Math.max(8 - anchorRect.left, Math.min(0, right - anchorRect.left - menu.offsetWidth))}px`;
            menu.style.maxHeight = `${Math.max(160, window.innerHeight - anchorRect.bottom - 10)}px`;
        };
        fitViewport();
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fitViewport) : null;
        observer?.observe(menu);
        observer?.observe(anchor);
        window.addEventListener('resize', fitViewport);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', fitViewport);
        };
    }, [showInferenceMenu]);

    const renderModelSelector = () => (
        <div ref={inferenceMenuRef} style={{
            position: 'relative', display: 'flex', alignItems: 'center',
            width: 186, maxWidth: '100%', minWidth: 0,
        }}>
            <button
                title={modelButtonLabel}
                data-action='select-inference-model'
                disabled={isFullImageInferenceInProgress}
                onClick={() => setShowInferenceMenu(v => !v)}
                style={{
                    background: '#333',
                    color: imagesData.length === 0 ? '#666' : '#ccc',
                    border: '1px solid #555',
                    borderRadius: 4,
                    fontSize: 11,
                    height: 22,
                    lineHeight: '16px',
                    padding: '0 20px 0 6px',
                    cursor: 'default',
                    outline: 'none',
                    width: '100%',
                    minWidth: 92,
                    maxWidth: 186,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    position: 'relative',
                    textAlign: 'left',
                    boxSizing: 'border-box',
                }}
            >
                {modelButtonLabel}
                {hasPreScript && <span title={language === 'zh' ? '已激活自定义前处理脚本' : 'Custom preprocess script active'} style={{ color: '#5cc98a', fontWeight: 700 }}>*</span>}
                {hasPostScript && <span title={language === 'zh' ? '已激活自定义后处理脚本' : 'Custom postprocess script active'} style={{ color: '#5cc98a', fontWeight: 700 }}>*</span>}
                <span style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', fontSize: 9, pointerEvents: 'none' }}>▼</span>
            </button>
            {showInferenceMenu && (
                <div className="InferenceModelMenu" style={{
                    position: 'absolute',
                    top: 'calc(100% + 2px)',
                    left: 0,
                    zIndex: 9999,
                    background: '#2a2a2a',
                    border: '1px solid #555',
                    borderRadius: 4,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    overflow: 'auto',
                }}>
                    {renderInferenceChoices()}
                </div>
            )}
        </div>
    );

    const annotationToolButtons = useMemo(() => {
        if (imagesData.length === 0) return null;
        const activeImageData = LabelsSelector.getActiveImageData();
        const hasAnyLabel = imagesData.length > 0 && (
            imageHasLabels(activeImageData)
        );

        return <>
            {isSAMLoaded && getButtonWithTooltip(
                'smart-annotation',
                getSmartAnnotationTooltip(smartAnnotationActive, samNegativeMode, language),
                'ico/cross-hair.png',
                'smart-annotation',
                smartAnnotationActive && !eraserMode,
                undefined,
                smartAnnotationOnClick,
                false,
                smartAnnotationOnDoubleClick,
                smartAnnotationActive && samNegativeMode ? 'active-negative' : undefined,
            )}
            {isTrackingModelLoaded && getButtonWithTooltip(
                'object-tracking',
                language === 'zh' ? '检索' : 'Retrieve',
                'ico/tracking.png',
                'object-tracking',
                trackingMode && !eraserMode,
                undefined,
                trackingOnClick,
            )}
            {hasAnyLabel && getButtonWithTooltip(
                'eraser',
                language === 'zh'
                    ? (eraserFineMode ? '局部擦除' : '整体擦除')
                    : (eraserFineMode ? 'Local erase' : 'Whole erase'),
                eraserFineMode ? 'ico/eraser.png' : 'ico/eraser-fine.png',
                'eraser',
                eraserMode,
                undefined,
                eraserOnClick
            )}
        </>;
    }, [imagesData, activeImageIndex, isSAMLoaded, smartAnnotationActive, samNegativeMode, smartAnnotationOnClick, smartAnnotationOnDoubleClick, isTrackingModelLoaded, trackingOnClick, trackingMode, trackingInProgress, currentTexts, eraserMode, eraserFineMode, eraserOnClick, language]);

    const renderZoomGroup = (groupRef?: React.Ref<HTMLDivElement>) => (
        <div className='ButtonWrapper' ref={groupRef}>
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
    );

    const renderAnnotationTools = (groupRef?: React.Ref<HTMLDivElement>) => (
        <div className='ButtonWrapper' ref={groupRef}>
            {(() => {
                const {anyVisible, isDisabled, icon} = getLabelToggleState(imagesData.length, imageAIStates);
                return getButtonWithTooltip(
                    'toggle-ai-labels',
                    anyVisible ? '隐藏标签' : '显示标签',
                    icon,
                    'toggle-ai-labels',
                    !isDisabled && anyVisible,
                    undefined,
                    isDisabled ? undefined : toggleAILabelsOnClick,
                    isDisabled
                );
            })()}
            {annotationToolButtons}
        </div>
    );

    const renderAcceptReject = (groupRef?: React.Ref<HTMLDivElement>) => withAI ? (
        <div className='ButtonWrapper' ref={groupRef}>
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
        </div>
    ) : null;

    const bindGroupRef = (key: ToolbarGroupKey) => (el: HTMLDivElement | null) => {
        toolbarGroupRefs.current[key] = el;
    };

    const renderToolbarOverflow = () => collapsedToolbarGroups.length === 0 ? null : (
        <div className='ToolbarOverflow' ref={toolbarOverflowRef}>
            <button
                type='button'
                className='ToolbarOverflowButton'
                aria-label={language === 'zh' ? '更多工具' : 'More tools'}
                title={language === 'zh' ? '更多工具' : 'More tools'}
                aria-expanded={toolbarOverflowOpen}
                onClick={() => setToolbarOverflowOpen(open => !open)}
            >
                <span aria-hidden='true'>···</span>
            </button>
            {toolbarOverflowOpen && (
                <div
                    className='ToolbarOverflowMenu'
                    onClick={() => setToolbarOverflowOpen(false)}
                >
                    {collapsedToolbarGroups.includes('accept-reject') && renderAcceptReject()}
                    {collapsedToolbarGroups.includes('annotation-tools') && renderAnnotationTools()}
                    {collapsedToolbarGroups.includes('zoom') && renderZoomGroup()}
                    {collapsedToolbarGroups.includes('drawing-tools') && renderDrawingTools()}
                </div>
            )}
        </div>
    );

    const renderToolbarContent = () => (
        <>
            {renderToolbarOverflow()}
            {!collapsedToolbarGroups.includes('zoom') && renderZoomGroup(bindGroupRef('zoom'))}
            {!collapsedToolbarGroups.includes('drawing-tools') && renderDrawingTools(bindGroupRef('drawing-tools'))}
            {!collapsedToolbarGroups.includes('annotation-tools') && renderAnnotationTools(bindGroupRef('annotation-tools'))}
            <div className='ToolbarRightGroup' ref={toolbarRightRef}>
                {renderModelSelector()}
                {renderInferenceButton()}
            </div>
            {!collapsedToolbarGroups.includes('accept-reject') && renderAcceptReject(bindGroupRef('accept-reject'))}
        </>
    );

    return (
        <div className={getClassName()} ref={toolbarRef}>
            {renderToolbarContent()}
        </div>
    );
});

const mapDispatchToProps = {
    updateImageDragModeStatusAction: updateImageDragModeStatus,
    updateSmartAnnotationActiveStatusAction: updateSmartAnnotationActiveStatus,
    updateTrackingModeStatusAction: updateTrackingModeStatus,
    updateActivePopupTypeAction: updateActivePopupType,
    updateFullImageInferenceStatus: updateFullImageInferenceStatusAction,
    toggleImageAILabelsVisibility: toggleImageAILabelsVisibilityAction,
    toggleImageSegmentationLabelsVisibility: toggleImageSegmentationLabelsVisibilityAction,
    addInferenceHistory: addInferenceHistoryAction,
    updateActiveLabelType: updateActiveLabelTypeAction,
    updateActiveLabelViewType: updateActiveLabelViewTypeAction,
    updateEraserModeAction: updateEraserMode,
    updateSamNegativeModeAction: updateSamNegativeMode,
};

const mapStateToProps = (state: AppState) => ({
    activeContext: state.general.activeContext,
    imageDragMode: state.general.imageDragMode,
    smartAnnotationActive: state.general.smartAnnotationActive,
    samNegativeMode: state.general.samNegativeMode ?? false,
    trackingMode: state.general.trackingMode ?? false,
    trackingInProgress: state.general.trackingInProgress ?? false,
    eraserMode: state.general.eraserMode ?? false,
    eraserFineMode: state.general.eraserFineMode ?? false,
    isFullImageInferenceInProgress: state.ai.isFullImageInferenceInProgress,
    imageAIStates: state.ai.imageAIStates,
    activeLabelType: state.labels.activeLabelType,
    activeLabelViewType: state.labels.activeLabelViewType,
    language: state.general.language,
    isAIDisabled: state.ai.isAIDisabled,
    activeImageIndex: state.labels.activeImageIndex,
    imagesData: state.labels.imagesData,
    hasDetectionModel: AIModelsSelector.hasModelsOfType(state, 'core') || DetectionAPIDetector.isEnabled(),
    hasExtensionEngine: AIModelsSelector.hasModelsOfType(state, 'extension'),
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditorTopNavigationBar);
