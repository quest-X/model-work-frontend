import React, {useState, useEffect} from 'react';
import './TopNavigationBar.scss';
import StateBar from '../StateBar/StateBar';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {updateActivePopupType, updateProjectData, updateLanguage} from '../../../store/general/actionCreators';
import {Settings} from '../../../settings/Settings';
import {ProjectData} from '../../../store/general/types';
import DropDownMenu from './DropDownMenu/DropDownMenu';
import {TextButton} from '../../Common/TextButton/TextButton';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';

interface IProps {
    updateActivePopupTypeAction: (activePopupType: PopupWindowType) => any;
    updateProjectDataAction: (projectData: ProjectData) => any;
    updateLanguageAction: (language: Language) => any;
    projectData: ProjectData;
    language: Language;
    hasAIModels: boolean;
}

const TopNavigationBar: React.FC<IProps> = (props) => {
    const currentTexts = LanguageConfig[props.language];
    const [showActionsDropdown, setShowActionsDropdown] = useState(false);
    const [showModelsDropdown, setShowModelsDropdown] = useState(false);

    const onFocus = (event: React.FocusEvent<HTMLInputElement>) => {
        event.target.setSelectionRange(0, event.target.value.length);
    };

    const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
            .toLowerCase()
            .replace(' ', '-');

        props.updateProjectDataAction({
            ...props.projectData,
            name: value
        })
    };

    const closePopup = () => props.updateActivePopupTypeAction(PopupWindowType.EXIT_PROJECT)
    
    const showKeyboardShortcuts = () => props.updateActivePopupTypeAction(PopupWindowType.KEYBOARD_SHORTCUTS)
    
    const openLoadMoreMediaPopup = () => props.updateActivePopupTypeAction(PopupWindowType.IMPORT_IMAGES)

    const toggleModelsDropdown = () => {
        setShowModelsDropdown(!showModelsDropdown);
    };

    // 「模型引擎」按钮：有已接入的远程模型 → 打开管理弹窗，否则直接进入新增弹窗
    const openRemoteModelManager = () => {
        setShowModelsDropdown(false);
        const popupType = props.hasAIModels ? PopupWindowType.MANAGE_AI_MODELS : PopupWindowType.MODEL_ENGINE;
        props.updateActivePopupTypeAction(popupType);
    };

    // 「调用模型」按钮：打开本地模型挑选 / 加载弹窗
    const openLocalModelManager = () => {
        setShowModelsDropdown(false);
        props.updateActivePopupTypeAction(PopupWindowType.CALL_MODEL);
    };

    const openDataCenter = () => {
        setShowModelsDropdown(false);
        props.updateActivePopupTypeAction(PopupWindowType.DATA_CENTER);
    };

    const openTrainingTask = () => {
        setShowModelsDropdown(false);
        props.updateActivePopupTypeAction(PopupWindowType.TRAINING_TASK);
    };

    const toggleLanguage = () => {
        const newLanguage = props.language === Language.CHINESE ? Language.ENGLISH : Language.CHINESE;
        props.updateLanguageAction(newLanguage);
    };

    const toggleActionsDropdown = () => {
        setShowActionsDropdown(!showActionsDropdown);
    };

    // 点击外部关闭下拉菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Element;
            if (!target.closest('.ActionsDropdownContainer')) {
                setShowActionsDropdown(false);
            }
        };

        if (showActionsDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showActionsDropdown]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Element;
            if (!target.closest('.ModelsDropdownContainer')) {
                setShowModelsDropdown(false);
            }
        };

        if (showModelsDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showModelsDropdown]);

    return (
        <div className='TopNavigationBar'>
            <StateBar/>
            <div className='TopNavigationBarWrapper'>
                <div className='NavigationBarGroupWrapper left'>
                    <div
                        className='Header'
                        onClick={showKeyboardShortcuts}
                    >
                        <img
                            draggable={false}
                            alt={'make-sense'}
                            src={'/make-sense-ico-transparent.png'}
                        />
                        {currentTexts.makeSense}
                    </div>
                    <div className='ActionsDropdownContainer'>
                        <TextButton
                            label={currentTexts.actions.title}
                            onClick={toggleActionsDropdown}
                            externalClassName={'actions-button'}
                        />
                        {showActionsDropdown && <DropDownMenu isVisible={true}/>}
                    </div>
                    <div className='ModelsDropdownContainer'>
                        <TextButton
                            label={currentTexts.actions.integrateAIModel.name}
                            onClick={toggleModelsDropdown}
                            externalClassName={'ai-model-button'}
                        />
                        {showModelsDropdown && (
                            <div className='DropDownMenuContent ModelsDropdown'>
                                <div className='DropDownMenuContentOption active'
                                    onClick={openRemoteModelManager}>
                                    <div className='Marker'/>
                                    <img src='ico/api.png' alt='remote-models'/>
                                    {currentTexts.modelManagement.modelEngines}
                                </div>
                                <div className='DropDownMenuContentOption active'
                                    onClick={openLocalModelManager}>
                                    <div className='Marker'/>
                                    <img src='ico/ai.png' alt='local-models'/>
                                    {currentTexts.modelManagement.callModels}
                                </div>
                                <div className='DropDownMenuContentOption active'
                                    onClick={openDataCenter}>
                                    <div className='Marker'/>
                                    <img src='ico/api.png' alt='data-center'/>
                                    {currentTexts.modelManagement.dataCenter}
                                </div>
                                <div className='DropDownMenuContentOption active'
                                    onClick={openTrainingTask}>
                                    <div className='Marker'/>
                                    <img src='ico/ai.png' alt='training-task'/>
                                    {currentTexts.modelManagement.trainingTask}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <div
                    className='ProjectNameContainer'
                >
                    <div className='ProjectName'>{currentTexts.projectName}</div>
                    <div
                        className='ProjectNameInputWrapper'
                        data-value={props.projectData.name}
                    >
                        <input
                            type='text'
                            size={1}
                            value={props.projectData.name}
                            onChange={onChange}
                            onFocus={onFocus}
                        />
                    </div>
                </div>
                <div className='NavigationBarGroupWrapper right'>
                    <TextButton
                        label={currentTexts.languageToggle}
                        onClick={toggleLanguage}
                        externalClassName={'language-toggle-button'}
                    />
                </div>
            </div>
        </div>
    );
};

const mapDispatchToProps = {
    updateActivePopupTypeAction: updateActivePopupType,
    updateProjectDataAction: updateProjectData,
    updateLanguageAction: updateLanguage
};

const mapStateToProps = (state: AppState) => ({
    projectData: state.general.projectData,
    language: state.general.language,
    hasAIModels: !!(state.aimodels && state.aimodels.models.length > 0)
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(TopNavigationBar);
