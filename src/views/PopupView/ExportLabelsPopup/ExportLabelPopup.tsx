import React from 'react';
import './ExportLabelPopup.scss';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {LabelMeExporter} from '../../../logic/export/labelme/LabelMeExporter';
import {YOLOPackExporter} from '../../../logic/export/yolo/YOLOPackExporter';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';

export type ExportMode = 'simple' | 'complete';

interface IProps {
    language: Language;
}

const ExportLabelPopup: React.FC<IProps> = ({language}) => {
    const texts = LanguageConfig[language].popups.exportAnnotations;

    const renderContent = () => (
        <div className='ExportCards'>
            <div className='ExportCard' onClick={() => { LabelMeExporter.export(); PopupActions.close(); }}>
                <div className='CardTitle'>{texts.labelmePackageButton}</div>
                <div className='CardDesc'>{texts.labelmePackageDesc}</div>
            </div>
            <div className='ExportCard' onClick={() => { YOLOPackExporter.export(); PopupActions.close(); }}>
                <div className='CardTitle'>{texts.yoloPackageButton}</div>
                <div className='CardDesc'>{texts.yoloPackageDesc}</div>
            </div>
        </div>
    );

    return (
        <GenericYesNoPopup
            title={texts.title}
            renderContent={renderContent}
            skipAcceptButton={true}
            rejectLabel={texts.rejectButton}
            onReject={PopupActions.close}
        />
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(mapStateToProps, {})(ExportLabelPopup);
