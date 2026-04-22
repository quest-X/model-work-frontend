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
    const texts = LanguageConfig[language];
    const zh = language === Language.CHINESE;

    const renderContent = () => (
        <div className='ExportCards'>
            <div className='ExportCard' onClick={() => { LabelMeExporter.export('complete'); PopupActions.close(); }}>
                <div className='CardTitle'>LabelMe 标注包</div>
                <div className='CardDesc'>
                    {zh
                        ? 'LabelMe格式 · 含原图 · 支持二次标注'
                        : 'LabelMe format · with images · for re-annotation'}
                </div>
            </div>
            <div className='ExportCard' onClick={() => { YOLOPackExporter.export(); PopupActions.close(); }}>
                <div className='CardTitle'>YOLO 训练包</div>
                <div className='CardDesc'>
                    {zh
                        ? 'YOLO格式 · 含原图 · 检测/分割训练集'
                        : 'YOLO format · with images · detection/segmentation dataset'}
                </div>
            </div>
        </div>
    );

    return (
        <GenericYesNoPopup
            title={texts.popups.exportAnnotations.title}
            renderContent={renderContent}
            skipAcceptButton={true}
            rejectLabel={texts.popups.exportAnnotations.rejectButton}
            onReject={PopupActions.close}
        />
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(mapStateToProps, {})(ExportLabelPopup);
