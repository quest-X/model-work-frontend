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
                    {currentTexts.modelManagement.localModels}
                    <span className='ManageLink' onClick={openLocalModelManager}>
                        {currentTexts.modelManagement.manage}
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
                        {currentTexts.modelManagement.noModels}
                    </p>
                    <p>
                        {currentTexts.modelManagement.noModelsHint}
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
                            label={currentTexts.modelManagement.modelName}
                            value={editingModel.name}
                            onChange={(e) => updateEditingField('name', e.target.value)}
                            style={{ width: '100%', marginBottom: '16px' }}
                        />
                    </div>
                    <div className='ModelField'>
                        <StyledTextField
                            variant='standard'
                            label={currentTexts.modelManagement.modelUrl}
                            value={editingModel.url}
                            onChange={(e) => updateEditingField('url', e.target.value)}
                            style={{ width: '100%', marginBottom: '16px' }}
                        />
                    </div>
                    <div className='ModelField'>
                        <StyledTextField
                            variant='standard'
                            type='password'
                            label={currentTexts.modelManagement.apiKeyOptional}
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
                            label={currentTexts.modelManagement.descriptionOptional}
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
                    <p>{currentTexts.modelManagement.selectModelHint}</p>
                </div>
            );
        }

        return (
            <div className='ModelDetails'>
                <div className='ModelField header'>
                    <div className='model-name-section'>
                        <label>{currentTexts.modelManagement.modelName}</label>
                        <span className='model-name'>{selectedModel.name || currentTexts.modelManagement.unnamedModel}</span>
                    </div>
                    <div className='created-time-section'>
                        <label>{language === Language.CHINESE ? '添加时间' : 'Added'}</label>
                        <span className='created-time'>{new Date(selectedModel.createdAt).toLocaleString()}</span>
                    </div>
                </div>
                <div className='ModelField'>
                    <label>{currentTexts.modelManagement.apiEndpoint}:</label>
                    <span className='url'>{selectedModel.url}</span>
                </div>
                <div className='ModelField'>
                    <label>{currentTexts.modelManagement.apiKey}:</label>
                    <span>{selectedModel.apiKey ? '••••••••' : currentTexts.modelManagement.none}</span>
                </div>
                <div className='ModelField'>
                    <label>{currentTexts.modelManagement.description}:</label>
                    <span>{selectedModel.description || currentTexts.modelManagement.noDescription}</span>
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
                        {currentTexts.modelManagement.manageMessage}
                    </div>
                    <div className='ContentArea'>
                        <div className='ModelsListContainer'>
                            {renderLocalModels()}
                            <div className='SectionTitle'>
                                {currentTexts.modelManagement.remoteModels}
                            </div>
                            <div className='ModelsContainer'>
                                {renderModelList()}
                            </div>
                        </div>
                        <div className='ModelDetailsContainer'>
                            <div className='SectionTitle'>
                                {currentTexts.modelManagement.modelDetails}
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
            title={currentTexts.modelManagement.title}
            renderContent={renderContent}
            acceptLabel={currentTexts.ok}
            onAccept={onAccept}
            rejectLabel={currentTexts.modelManagement.close}
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
