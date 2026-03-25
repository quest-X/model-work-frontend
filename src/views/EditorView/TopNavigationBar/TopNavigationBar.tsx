import React, {useState, useEffect, useRef} from 'react';
import './TopNavigationBar.scss';
import StateBar from '../StateBar/StateBar';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {updateActivePopupType, updateProjectData, updateLanguage} from '../../../store/general/actionCreators';
import TextInput from '../../Common/TextInput/TextInput';
import {ImageButton} from '../../Common/ImageButton/ImageButton';
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
    const [canvasCenterX, setCanvasCenterX] = useState<number | null>(null);
    const lastCenterRef = useRef<number | null>(null);

    useEffect(() => {
        const el = document.querySelector('.EditorWrapper');
        if (!el) return;

        const updateCenter = () => {
            const rect = el.getBoundingClientRect();
            const center = Math.round(rect.left + rect.width / 2);
            if (center !== lastCenterRef.current) {
                lastCenterRef.current = center;
                setCanvasCenterX(center);
            }
        };

        const observer = new ResizeObserver(updateCenter);
        observer.observe(el);
        updateCenter();

        return () => observer.disconnect();
    }, []);

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
    
    const openLoadMoreImagesPopup = () => props.updateActivePopupTypeAction(PopupWindowType.IMPORT_IMAGES)

    const toggleModelsDropdown = () => {
        setShowModelsDropdown(!showModelsDropdown);
    };

    const openRemoteModelManager = () => {
        setShowModelsDropdown(false);
        const popupType = props.hasAIModels ? PopupWindowType.MANAGE_AI_MODELS : PopupWindowType.INTEGRATE_AI_MODEL;
        props.updateActivePopupTypeAction(popupType);
    };

    const openLocalModelManager = () => {
        setShowModelsDropdown(false);
        props.updateActivePopupTypeAction(PopupWindowType.LOAD_AI_MODEL);
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
                                    {props.language === Language.CHINESE ? '远程模型' : 'Remote Models'}
                                </div>
                                <div className='DropDownMenuContentOption active'
                                    onClick={openLocalModelManager}>
                                    <div className='Marker'/>
                                    <img src='ico/ai.png' alt='local-models'/>
                                    {props.language === Language.CHINESE ? '本地模型' : 'Local Models'}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <div
                    className='ProjectNameContainer'
                    style={canvasCenterX != null ? { left: canvasCenterX, transform: 'translateX(-50%)' } : undefined}
                >
                    <div className='ProjectName'>{currentTexts.projectName}</div>
                    <TextInput
                        isPassword={false}
                        value={props.projectData.name}
                        onChange={onChange}
                        onFocus={onFocus}
                    />
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
