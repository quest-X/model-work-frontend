import React, {useState} from 'react';
import {connect} from 'react-redux';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {getEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import {DatasetExportSelection} from '../../../services/DatasetActionSelection';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import './DatasetExportPopup.scss';

interface IProps {
    language: Language;
}

export const DatasetExportPopup: React.FC<IProps> = ({language}) => {
    const zh = language === Language.CHINESE;
    const [target] = useState(() => DatasetExportSelection.get());

    const close = () => {
        DatasetExportSelection.set(null);
        PopupActions.close();
    };

    const exportDataset = () => {
        if (!target) return;
        const link = document.createElement('a');
        link.href = `${getEngineBaseUrl()}/datasets/${target.id}/export`;
        link.download = `${target.name}-v${target.revision}.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        close();
    };

    const renderContent = () => <div className='DatasetExportPopupContent'>
        {!target && <p className='ExportError'>{zh ? '没有选中的数据集' : 'No dataset selected'}</p>}
        {target && <>
            <div className='ExportDatasetName'>{target.name}</div>
            <div className='ExportSummary'>
                <div><span>{zh ? '版本' : 'Revision'}</span><strong>v{target.revision}</strong></div>
                <div><span>{zh ? '图像' : 'Images'}</span><strong>{target.imageCount}</strong></div>
                <div><span>{zh ? '类别' : 'Classes'}</span><strong>{target.classCount}</strong></div>
                <div><span>{zh ? '格式' : 'Format'}</span><strong>YOLO ZIP</strong></div>
            </div>
            <p>{zh
                ? '将按当前版本生成包含原图、YOLO 标签、类别文件和数据清单的标准压缩包。'
                : 'A standard archive containing images, YOLO labels, classes, and the manifest will be generated.'}</p>
        </>}
    </div>;

    return <GenericYesNoPopup
        title={zh ? '导出数据集' : 'Export Dataset'}
        renderContent={renderContent}
        acceptLabel={zh ? '导出压缩包' : 'Export Archive'}
        disableAcceptButton={!target}
        onAccept={exportDataset}
        rejectLabel={zh ? '取消' : 'Cancel'}
        onReject={close}
    />;
};

const mapStateToProps = (state: AppState) => ({language: state.general.language});
export default connect(mapStateToProps)(DatasetExportPopup);
