import React, {useCallback, useEffect, useState} from 'react';
import {useDropzone} from 'react-dropzone';
import {connect} from 'react-redux';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
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
}

const DataCenterPopup: React.FC<IProps> = ({language}) => {
    const zh = language === Language.CHINESE;
    const baseUrl = getEngineBaseUrl();

    const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [stats, setStats] = useState<DatasetStats | null>(null);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);

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

    const uploadZip = (file: File) => {
        setUploadError(null);
        setUploadProgress(0);
        const xhr = new XMLHttpRequest();
        const form = new FormData();
        form.append('file', file);
        form.append('name', file.name.replace(/\.zip$/i, ''));
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
            setUploadProgress(null);
            if (xhr.status >= 200 && xhr.status < 300) {
                refreshDatasets();
            } else {
                try {
                    const body = JSON.parse(xhr.responseText);
                    setUploadError(body.detail || `upload failed (${xhr.status})`);
                } catch {
                    setUploadError(`upload failed (${xhr.status})`);
                }
            }
        };
        xhr.onerror = () => {
            setUploadProgress(null);
            setUploadError(zh ? '上传失败，请检查后端连接' : 'Upload failed — check backend connection');
        };
        xhr.open('POST', `${baseUrl}/datasets/upload`);
        xhr.send(form);
    };

    const onDrop = useCallback((accepted: File[]) => {
        const zip = accepted.find(f => f.name.toLowerCase().endsWith('.zip'));
        if (zip) uploadZip(zip);
    }, [baseUrl]);

    const {getRootProps, getInputProps} = useDropzone({
        accept: {'application/zip': ['.zip'], 'application/x-zip-compressed': ['.zip'], 'application/octet-stream': ['.zip']},
        multiple: false,
        onDrop,
    });

    const onDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        fetch(`${baseUrl}/datasets/${id}`, {method: 'DELETE'}).then(() => {
            if (selectedId === id) setSelectedId(null);
            refreshDatasets();
        }).catch(() => undefined);
    };

    const renderContent = () => (
        <div className='DataCenterPopupContent'>
            <div className='UploadSection'>
                <div {...getRootProps({className: 'DropZone'})}>
                    <input {...getInputProps()} />
                    {uploadProgress !== null ? (
                        <>
                            <p className='extraBold'>{zh ? `上传中 ${uploadProgress}%` : `Uploading ${uploadProgress}%`}</p>
                            <div className='ProgressBar'><div className='ProgressBarFill' style={{width: `${uploadProgress}%`}} /></div>
                        </>
                    ) : uploadError ? (
                        <p className='errorMessage'>{uploadError}</p>
                    ) : (
                        <p className='extraBold'>{zh ? '拖拽或点击上传数据集 zip（YOLO 格式）' : 'Drop or click to upload a dataset zip (YOLO format)'}</p>
                    )}
                </div>
            </div>
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
        </div>
    );

    return (
        <GenericYesNoPopup
            title={zh ? '数据中心' : 'Data Center'}
            renderContent={renderContent}
            skipAcceptButton
            rejectLabel={zh ? '关闭' : 'Close'}
            onReject={() => PopupActions.close()}
        />
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
});

export default connect(mapStateToProps)(DataCenterPopup);
