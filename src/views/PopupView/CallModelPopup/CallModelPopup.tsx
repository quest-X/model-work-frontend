import React, {useState, useEffect} from 'react';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import './CallModelPopup.scss'
import {updateActivePopupType as storeUpdateActivePopupType} from '../../../store/general/actionCreators';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {GeneralActionTypes} from '../../../store/general/types';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {AIModel} from '../../../store/aimodels/types';

export interface YOLOModelFamily {
    id: string;
    name: string;
    variants: string[];
}

export const YOLO_MODEL_FAMILIES: YOLOModelFamily[] = [
    { id: 'yolo26', name: 'ultralytics/yolo26', variants: ['yolo26n', 'yolo26s', 'yolo26m', 'yolo26l', 'yolo26x'] },
    { id: 'yolo12', name: 'ultralytics/yolo12', variants: ['yolo12n', 'yolo12s', 'yolo12m', 'yolo12l', 'yolo12x'] },
    { id: 'yolo11', name: 'ultralytics/yolo11', variants: ['yolo11n', 'yolo11s', 'yolo11m', 'yolo11l', 'yolo11x'] },
    { id: 'yolov10', name: 'ultralytics/yolov10', variants: ['yolov10n', 'yolov10s', 'yolov10m', 'yolov10l', 'yolov10x'] },
    { id: 'yolov9', name: 'ultralytics/yolov9', variants: ['yolov9t', 'yolov9s', 'yolov9m', 'yolov9c', 'yolov9e'] },
    { id: 'yolov8', name: 'ultralytics/yolov8', variants: ['yolov8n', 'yolov8s', 'yolov8m', 'yolov8l', 'yolov8x'] },
];

export const SEG_MODEL_FAMILIES: YOLOModelFamily[] = [
    { id: 'yolov8-seg', name: 'ultralytics/yolov8-seg', variants: ['yolov8n-seg', 'yolov8s-seg', 'yolov8m-seg', 'yolov8l-seg', 'yolov8x-seg'] },
    { id: 'yolo11-seg', name: 'ultralytics/yolo11-seg', variants: ['yolo11n-seg', 'yolo11s-seg', 'yolo11m-seg', 'yolo11l-seg', 'yolo11x-seg'] },
    { id: 'sam2', name: 'ultralytics/SAM 2', variants: ['sam2.1_t', 'sam2.1_s', 'sam2.1_b', 'sam2.1_l'] },
    { id: 'mobile-sam', name: 'ultralytics/MobileSAM', variants: ['mobile_sam'] },
    { id: 'fast-sam', name: 'ultralytics/FastSAM', variants: ['FastSAM-s', 'FastSAM-x'] },
];

// Module-level state shared between CallModelPopup and LoadDetectionModelPopup
let _selectedModelFamily: YOLOModelFamily | null = null;
let _serverUrl: string = 'http://localhost:8000';
let _selectedCustomExt: 'pt' | 'onnx' | null = null;

export const getSelectedModelFamily = (): YOLOModelFamily | null => _selectedModelFamily;
export const getServerUrl = (): string => _serverUrl;
export const getSelectedCustomExt = (): 'pt' | 'onnx' | null => _selectedCustomExt;

interface IProps {
    updateActivePopupType: (activePopupType: PopupWindowType) => GeneralActionTypes;
    language: Language;
    // 用户通过「模型引擎」popup 注册的推理服务列表。由 Redux aimodels store 提供。
    aiModels: AIModel[];
    activeAIModelId: string | null;
}

// 引擎 URL 形如 http://host:port/detect 或 /segment —— 剥掉后缀得到 base。
const stripInferenceSuffix = (url: string): string =>
    url.replace(/\/(detect|segment)\/?$/, '');

