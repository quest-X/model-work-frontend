import React from 'react';
import './InferenceToggle.scss';
import {connect} from 'react-redux';
import {AppState} from '../../../store';
import {updateDisabledAIFlag, updateFullImageInferenceStatus} from '../../../store/ai/actionCreators';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {AISelector} from '../../../store/selectors/AISelector';
import {LabelsSelector} from '../../../store/selectors/LabelsSelector';
import {AISegmentationActions} from '../../../logic/actions/AISegmentationActions';
import {SegmentationAPIDetector} from '../../../ai/SegmentationAPIDetector';
import {EditorModel} from '../../../staticModels/EditorModel';
import {ImageUtil} from '../../../utils/ImageUtil';
import {AIModelsSelector} from '../../../store/selectors/AIModelsSelector';

interface IProps {
    isAIDisabled: boolean;
    language: Language;
    isFullImageInferenceInProgress: boolean;
    updateDisabledAIFlag: (isAIDisabled: boolean) => any;
    updateFullImageInferenceStatus: (isInProgress: boolean) => any;
    aiModels: any;
}

const InferenceToggle: React.FC<IProps> = ({
    isAIDisabled, 
    language, 
    isFullImageInferenceInProgress,
    updateDisabledAIFlag, 
    updateFullImageInferenceStatus,
    aiModels
}) => {
    const currentTexts = LanguageConfig[language];
    
    // 检查是否有可用的分割模型（只检查用户接入的模型）
    const hasSegmentationModel = () => {
        return AIModelsSelector.hasModelsOfType(aiModels, 'segmentation');
    };
    
    const handleToggle = () => {
        // 如果没有分割模型，不允许开启
        if (!hasSegmentationModel()) {
            console.log('⚠️ 没有可用的分割模型，无法开启分割功能');
            return;
        }
        const newDisabledState = !isAIDisabled;
        updateDisabledAIFlag(newDisabledState);
        
        // 分割开关只控制功能的启用/禁用，不自动触发分割
        // 分割只在用户手动画完标注框后触发
    };

    const triggerSegmentation = () => {
        const activeImageData = LabelsSelector.getActiveImageData();
        
        if (!activeImageData) {
            console.error('❌ 没有活动图像数据，无法执行分割');
            return;
        }

        if (isFullImageInferenceInProgress) {
            console.log('🔄 分割正在进行中，忽略请求');
            return;
        }

        // 获取分割模型并检查可用性（强制使用用户接入的模型）
        const segmentationModel = AIModelsSelector.getActiveModelByType(aiModels, 'segmentation');
        if (!segmentationModel) {
            console.error('❌ 没有可用的分割模型，请先接入分割类型的AI模型');
            return;
        }

        if (!segmentationModel.url) {
            console.error('❌ 分割模型URL未配置');
            return;
        }

        console.log('🔍 分割开关触发：开始目标分割...');
        console.log('🚀 使用自定义分割模型:', segmentationModel.name);

        // 获取整个图像的边界框
        const realImageSize = EditorModel.image ? ImageUtil.getSize(EditorModel.image) : { width: 1000, height: 1000 };
        const imageRect = {
            x: 0,
            y: 0,
            width: realImageSize.width,
            height: realImageSize.height
        };

        // 设置分割状态为进行中
        updateFullImageInferenceStatus(true);
        
        // TODO: 调用用户自定义的分割模型接口
        console.log('🔄 调用自定义分割模型API...');
        // 暂时仍使用原有接口，后续需要创建新的自定义模型调用接口
        AISegmentationActions.segmentBbox(activeImageData, imageRect);
    };

    const isInferenceEnabled = !isAIDisabled;
    const modelAvailable = hasSegmentationModel();
    
    // 显示当前状态：根据模型可用性和启用状态显示不同文本
    const buttonText = (() => {
        if (!modelAvailable) {
            return currentTexts.editorTopNavBar.cannotSegment; // 显示无法分割
        }
        return isInferenceEnabled ? 
            currentTexts.editorTopNavBar.enableSegmentation : 
            currentTexts.editorTopNavBar.disableSegmentation;
    })();
    
    const tooltipText = (() => {
        if (!modelAvailable) {
            return language === Language.CHINESE ? '没有可用的分割模型' : 'No segmentation model available';
        }
        return isInferenceEnabled ? 
            currentTexts.editorTopNavBar.disableSegmentation : 
            currentTexts.editorTopNavBar.enableSegmentation;
    })();
    
    // 确定组件的状态类名
    const getToggleClassName = () => {
        if (!modelAvailable) {
            return 'InferenceToggle disabled unavailable'; // 不可用状态
        }
        return `InferenceToggle ${isInferenceEnabled ? 'enabled' : 'disabled'}`;
    };

    return (
        <div 
            className={getToggleClassName()}
            onClick={modelAvailable ? handleToggle : undefined}
            title={tooltipText}
        >
            <span className="toggle-label">
                {buttonText}
            </span>
            <div className="toggle-switch">
                <div className="toggle-slider"></div>
            </div>
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    isAIDisabled: state.ai.isAIDisabled,
    isFullImageInferenceInProgress: state.ai.isFullImageInferenceInProgress,
    language: state.general.language,
    aiModels: state
});

const mapDispatchToProps = {
    updateDisabledAIFlag,
    updateFullImageInferenceStatus
};

export default connect(mapStateToProps, mapDispatchToProps)(InferenceToggle);
