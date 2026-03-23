import React, {useState, useEffect} from 'react';
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
}

const TopNavigationBar: React.FC<IProps> = (props) => {
    const currentTexts = LanguageConfig[props.language];
    const [showActionsDropdown, setShowActionsDropdown] = useState(false);

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

    return (
        <div className='TopNavigationBar'>
            <StateBar/>
            <div className='TopNavigationBarWrapper'>
                <div className='NavigationBarGroupWrapper'>
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
                </div>
                <div className='NavigationBarGroupWrapper'>
                    <div className='ActionsDropdownContainer'>
                        <TextButton
                            label={currentTexts.actions.title}
                            onClick={toggleActionsDropdown}
                            externalClassName={'actions-button'}
                        />
                        {showActionsDropdown && <DropDownMenu isVisible={true}/>}
                    </div>
                    <TextButton
                        label={currentTexts.uploadImages}
                        onClick={openLoadMoreImagesPopup}
                        externalClassName={'upload-images-button'}
                    />
                </div>
                <div className='NavigationBarGroupWrapper middle'>
                    <div className='ProjectName'>{currentTexts.projectName}</div>
                    <TextInput
                        isPassword={false}
                        value={props.projectData.name}
                        onChange={onChange}
                        onFocus={onFocus}
                    />
                </div>
                <div className='NavigationBarGroupWrapper'>
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
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(TopNavigationBar);