const CallModelPopup: React.FC<IProps> = ({
    updateActivePopupType,
    language,
    aiModels,
    activeAIModelId,
}) => {
    const currentTexts = LanguageConfig[language];
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [currentModelName, setCurrentModelName] = useState<string>('');
    const [currentSegModelName, setCurrentSegModelName] = useState<string>('');

    // 推理基础地址从已注册的引擎推导 —— 不再让用户在这个弹窗里填 URL。
    // 优先 active 引擎,退化到第一个注册的,最后兜底 localhost:8000。
    const activeEngine = aiModels.find(m => m.id === activeAIModelId) || aiModels[0] || null;
    const derivedBaseUrl = activeEngine
        ? stripInferenceSuffix(activeEngine.url)
        : 'http://localhost:8000';

    useEffect(() => {
        fetch(`${derivedBaseUrl}/available-models`)
            .then(r => r.json())
            .then(data => {
                if (!data.models) return;
                // Backend v2.1.1+ 返回 [{name, type}],老 backend 返回 [name] —— 两兼容
                const names: string[] = data.models.map((m: unknown) =>
                    typeof m === 'string' ? m : (m as { name: string }).name
                );
                setAvailableModels(names);
            })
            .catch(() => {});
        fetch(`${derivedBaseUrl}/health`)
            .then(r => r.json())
            .then(data => {
                if (data.model && data.model !== 'none') setCurrentModelName(data.model);
                if (data.segmentation_model) setCurrentSegModelName(data.segmentation_model);
            })
            .catch(() => {});
    }, [derivedBaseUrl]);

    const getDownloadedCount = (family: YOLOModelFamily): number => {
        return family.variants.filter(v => availableModels.includes(v)).length;
    };

    const onSelect = (id: string) => {
        setSelectedId(selectedId === id ? null : id);
    };

    const onAccept = () => {
        // 自定义 .pt / .onnx 上传
        if (selectedId === 'custom-pt' || selectedId === 'custom-onnx') {
            _selectedModelFamily = null;
            _serverUrl = derivedBaseUrl;
            _selectedCustomExt = selectedId === 'custom-onnx' ? 'onnx' : 'pt';
            updateActivePopupType(PopupWindowType.LOAD_DETECTION_MODEL);
            return;
        }
        // 本地内置 YOLO / SAM family —— 推送到 LoadDetectionModelPopup 走加载流程
        const family = YOLO_MODEL_FAMILIES.find(f => f.id === selectedId)
            || SEG_MODEL_FAMILIES.find(f => f.id === selectedId);
        if (!family) return;
        _selectedModelFamily = family;
        _serverUrl = derivedBaseUrl;
        _selectedCustomExt = null;
        updateActivePopupType(PopupWindowType.LOAD_DETECTION_MODEL);
    };

    const onReject = () => {
        PopupActions.close();
    };

    const isActiveFamily = (family: YOLOModelFamily): boolean => {
        const isSeg = SEG_MODEL_FAMILIES.some(f => f.id === family.id);
        const modelName = isSeg ? currentSegModelName : currentModelName;
        if (!modelName) return false;
        const baseName = modelName.replace('.pt', '');
        return family.variants.some(v => v === baseName);
    };

    const renderFamilyOption = (family: YOLOModelFamily) => {
        const isSelected = selectedId === family.id;
        const downloaded = getDownloadedCount(family);
        const total = family.variants.length;
        const isActive = isActiveFamily(family);
        return <div
            className={`OptionsItem${downloaded > 0 ? ' has-models' : ''}${isActive ? ' active-model' : ''}`}
            onClick={() => onSelect(family.id)}
            key={family.id}
        >
            <img
                draggable={false}
                src={isSelected ? 'ico/checkbox-checked.png' : 'ico/checkbox-unchecked.png'}
                alt={isSelected ? 'checked' : 'unchecked'}
            />
            {family.name}
            {downloaded > 0 && <span className='model-count'> ({downloaded}/{total})</span>}
            {isActive && <span className='active-badge'>✓ {(SEG_MODEL_FAMILIES.some(f => f.id === family.id) ? currentSegModelName : currentModelName).replace('.pt', '')}</span>}
        </div>
    };

    // 已注册的引擎按类型分组 —— 只用来控制下面两个 section 的显隐,不再单独渲染。
    const hasDetectionEngine = aiModels.some(m => m.modelType === 'detection');
    const hasSegmentationEngine = aiModels.some(m => m.modelType === 'segmentation');

    const zhTexts = language === Language.CHINESE;

    const renderContent = () => {
        return <div className='CallModelPopupContent'>
            <div className='ModelSection'>
                <div className='SectionHeader'>{zhTexts ? '自定义' : 'Custom'}</div>
                <div className='Options'>
                    <div
                        className='OptionsItem'
                        onClick={() => onSelect('custom-pt')}
                    >
                        <img
                            draggable={false}
                            src={selectedId === 'custom-pt' ? 'ico/checkbox-checked.png' : 'ico/checkbox-unchecked.png'}
                            alt={selectedId === 'custom-pt' ? 'checked' : 'unchecked'}
                        />
                        {zhTexts ? '模型 .pt 文件' : '.pt model file'}
                    </div>
                    <div
                        className='OptionsItem'
                        onClick={() => onSelect('custom-onnx')}
                    >
                        <img
                            draggable={false}
                            src={selectedId === 'custom-onnx' ? 'ico/checkbox-checked.png' : 'ico/checkbox-unchecked.png'}
                            alt={selectedId === 'custom-onnx' ? 'checked' : 'unchecked'}
                        />
                        {zhTexts ? '模型 .onnx 文件' : '.onnx model file'}
                    </div>
                    <div className='OptionsItem disabled'>
                        <img draggable={false} src={'ico/checkbox-unchecked.png'} alt={'unchecked'} />
                        {zhTexts ? '模型 .engine / .trt 文件（即将推出）' : '.engine / .trt model file (coming soon)'}
                    </div>
                </div>
            </div>
            {hasDetectionEngine && (
                <div className='ModelSection'>
                    <div className='SectionHeader'>{zhTexts ? '检测模型' : 'Detection Models'}</div>
                    <div className='Options'>
                        {YOLO_MODEL_FAMILIES.map(f => renderFamilyOption(f))}
                    </div>
                </div>
            )}
            {hasSegmentationEngine && (
                <div className='ModelSection'>
                    <div className='SectionHeader'>{zhTexts ? '分割模型' : 'Segmentation Models'}</div>
                    <div className='Options'>
                        {SEG_MODEL_FAMILIES.map(f => renderFamilyOption(f))}
                    </div>
                </div>
            )}
        </div>
    };

    const acceptDisabled = !selectedId;

    return (
        <GenericYesNoPopup
            title={currentTexts.popups.callModel.title}
            renderContent={renderContent}
            acceptLabel={currentTexts.popups.callModel.acceptButton}
            onAccept={onAccept}
            disableAcceptButton={acceptDisabled}
            rejectLabel={currentTexts.popups.callModel.rejectButton}
            onReject={onReject}
        />
    );
};

const mapDispatchToProps = {
    updateActivePopupType: storeUpdateActivePopupType,
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
    aiModels: state.aimodels.models,
    activeAIModelId: state.aimodels.activeModelId,
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CallModelPopup);
