import React, { useState, useEffect } from 'react';
import './ManageAIModelsPopup.scss';
import { GenericYesNoPopup } from '../GenericYesNoPopup/GenericYesNoPopup';
import { PopupWindowType } from '../../../data/enums/PopupWindowType';
import { updateActivePopupType } from '../../../store/general/actionCreators';
import { addAIModel, setActiveAIModel, deleteAIModel } from '../../../store/aimodels/actionCreators';
import { AppState } from '../../../store';
import { connect } from 'react-redux';
import Scrollbars from 'react-custom-scrollbars-2';
import { ImageButton } from '../../Common/ImageButton/ImageButton';
import { AIModel } from '../../../store/aimodels/types';
import { Language, LanguageConfig } from '../../../data/LanguageConfig';
import { v4 as uuidv4 } from 'uuid';
import { StyledTextField } from '../../Common/StyledTextField/StyledTextField';
import { YOLO_MODEL_FAMILIES, getServerUrl } from '../LoadModelPopup/LoadModelPopup';

interface IProps {
    updateActivePopupTypeAction: (activePopupType: PopupWindowType) => any;
    addAIModelAction: (model: AIModel) => any;
    setActiveAIModelAction: (modelId: string | null) => any;
    deleteAIModelAction: (modelId: string) => any;
    aiModels: AIModel[];
    activeModelId: string | null;
    language: Language;
}

