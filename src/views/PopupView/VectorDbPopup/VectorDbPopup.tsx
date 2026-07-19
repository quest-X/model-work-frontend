import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useDropzone} from 'react-dropzone';
import {connect} from 'react-redux';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {getEngineBaseUrl, getExtensionEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import './VectorDbPopup.scss';

interface EmbedderStatus {
    state: string;           // not_loaded | loading | ready | missing_dep | error
    progress: number;
    backend: string;
    model: string;
    dim: number | null;
    device: string | null;
    error: string | null;
}

interface StoreStatus {
    state: string;
    db_path: string;
    error: string | null;
}

interface ExtStatus {
    status: string;
    vector_store: StoreStatus;
    embedder: EmbedderStatus;
    collections_count: number;
}

interface CollectionInfo {
    name: string;
    display_name: string;
    dim: number;
    embedder: string;
    mode: string;
    count: number;
    created_at: string;
    last_ingest_at: string | null;
}

interface IngestJob {
    job_id: string;
    state: string;           // queued | running | completed | failed | cancelled
    collection: string;
    mode: string;
    source: string;
    total_images: number;
    processed_images: number;
    inserted_objects: number;
    skipped_images: number;
    error: string | null;
}

interface SearchResult {
    score: number;
    dataset_id: string;
    filename: string;
    image_path: string;
    class_name: string;
    conf: number;
    bbox: number[];
    thumbnail: string | null;
}

interface DatasetSummary {
    id: string;
    name: string;
    image_count: number;
}

interface IProps {
    language: Language;
}

const TERMINAL_JOB_STATES = ['completed', 'failed', 'cancelled'];

const JOB_STATE_LABELS: Record<string, [string, string]> = {
    completed: ['入库完成', 'Ingest completed'],
    failed: ['入库失败', 'Ingest failed'],
    cancelled: ['已取消', 'Cancelled'],
    running: ['入库中…', 'Ingesting…'],
    queued: ['排队中…', 'Queued…'],
};

const VectorDbPopup: React.FC<IProps> = ({language}) => {
    const zh = language === Language.CHINESE;
    const t = useCallback(
        (zhText: string, enText: string) => (zh ? zhText : enText),
        [zh],
    );
    const baseUrl = `${getExtensionEngineBaseUrl()}/vector_db`;
    const coreBaseUrl = getEngineBaseUrl();

    const [status, setStatus] = useState<ExtStatus | null>(null);
    const [backendDown, setBackendDown] = useState(false);
    const [collections, setCollections] = useState<CollectionInfo[]>([]);
    const [selectedName, setSelectedName] = useState<string | null>(null);
    const [newName, setNewName] = useState('');
    const [createError, setCreateError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'ingest' | 'search'>('ingest');

    const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
    const [datasetId, setDatasetId] = useState('');
    const [mode, setMode] = useState<'objects' | 'images'>('objects');
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [submittingIngest, setSubmittingIngest] = useState(false);
    const [job, setJob] = useState<IngestJob | null>(null);
    const [ingestError, setIngestError] = useState<string | null>(null);

    const [queryFile, setQueryFile] = useState<File | null>(null);
    const [queryPreview, setQueryPreview] = useState<string | null>(null);
    const [topK, setTopK] = useState(12);
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<SearchResult[] | null>(null);
    const [searchError, setSearchError] = useState<string | null>(null);

    const warmupFired = useRef(false);
    const queryPreviewRef = useRef<string | null>(null);

    const selected = collections.find(c => c.name === selectedName) || null;
    const storeBad = !!status && ['missing_dep', 'error'].includes(status.vector_store.state);
    const embedderBad = !!status && ['missing_dep', 'error'].includes(status.embedder.state);
    const embedderLoading = !status || ['not_loaded', 'loading'].includes(status.embedder.state);
    const serviceDisabled = backendDown || storeBad || embedderBad;

    const refreshCollections = useCallback(() => {
        fetch(`${baseUrl}/collections`).then(r => r.json()).then(data => {
            if (Array.isArray(data.collections)) setCollections(data.collections);
        }).catch(() => undefined);
    }, [baseUrl]);

    // 状态轮询：2s 心跳；embedder 冷态自动 warmup 一次
    useEffect(() => {
        const tick = () => {
            fetch(`${baseUrl}/status`).then(r => r.json()).then((s: ExtStatus) => {
                setBackendDown(false);
                setStatus(s);
                if (s.embedder.state === 'not_loaded' && !warmupFired.current) {
                    warmupFired.current = true;
                    fetch(`${baseUrl}/warmup`, {method: 'POST'}).catch(() => undefined);
                }
            }).catch(() => setBackendDown(true));
        };
        tick();
        const timer = window.setInterval(tick, 2000);
        return () => window.clearInterval(timer);
    }, [baseUrl]);

    useEffect(() => {
        refreshCollections();
        fetch(`${coreBaseUrl}/datasets`).then(r => r.json()).then(data => {
            if (Array.isArray(data.datasets)) setDatasets(data.datasets);
        }).catch(() => undefined);
    }, [coreBaseUrl, refreshCollections]);

    // 入库任务轮询
    useEffect(() => {
        if (!job || TERMINAL_JOB_STATES.includes(job.state)) return undefined;
        const timer = window.setInterval(() => {
            fetch(`${baseUrl}/jobs/${job.job_id}`).then(r => {
                if (r.status === 404) {
                    setJob(null);
                    setIngestError(t('任务态丢失（后端可能重启过）', 'Job lost (backend may have restarted)'));
                    return null;
                }
                return r.json();
            }).then((j: IngestJob | null) => {
                if (!j) return;
                setJob(j);
                if (j.state === 'completed') refreshCollections();
            }).catch(() => undefined);
        }, 1000);
        return () => window.clearInterval(timer);
    }, [baseUrl, job, refreshCollections, t]);

    // 卸载时回收查询图预览 URL
    useEffect(() => () => {
        if (queryPreviewRef.current) URL.revokeObjectURL(queryPreviewRef.current);
    }, []);

    const onCreate = () => {
        setCreateError(null);
        fetch(`${baseUrl}/collections`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: newName, mode}),
        }).then(async r => {
            if (r.ok) {
                setNewName('');
                refreshCollections();
            } else {
                const body = await r.json().catch(() => ({}));
                setCreateError(body.detail || `${r.status}`);
            }
        }).catch(() => setCreateError(t('请求失败', 'Request failed')));
    };

    const onDelete = (name: string, e: React.MouseEvent) => {
        e.stopPropagation();
        fetch(`${baseUrl}/collections/${name}`, {method: 'DELETE'}).then(() => {
            if (selectedName === name) setSelectedName(null);
            refreshCollections();
        }).catch(() => undefined);
    };

    const onIngestDrop = useCallback((accepted: File[]) => {
        setPendingFiles(accepted);
        setDatasetId('');
    }, []);

    const ingestDropzone = useDropzone({
        accept: {
            'image/*': ['.jpg', '.jpeg', '.png', '.bmp', '.webp'],
            'application/zip': ['.zip'],
            'application/x-zip-compressed': ['.zip'],
        },
        multiple: true,
        onDrop: onIngestDrop,
    });

    const startIngest = () => {
        if (!selected) return;
        setIngestError(null);
        setSubmittingIngest(true);
        const form = new FormData();
        form.append('mode', mode);
        if (datasetId) {
            form.append('dataset_id', datasetId);
        } else {
            pendingFiles.forEach(f => form.append('files', f));
        }
        fetch(`${baseUrl}/collections/${selected.name}/ingest`, {
            method: 'POST',
            body: form,
        }).then(async r => {
            setSubmittingIngest(false);
            const body = await r.json().catch(() => ({}));
            if (r.ok) {
                setPendingFiles([]);
                setJob({
                    job_id: body.job_id, state: 'queued', collection: selected.name,
                    mode, source: '', total_images: 0, processed_images: 0,
                    inserted_objects: 0, skipped_images: 0, error: null,
                });
            } else {
                setIngestError(body.detail || `${r.status}`);
            }
        }).catch(() => {
            setSubmittingIngest(false);
            setIngestError(t('请求失败，请检查后端连接', 'Request failed — check backend connection'));
        });
    };

    const cancelIngest = () => {
        if (!job) return;
        fetch(`${baseUrl}/jobs/${job.job_id}/cancel`, {method: 'POST'}).catch(() => undefined);
    };

    const onQueryDrop = useCallback((accepted: File[]) => {
        const img = accepted[0];
        if (!img) return;
        if (queryPreviewRef.current) URL.revokeObjectURL(queryPreviewRef.current);
        const url = URL.createObjectURL(img);
        queryPreviewRef.current = url;
        setQueryFile(img);
        setQueryPreview(url);
        setResults(null);
        setSearchError(null);
    }, []);

    const queryDropzone = useDropzone({
        accept: {'image/*': ['.jpg', '.jpeg', '.png', '.bmp', '.webp']},
        multiple: false,
        onDrop: onQueryDrop,
    });

    const runSearch = () => {
        if (!selected || !queryFile) return;
        setSearching(true);
        setSearchError(null);
        setResults(null);
        const form = new FormData();
        form.append('file', queryFile);
        form.append('collection', selected.name);
        form.append('top_k', String(topK));
        fetch(`${baseUrl}/search`, {method: 'POST', body: form}).then(async r => {
            setSearching(false);
            const body = await r.json().catch(() => ({}));
            if (r.ok) {
                setResults(body.results || []);
            } else {
                setSearchError(body.detail || `${r.status}`);
            }
        }).catch(() => {
            setSearching(false);
            setSearchError(t('请求失败，请检查后端连接', 'Request failed — check backend connection'));
        });
    };

    const renderBanner = () => {
        if (backendDown) {
            return <div className='StatusBanner error'>{t('无法连接后端引擎', 'Cannot reach backend engine')}</div>;
        }
        if (!status) return null;
        if (storeBad) {
            return <div className='StatusBanner error'>
                {t('向量库不可用：', 'Vector store unavailable: ')}{status.vector_store.error}
            </div>;
        }
        if (embedderBad) {
            return <div className='StatusBanner error'>
                {t('特征模型不可用：', 'Embedder unavailable: ')}{status.embedder.error}
            </div>;
        }
        if (embedderLoading) {
            return <div className='StatusBanner loading'>
                {t(`特征模型加载中（${status.embedder.model}，首次需下载约 340MB）…`,
                    `Loading embedder (${status.embedder.model}, first run downloads ~340MB)…`)}
            </div>;
        }
        return <div className='StatusBanner ready'>
            {t('特征模型就绪：', 'Embedder ready: ')}
            {status.embedder.model} · {status.embedder.dim}{t(' 维', ' dims')} · {status.embedder.device}
        </div>;
    };

    const renderCollections = () => (
        <div className='CollectionsPanel'>
            <div className='SectionHeader'>{t('集合', 'Collections')}</div>
            <div className='CreateRow'>
                <input
                    className='CreateInput'
                    value={newName}
                    placeholder={t('新集合名称', 'New collection name')}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) onCreate(); }}
                />
                <button className='CreateButton' disabled={!newName.trim() || serviceDisabled} onClick={onCreate}>
                    {t('新建', 'Create')}
                </button>
            </div>
            {createError && <div className='errorMessage'>{createError}</div>}
            <div className='CollectionList'>
                {collections.length === 0 &&
                    <div className='EmptyHint'>{t('暂无集合', 'No collections yet')}</div>}
                {collections.map(c => (
                    <div
                        key={c.name}
                        className={`DatasetRow${selectedName === c.name ? ' selected' : ''}`}
                        onClick={() => setSelectedName(selectedName === c.name ? null : c.name)}
                    >
                        <div className='DatasetRowMain'>
                            <span className='DatasetName'>{c.display_name}</span>
                            <span className='DatasetMeta'>
                                {c.count} {t('向量', 'vectors')} · {c.dim}{t(' 维', ' dims')} · {c.embedder}
                            </span>
                        </div>
                        <button className='DeleteButton' onClick={e => onDelete(c.name, e)}>×</button>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderJobPanel = () => {
        if (!job) return null;
        const jobActive = !TERMINAL_JOB_STATES.includes(job.state);
        const percent = job.total_images > 0
            ? Math.round((job.processed_images / job.total_images) * 100) : 0;
        const stateLabel = JOB_STATE_LABELS[job.state] || JOB_STATE_LABELS.queued;
        return (
            <div className='JobPanel'>
                <div className='JobHeader'>
                    <span>{t(stateLabel[0], stateLabel[1])}</span>
                    {jobActive && (
                        <button className='CancelButton' onClick={cancelIngest}>
                            {t('取消', 'Cancel')}
                        </button>
                    )}
                </div>
                <div className='ProgressBar'>
                    <div className='ProgressBarFill' style={{width: `${percent}%`}}/>
                </div>
                <div className='JobStats'>
                    {job.processed_images}/{job.total_images} {t('图', 'imgs')} ·{' '}
                    {job.inserted_objects} {t('对象已入库', 'objects inserted')}
                    {job.skipped_images > 0 && ` · ${job.skipped_images} ${t('跳过', 'skipped')}`}
                </div>
                {job.error && <div className='errorMessage'>{job.error}</div>}
            </div>
        );
    };

    const renderIngestTab = () => {
        const jobActive = !!job && !TERMINAL_JOB_STATES.includes(job.state);
        const noSource = !datasetId && pendingFiles.length === 0;
        return (
            <div className='TabBody'>
                <div className='ModeRow'>
                    <span className='FieldLabel'>{t('入库粒度', 'Granularity')}</span>
                    <label>
                        <input type='radio' checked={mode === 'objects'} onChange={() => setMode('objects')}/>
                        {t('检测对象', 'Detected objects')}
                    </label>
                    <label>
                        <input type='radio' checked={mode === 'images'} onChange={() => setMode('images')}/>
                        {t('整图', 'Whole images')}
                    </label>
                </div>
                <div className='SourceRow'>
                    <span className='FieldLabel'>{t('数据集', 'Dataset')}</span>
                    <select value={datasetId} onChange={e => { setDatasetId(e.target.value); setPendingFiles([]); }}>
                        <option value=''>{t('—— 选择数据中心数据集 ——', '—— pick a Data Center dataset ——')}</option>
                        {datasets.map(ds => (
                            <option key={ds.id} value={ds.id}>{ds.name}（{ds.image_count}）</option>
                        ))}
                    </select>
                </div>
                <div {...ingestDropzone.getRootProps({className: 'DropZone small'})}>
                    <input {...ingestDropzone.getInputProps()} />
                    <p className='extraBold'>
                        {pendingFiles.length > 0
                            ? t(`已选 ${pendingFiles.length} 个文件`, `${pendingFiles.length} file(s) selected`)
                            : t('或拖拽/点击上传图片或 zip', 'or drop / click to upload images or a zip')}
                    </p>
                </div>
                {ingestError && <div className='errorMessage'>{ingestError}</div>}
                {renderJobPanel()}
                <button
                    className='PrimaryButton'
                    disabled={serviceDisabled || jobActive || submittingIngest || noSource}
                    onClick={startIngest}
                >
                    {submittingIngest ? t('提交中…', 'Submitting…') : t('开始入库', 'Start ingest')}
                </button>
            </div>
        );
    };

    const renderSearchTab = () => (
        <div className='TabBody'>
            <div className='SearchControls'>
                <div {...queryDropzone.getRootProps({className: 'DropZone query'})}>
                    <input {...queryDropzone.getInputProps()} />
                    {queryPreview
                        ? <img className='QueryPreview' src={queryPreview} alt='query'/>
                        : <p className='extraBold'>{t('拖入查询图片', 'Drop a query image')}</p>}
                </div>
                <div className='SearchParams'>
                    <span className='FieldLabel'>top-K</span>
                    <input
                        type='number' min={1} max={100} value={topK}
                        onChange={e => setTopK(Math.max(1, Math.min(100, Number(e.target.value) || 12)))}
                    />
                    <button
                        className='PrimaryButton'
                        disabled={serviceDisabled || embedderLoading || !queryFile || searching}
                        onClick={runSearch}
                    >
                        {searching ? t('检索中…', 'Searching…') : t('检索', 'Search')}
                    </button>
                </div>
            </div>
            {searchError && <div className='errorMessage'>{searchError}</div>}
            {results !== null && results.length === 0 &&
                <div className='EmptyHint'>{t('无相似结果', 'No similar results')}</div>}
            {results !== null && results.length > 0 && (
                <div className='ResultGrid'>
                    {results.map((r, i) => (
                        <div className='ResultCard' key={i}>
                            {r.thumbnail
                                ? <img src={r.thumbnail} alt={r.filename}/>
                                : <div className='ThumbPlaceholder'>{t('源图缺失', 'missing')}</div>}
                            <div className='ScoreBadge'>{(r.score * 100).toFixed(1)}%</div>
                            <div className='ResultMeta'>
                                {r.class_name && <span className='ClassTag'>{r.class_name}</span>}
                                <span className='FileName' title={r.filename}>{r.filename}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const renderContent = () => (
        <div className='VectorDbPopupContent'>
            {renderBanner()}
            <div className='Columns'>
                {renderCollections()}
                <div className='WorkPanel'>
                    <div className='TabBar'>
                        <button
                            className={`TabButton${activeTab === 'ingest' ? ' active' : ''}`}
                            onClick={() => setActiveTab('ingest')}
                        >
                            {t('数据入库', 'Ingest')}
                        </button>
                        <button
                            className={`TabButton${activeTab === 'search' ? ' active' : ''}`}
                            onClick={() => setActiveTab('search')}
                        >
                            {t('相似检索', 'Similarity Search')}
                        </button>
                    </div>
                    {!selected
                        ? <div className='EmptyHint tall'>{t('请先在左侧选择或新建一个集合', 'Select or create a collection first')}</div>
                        : (activeTab === 'ingest' ? renderIngestTab() : renderSearchTab())}
                </div>
            </div>
        </div>
    );

    return (
        <GenericYesNoPopup
            title={t('向量数据库', 'Vector Database')}
            renderContent={renderContent}
            skipAcceptButton
            rejectLabel={t('关闭', 'Close')}
            onReject={() => PopupActions.close()}
        />
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
});

export default connect(mapStateToProps)(VectorDbPopup);
