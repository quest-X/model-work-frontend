import React, {useState} from 'react'
import './GenericLabelTypePopup.scss'
import {LabelType} from '../../../data/enums/LabelType';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {ImageButton} from '../../Common/ImageButton/ImageButton';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {ILabelToolkit, getLabelToolkitData} from '../../../data/info/LabelToolkitData';
import {ProjectType} from '../../../data/enums/ProjectType';
import {Language} from '../../../data/LanguageConfig';

interface IProps {
    title: string,
    activeLabelType: LabelType,
    projectType: ProjectType;
    onLabelTypeChange?: (labelType: LabelType) => any;
    acceptLabel: string;
    onAccept: (labelType: LabelType) => any;
    skipAcceptButton?: boolean;
    disableAcceptButton?: boolean;
    rejectLabel: string;
    onReject: (labelType: LabelType) => any;
    renderInternalContent: (labelType: LabelType) => any;
    language: Language;
}

const GenericLabelTypePopup: React.FC<IProps> = (
    {
        title,
        activeLabelType,
        projectType,
        onLabelTypeChange,
        acceptLabel,
        onAccept,
        skipAcceptButton,
        disableAcceptButton,
        rejectLabel,
        onReject,
        renderInternalContent,
        language
    }) => {

    const [labelType, setLabelType] = useState(activeLabelType);

    const getSidebarButtons = () => {
        const labelToolkitData = getLabelToolkitData(language);
        return labelToolkitData
            .filter((label: ILabelToolkit) => label.projectType === projectType && label.labelType !== LabelType.ALL)
            .map((label: ILabelToolkit) => {
                return <ImageButton
                    key={label.labelType}
                    image={label.imageSrc}
                    imageAlt={label.imageAlt}
                    buttonSize={{width: 40, height: 40}}
                    padding={20}
                    onClick={() => {
                        setLabelType(label.labelType);
                        onLabelTypeChange(label.labelType);
                    }}
                    isActive={labelType === label.labelType}
                />
            })
    }

    const renderContent = () => {
        return (<div className='GenericLabelTypePopupContent'>
            <div className='LeftContainer'>
                {getSidebarButtons()}
            </div>
            <div className='RightContainer'>
                {renderInternalContent(labelType)}
            </div>
        </div>);
    }

    return(
        <GenericYesNoPopup
            title={title}
            renderContent={renderContent}
            acceptLabel={acceptLabel}
            onAccept={() => onAccept(labelType)}
            skipAcceptButton={skipAcceptButton}
            disableAcceptButton={disableAcceptButton}
            rejectLabel={rejectLabel}
            onReject={() => onReject(labelType)}
        />
    );
};

const mapDispatchToProps = {};

const mapStateToProps = (state: AppState) => ({
    projectType: state.general.projectData.type,
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(GenericLabelTypePopup);