const ManageAIModelsPopup: React.FC<IProps> = ({
    updateActivePopupTypeAction,
    addAIModelAction,
    setActiveAIModelAction,
    deleteAIModelAction,
    aiModels,
    activeModelId,
    language
}) => {
    const currentTexts = LanguageConfig[language];
    const [selectedModelId, setSelectedModelId] = useState<string | null>(activeModelId);
    const [isEditing, setIsEditing] = useState(false);
    const [editingModel, setEditingModel] = useState<AIModel | null>(null);

    useEffect(() => {
        if (aiModels.length > 0 && !selectedModelId) {
            setSelectedModelId(aiModels[0].id);
        }
    }, [aiModels, selectedModelId]);

    const onAccept = () => {
        if (selectedModelId) {
            setActiveAIModelAction(selectedModelId);
        }
        updateActivePopupTypeAction(null);
    };

    const onReject = () => {
        updateActivePopupTypeAction(null);
    };

    const addNewModel = () => {
        updateActivePopupTypeAction(PopupWindowType.INTEGRATE_AI_MODEL);
    };

    const selectModel = (modelId: string) => {
        setSelectedModelId(modelId);
        setIsEditing(false);
        setEditingModel(null);
    };

    const editModel = (model: AIModel) => {
        setEditingModel({ ...model });
        setIsEditing(true);
    };

    const deleteModel = (modelId: string) => {
        deleteAIModelAction(modelId);
        if (selectedModelId === modelId) {
            const remainingModels = aiModels.filter(m => m.id !== modelId);
            setSelectedModelId(remainingModels.length > 0 ? remainingModels[0].id : null);
        }
    };

    const saveEditingModel = () => {
        if (editingModel) {
            addAIModelAction(editingModel); // 这里会通过reducer的UPDATE逻辑来更新
            setIsEditing(false);
            setEditingModel(null);
        }
    };

    const cancelEditing = () => {
        setIsEditing(false);
        setEditingModel(null);
    };

    // 本地模型状态
    const [availableLocalModels, setAvailableLocalModels] = useState<string[]>([]);

    useEffect(() => {
        const serverUrl = getServerUrl();
        fetch(`${serverUrl}/available-models`)
            .then(r => r.json())
            .then(data => { if (data.models) setAvailableLocalModels(data.models); })
            .catch(() => {});
    }, []);

    const openLocalModelManager = () => {
        updateActivePopupTypeAction(PopupWindowType.LOAD_AI_MODEL);
    };

    const getLocalDownloadedCount = (familyId: string): number => {
        const family = YOLO_MODEL_FAMILIES.find(f => f.id === familyId);
        if (!family) return 0;
        return family.variants.filter(v => availableLocalModels.includes(v)).length;
    };

    const renderLocalModels = () => {
        return (
            <div className='LocalModelsSection'>
                <div className='SectionTitle'>
                    {language === Language.CHINESE ? '本地模型' : 'Local Models'}
                    <span className='ManageLink' onClick={openLocalModelManager}>
                        {language === Language.CHINESE ? '管理' : 'Manage'}
                    </span>
                </div>
                <div className='LocalModelsList'>
                    {YOLO_MODEL_FAMILIES.map(family => {
                        const downloaded = getLocalDownloadedCount(family.id);
                        return (
                            <div key={family.id} className={`LocalModelEntry${downloaded > 0 ? ' has-models' : ''}`}>
                                <div className='LocalModelName'>{family.name}</div>
                                <div className='LocalModelStatus'>
                                    {downloaded > 0 ? (
                                        <span className='downloaded'>{downloaded}/{family.variants.length}</span>
                                    ) : (
                                        <span className='none'>—</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const updateEditingField = (field: keyof AIModel, value: string) => {
        if (editingModel) {
            setEditingModel({
                ...editingModel,
                [field]: value
            });
        }
    };

    const renderModelList = () => {
        if (aiModels.length === 0) {
            return (
                <div className='EmptyList' onClick={addNewModel}>
                    <img
                        draggable={false}
                        alt={'ai-models'}
                        src={'ico/robot.png'}
                    />
                    <p className='extraBold'>
                        {language === Language.CHINESE ? '暂无AI模型' : 'No AI Models'}
                    </p>
                    <p>
                        {language === Language.CHINESE ? '点击添加第一个AI模型' : 'Click to add your first AI model'}
                    </p>
                </div>
            );
        }

        return (
            <Scrollbars>
                <div className='ManageAIModelsPopupContent'>
                    {aiModels.map((model, index) => (
                        <div 
                            key={model.id} 
                            className={`ModelEntry ${selectedModelId === model.id ? 'selected' : ''}`}
                            onClick={() => selectModel(model.id)}
                        >
                            <div className='ModelIndex'>
                                {index + 1}
                            </div>
                            <div className='ModelName'>
                                {model.name || model.url}
                            </div>
                            <div className='ModelActions'>
                                <ImageButton
                                    image={'ico/more.png'}
                                    imageAlt={'edit'}
                                    buttonSize={{ width: 20, height: 20 }}
                                    padding={8}
                                    onClick={() => editModel(model)}
                                />
                                <ImageButton
                                    image={'ico/trash.png'}
                                    imageAlt={'delete'}
                                    buttonSize={{ width: 20, height: 20 }}
                                    padding={8}
                                    onClick={() => deleteModel(model.id)}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </Scrollbars>
        );
    };

    const renderModelDetails = () => {
        const selectedModel = aiModels.find(m => m.id === selectedModelId);
        
        if (isEditing && editingModel) {
            return (
                <div className='ModelDetails editing'>
                    <div className='ModelField'>
                        <StyledTextField
                            variant='standard'
                            label={language === Language.CHINESE ? '模型名称' : 'Model Name'}
                            value={editingModel.name}
                            onChange={(e) => updateEditingField('name', e.target.value)}
                            style={{ width: '100%', marginBottom: '16px' }}
                        />
                    </div>
                    <div className='ModelField'>
                        <StyledTextField
                            variant='standard'
                            label={language === Language.CHINESE ? '模型地址' : 'Model URL'}
                            value={editingModel.url}
                            onChange={(e) => updateEditingField('url', e.target.value)}
                            style={{ width: '100%', marginBottom: '16px' }}
                        />
                    </div>
                    <div className='ModelField'>
                        <StyledTextField
                            variant='standard'
                            type='password'
                            label={language === Language.CHINESE ? 'API密钥 (可选)' : 'API Key (optional)'}
                            value={editingModel.apiKey || ''}
                            onChange={(e) => updateEditingField('apiKey', e.target.value)}
                            style={{ width: '100%', marginBottom: '16px' }}
                        />
                    </div>
                    <div className='ModelField'>
                        <StyledTextField
                            variant='standard'
                            multiline
                            rows={3}
                            label={language === Language.CHINESE ? '模型描述 (可选)' : 'Description (optional)'}
                            value={editingModel.description || ''}
                            onChange={(e) => updateEditingField('description', e.target.value)}
                            style={{ width: '100%', marginBottom: '16px' }}
                        />
                    </div>
                    <div className='EditActions'>
                        <ImageButton
                            image={'ico/ok.png'}
                            imageAlt={'save'}
                            buttonSize={{ width: 30, height: 30 }}
                            padding={10}
                            onClick={saveEditingModel}
                        />
                        <ImageButton
                            image={'ico/cancel.png'}
                            imageAlt={'cancel'}
                            buttonSize={{ width: 30, height: 30 }}
                            padding={10}
                            onClick={cancelEditing}
                        />
                    </div>
                </div>
            );
        }

        if (!selectedModel) {
            return (
                <div className='ModelDetails empty'>
                    <p>{language === Language.CHINESE ? '请选择一个模型查看详情' : 'Select a model to view details'}</p>
                </div>
            );
        }

        return (
            <div className='ModelDetails'>
                <div className='ModelField header'>
                    <div className='model-name-section'>
                        <label>{language === Language.CHINESE ? '模型名称' : 'Model Name'}</label>
                        <span className='model-name'>{selectedModel.name || 'Unnamed Model'}</span>
                    </div>
                    <div className='created-time-section'>
                        <label>{language === Language.CHINESE ? '添加时间' : 'Added'}</label>
                        <span className='created-time'>{new Date(selectedModel.createdAt).toLocaleString()}</span>
                    </div>
                </div>
                <div className='ModelField'>
                    <label>{language === Language.CHINESE ? '接口地址' : 'API Endpoint'}:</label>
                    <span className='url'>{selectedModel.url}</span>
                </div>
                <div className='ModelField'>
                    <label>{language === Language.CHINESE ? '模型密钥' : 'API Key'}:</label>
                    <span>{selectedModel.apiKey ? '••••••••' : (language === Language.CHINESE ? '无' : 'None')}</span>
                </div>
                <div className='ModelField'>
                    <label>{language === Language.CHINESE ? '模型描述' : 'Description'}:</label>
                    <span>{selectedModel.description || (language === Language.CHINESE ? '暂无描述' : 'No description')}</span>
                </div>
            </div>
        );
    };

    const renderContent = () => {
        return (
            <div className='ManageAIModelsPopup'>
                <div className='LeftContainer'>
                    <ImageButton
                        image={'ico/plus.png'}
                        imageAlt={'add'}
                        buttonSize={{ width: 40, height: 40 }}
                        padding={25}
                        onClick={addNewModel}
                        externalClassName={'monochrome'}
                    />
                </div>
                <div className='RightContainer'>
                    <div className='Message'>
                        {language === Language.CHINESE ? 
                            '管理您的AI模型。您可以添加、编辑或删除模型，选择要使用的默认模型。' : 
                            'Manage your AI models. You can add, edit or delete models, and select a default model to use.'}
                    </div>
                    <div className='ContentArea'>
                        <div className='ModelsListContainer'>
                            {renderLocalModels()}
                            <div className='SectionTitle'>
                                {language === Language.CHINESE ? '远程模型' : 'Remote Models'}
                            </div>
                            <div className='ModelsContainer'>
                                {renderModelList()}
                            </div>
                        </div>
                        <div className='ModelDetailsContainer'>
                            <div className='SectionTitle'>
                                {language === Language.CHINESE ? '模型详情' : 'Model Details'}
                            </div>
                            {renderModelDetails()}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <GenericYesNoPopup
            title={language === Language.CHINESE ? 'AI模型管理' : 'AI Models Management'}
            renderContent={renderContent}
            acceptLabel={language === Language.CHINESE ? '确定' : 'OK'}
            onAccept={onAccept}
            rejectLabel={language === Language.CHINESE ? '关闭' : 'Close'}
            onReject={onReject}
        />
    );
};

const mapDispatchToProps = {
    updateActivePopupTypeAction: updateActivePopupType,
    addAIModelAction: addAIModel,
    setActiveAIModelAction: setActiveAIModel,
    deleteAIModelAction: deleteAIModel
};

const mapStateToProps = (state: AppState) => ({
    aiModels: state.aimodels.models,
    activeModelId: state.aimodels.activeModelId,
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ManageAIModelsPopup);
