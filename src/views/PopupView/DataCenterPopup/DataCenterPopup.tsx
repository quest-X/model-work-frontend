import React, {useCallback, useEffect, useState} from 'react';
import {connect} from 'react-redux';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {updateActivePopupType} from '../../../store/general/actionCreators';
import {AppState} from '../../../store';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {getEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import './DataCenterPopup.scss';

interface DatasetSummary {
    id: string;
    name: string;
    created_at: string;
    image_count: number;
    classes: string[];
    format: string;
}

interface DatasetStats {
    image_count: number;
    class_distribution: Record<string, number>;
    annotated_count: number;
    annotation_coverage: number;
}

interface IProps {
    language: Language;
    updateActivePopupTypeAction: (activePopupType: PopupWindowType) => void;
}

const DataCenterPopup: React.FC<IProps> = ({language, updateActivePopupTypeAction}) => {
    const zh = language === Language.CHINESE;
    const currentTexts = LanguageConfig[language];
    const baseUrl = getEngineBaseUrl();

    const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [stats, setStats] = useState<DatasetStats | null>(null);

    const refreshDatasets = useCallback(() => {
        fetch(`${baseUrl}/datasets`).then(r => r.json()).then(data => {
            if (Array.isArray(data.datasets)) setDatasets(data.datasets);
        }).catch(() => undefined);
    }, [baseUrl]);

    useEffect(() => {
        refreshDatasets();
    }, [refreshDatasets]);

    useEffect(() => {
        if (!selectedId) {
            setStats(null);
            return;
        }
        fetch(`${baseUrl}/datasets/${selectedId}/stats`).then(r => r.json()).then(setStats).catch(() => undefined);
    }, [selectedId, baseUrl]);

    const openInferenceSettings = () => updateActivePopupTypeAction(PopupWindowType.CALL_MODEL);

    const openTrainingSettings = () => updateActivePopupTypeAction(PopupWindowType.TRAINING_TASK);

    const onDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        fetch(`${baseUrl}/datasets/${id}`, {method: 'DELETE'}).then(() => {
            if (selectedId === id) setSelectedId(null);
            refreshDatasets();
        }).catch(() => undefined);
    };

    const renderContent = () => (
        <div className='DataCenterPopupContent'>
            <div className='DatasetListSection'>
                <div className='SectionHeader'>{zh ? '已有数据集' : 'Datasets'}</div>
                <div className='DatasetList'>
                    {datasets.length === 0 && <div className='EmptyHint'>{zh ? '暂无数据集' : 'No datasets yet'}</div>}
                    {datasets.map(ds => (
                        <div
                            key={ds.id}
                            className={`DatasetRow${selectedId === ds.id ? ' selected' : ''}`}
                            onClick={() => setSelectedId(selectedId === ds.id ? null : ds.id)}
                        >
                            <div className='DatasetRowMain'>
                                <span className='DatasetName'>{ds.name}</span>
                                <span className='DatasetMeta'>{ds.image_count} {zh ? '张图片' : 'images'} · {ds.classes.length} {zh ? '类' : 'classes'}</span>
                            </div>
                            <button className='DeleteButton' onClick={(e) => onDelete(ds.id, e)}>×</button>
                        </div>
                    ))}
                </div>
                {selectedId && stats && (
                    <div className='StatsPanel'>
                        <div className='StatsRow'><span>{zh ? '标注覆盖率' : 'Annotation coverage'}</span><span>{(stats.annotation_coverage * 100).toFixed(0)}%</span></div>
                        <div className='StatsRow'><span>{zh ? '已标注' : 'Annotated'}</span><span>{stats.annotated_count} / {stats.image_count}</span></div>
                        {Object.entries(stats.class_distribution).map(([cls, count]) => (
                            <div className='StatsRow' key={cls}><span>{cls}</span><span>{count}</span></div>
                        ))}
                    </div>
                )}
            </div>
            <div className='TaskLinksSection'>
                <div className='SectionHeader'>{zh ? '相关任务' : 'Related Tasks'}</div>
                <div className='TaskLinks'>
                    <div className='TaskLink' onClick={openInferenceSettings}>
                        {currentTexts.modelManagement.callModels}
                    </div>
                    <div className='TaskLink' onClick={openTrainingSettings}>
                        {currentTexts.modelManagement.trainingTask}
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <GenericYesNoPopup
            title={zh ? '数据任务' : 'Data Tasks'}
            renderContent={renderContent}
            skipAcceptButton
            rejectLabel={zh ? '关闭' : 'Close'}
            onReject={() => PopupActions.close()}
        />
    );
};

const mapDispatchToProps = {
    updateActivePopupTypeAction: updateActivePopupType,
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
});

export default connect(mapStateToProps, mapDispatchToProps)(DataCenterPopup);
