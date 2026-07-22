import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useDropzone} from 'react-dropzone';
import {connect} from 'react-redux';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {getEngineBaseUrl, getExtensionEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import './VectorDbPopup.scss';

type CollectionMode = 'objects' | 'images';
type WorkspaceTab = 'ingest' | 'query';
type IngestSource = 'dataset' | 'upload';

interface EmbedderStatus {
    state: string;
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
    mode: CollectionMode;
    count: number;
    created_at: string;
    last_ingest_at: string | null;
}

interface IngestJob {
    job_id: string;
    state: string;
    collection: string;
    mode: CollectionMode;
    source: string;
    total_images: number;
    processed_images: number;
    inserted_objects: number;
    skipped_images: number;
    error: string | null;
    started_at?: string | null;
    finished_at?: string | null;
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

const TERMINAL_JOB_STATES = new Set(['completed', 'failed', 'cancelled']);

const JOB_STATE_LABELS: Record<string, [string, string]> = {
    completed: ['入库完成', 'Ingest completed'],
    failed: ['入库失败', 'Ingest failed'],
    cancelled: ['已取消', 'Cancelled'],
    running: ['正在入库', 'Ingesting'],
    queued: ['等待入库', 'Queued'],
};

const readResponse = async <T,>(response: Response): Promise<T> => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = (body as {detail?: unknown}).detail;
        throw new Error(typeof detail === 'string' ? detail : String(response.status));
    }
    return body as T;
};

export const VectorDbPopup: React.FC<IProps> = ({language}) => {
    const zh = language === Language.CHINESE;
    const t = useCallback(
        (zhText: string, enText: string) => (zh ? zhText : enText),
        [zh],
    );
    const baseUrl = `${getExtensionEngineBaseUrl()}/vector_db`;
    const coreBaseUrl = getEngineBaseUrl();

    const [status, setStatus] = useState<ExtStatus | null>(null);
    const [backendDown, setBackendDown] = useState(false);
    const [warmingUp, setWarmingUp] = useState(false);

    const [collections, setCollections] = useState<CollectionInfo[]>([]);
    const [collectionsLoading, setCollectionsLoading] = useState(true);
    const [collectionsError, setCollectionsError] = useState<string | null>(null);
    const [selectedName, setSelectedName] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState('');
    const [createMode, setCreateMode] = useState<CollectionMode>('objects');
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const [activeTab, setActiveTab] = useState<WorkspaceTab>('ingest');
    const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
    const [datasetsLoading, setDatasetsLoading] = useState(true);
    const [datasetsError, setDatasetsError] = useState<string | null>(null);
    const [ingestSource, setIngestSource] = useState<IngestSource>('dataset');
    const [datasetId, setDatasetId] = useState('');
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [submittingIngest, setSubmittingIngest] = useState(false);
    const [job, setJob] = useState<IngestJob | null>(null);
    const [ingestError, setIngestError] = useState<string | null>(null);

    const [queryFile, setQueryFile] = useState<File | null>(null);
    const [queryPreview, setQueryPreview] = useState<string | null>(null);
    const [topK, setTopK] = useState(12);
    const [classFilter, setClassFilter] = useState('');
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<SearchResult[] | null>(null);
    const [searchError, setSearchError] = useState<string | null>(null);
    const queryPreviewRef = useRef<string | null>(null);

    const selected = collections.find(collection => collection.name === selectedName) || null;
    const totalVectors = useMemo(
        () => collections.reduce((total, collection) => total + collection.count, 0),
        [collections],
    );
    const storeBad = !!status && ['missing_dep', 'error'].includes(status.vector_store.state);
    const embedderBad = !!status && ['missing_dep', 'error'].includes(status.embedder.state);
    const embedderReady = status?.embedder.state === 'ready';
    const storeReady = status?.vector_store.state === 'ready';
    const activeJob = !!job && !TERMINAL_JOB_STATES.has(job.state);
    const selectedJobActive = activeJob && job?.collection === selected?.name;

    const refreshStatus = useCallback(async () => {
        try {
            const response = await fetch(`${baseUrl}/status`);
            const nextStatus = await readResponse<ExtStatus>(response);
            setStatus(nextStatus);
            setBackendDown(false);
        } catch {
            setBackendDown(true);
        }
    }, [baseUrl]);

    const refreshCollections = useCallback(async () => {
        setCollectionsLoading(true);
        setCollectionsError(null);
        try {
            const response = await fetch(`${baseUrl}/collections`);
            const data = await readResponse<{collections?: CollectionInfo[]}>(response);
            const nextCollections = Array.isArray(data.collections) ? data.collections : [];
            setCollections(nextCollections);
            setSelectedName(current => {
                if (current && nextCollections.some(collection => collection.name === current)) return current;
                return nextCollections[0]?.name || null;
            });
        } catch (cause) {
            setCollectionsError(cause instanceof Error ? cause.message : t('集合加载失败', 'Failed to load collections'));
        } finally {
            setCollectionsLoading(false);
        }
    }, [baseUrl, t]);

    const refreshDatasets = useCallback(async () => {
        setDatasetsLoading(true);
        setDatasetsError(null);
        try {
            const response = await fetch(`${coreBaseUrl}/datasets`);
            const data = await readResponse<{datasets?: DatasetSummary[]}>(response);
            setDatasets(Array.isArray(data.datasets) ? data.datasets : []);
        } catch (cause) {
            setDatasetsError(cause instanceof Error ? cause.message : t('数据任务不可用', 'Data Tasks unavailable'));
        } finally {
            setDatasetsLoading(false);
        }
    }, [coreBaseUrl, t]);

    const recoverJob = useCallback(async () => {
        try {
            const response = await fetch(`${baseUrl}/jobs`);
            const data = await readResponse<{jobs?: IngestJob[]}>(response);
            const jobs = Array.isArray(data.jobs) ? data.jobs : [];
            const running = jobs.find(item => !TERMINAL_JOB_STATES.has(item.state));
            setJob(running || jobs[jobs.length - 1] || null);
        } catch {
            // Job recovery is best-effort; collection management remains usable.
        }
    }, [baseUrl]);

    useEffect(() => {
        refreshStatus();
        const timer = window.setInterval(refreshStatus, 5000);
        return () => window.clearInterval(timer);
    }, [refreshStatus]);

    useEffect(() => {
        refreshCollections();
        refreshDatasets();
        recoverJob();
    }, [recoverJob, refreshCollections, refreshDatasets]);

    useEffect(() => {
        if (!job || TERMINAL_JOB_STATES.has(job.state)) return undefined;
        const pollJob = async () => {
            try {
                const response = await fetch(`${baseUrl}/jobs/${encodeURIComponent(job.job_id)}`);
                if (response.status === 404) {
                    setJob(null);
                    setIngestError(t('任务状态已丢失，后端可能已重启', 'Job state was lost; the backend may have restarted'));
                    return;
                }
                const nextJob = await readResponse<IngestJob>(response);
                setJob(nextJob);
                if (nextJob.state === 'completed') refreshCollections();
            } catch {
                // The status/collection banners report connectivity; keep the last job progress visible.
            }
        };
        const timer = window.setInterval(pollJob, 1000);
        return () => window.clearInterval(timer);
    }, [baseUrl, job, refreshCollections, t]);

    useEffect(() => {
        setDatasetId('');
        setPendingFiles([]);
        setIngestError(null);
        setDeleteConfirm(false);
        setDeleteError(null);
        setQueryFile(null);
        setResults(null);
        setSearchError(null);
        setClassFilter('');
        if (queryPreviewRef.current) {
            URL.revokeObjectURL(queryPreviewRef.current);
            queryPreviewRef.current = null;
            setQueryPreview(null);
        }
    }, [selectedName]);

    useEffect(() => () => {
        if (queryPreviewRef.current) URL.revokeObjectURL(queryPreviewRef.current);
    }, []);

    const warmup = async () => {
        setWarmingUp(true);
        try {
            const response = await fetch(`${baseUrl}/warmup`, {method: 'POST'});
            await readResponse(response);
            await refreshStatus();
        } catch {
            setBackendDown(true);
        } finally {
            setWarmingUp(false);
        }
    };

    const createCollection = async () => {
        const name = newName.trim();
        if (!name || creating) return;
        setCreating(true);
        setCreateError(null);
        try {
            const response = await fetch(`${baseUrl}/collections`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name, mode: createMode}),
            });
            const created = await readResponse<CollectionInfo>(response);
            setNewName('');
            setShowCreate(false);
            await refreshCollections();
            setSelectedName(created.name);
        } catch (cause) {
            setCreateError(cause instanceof Error ? cause.message : t('创建失败', 'Create failed'));
        } finally {
            setCreating(false);
        }
    };

    const deleteCollection = async () => {
        if (!selected || deleting || selectedJobActive) return;
        setDeleting(true);
        setDeleteError(null);
        try {
            const response = await fetch(`${baseUrl}/collections/${encodeURIComponent(selected.name)}`, {
                method: 'DELETE',
            });
            await readResponse(response);
            setDeleteConfirm(false);
            await refreshCollections();
        } catch (cause) {
            setDeleteError(cause instanceof Error ? cause.message : t('删除失败', 'Delete failed'));
        } finally {
            setDeleting(false);
        }
    };

    const onIngestDrop = useCallback((accepted: File[]) => {
        setPendingFiles(accepted);
        setDatasetId('');
        setIngestError(null);
    }, []);

    const ingestDropzone = useDropzone({
        accept: {
            'image/*': ['.jpg', '.jpeg', '.png', '.bmp', '.webp'],
            'application/zip': ['.zip'],
            'application/x-zip-compressed': ['.zip'],
        },
        disabled: !embedderReady || !storeReady || activeJob || submittingIngest,
        multiple: true,
        onDrop: onIngestDrop,
    });

    const startIngest = async () => {
        if (!selected || activeJob || submittingIngest) return;
        setSubmittingIngest(true);
        setIngestError(null);
        const form = new FormData();
        form.append('mode', selected.mode);
        if (ingestSource === 'dataset') {
            form.append('dataset_id', datasetId);
        } else {
            pendingFiles.forEach(file => form.append('files', file));
        }
        try {
            const response = await fetch(
                `${baseUrl}/collections/${encodeURIComponent(selected.name)}/ingest`,
                {method: 'POST', body: form},
            );
            const body = await readResponse<{job_id: string}>(response);
            setPendingFiles([]);
            setDatasetId('');
            setJob({
                job_id: body.job_id,
                state: 'queued',
                collection: selected.name,
                mode: selected.mode,
                source: ingestSource,
                total_images: 0,
                processed_images: 0,
                inserted_objects: 0,
                skipped_images: 0,
                error: null,
            });
        } catch (cause) {
            setIngestError(cause instanceof Error ? cause.message : t('入库请求失败', 'Ingest request failed'));
        } finally {
            setSubmittingIngest(false);
        }
    };

    const cancelIngest = async () => {
        if (!job || !activeJob) return;
        try {
            const response = await fetch(`${baseUrl}/jobs/${encodeURIComponent(job.job_id)}/cancel`, {method: 'POST'});
            await readResponse(response);
        } catch (cause) {
            setIngestError(cause instanceof Error ? cause.message : t('取消失败', 'Cancel failed'));
        }
    };

    const onQueryDrop = useCallback((accepted: File[]) => {
        const image = accepted[0];
        if (!image) return;
        if (queryPreviewRef.current) URL.revokeObjectURL(queryPreviewRef.current);
        const url = URL.createObjectURL(image);
        queryPreviewRef.current = url;
        setQueryFile(image);
        setQueryPreview(url);
        setResults(null);
        setSearchError(null);
    }, []);

    const queryDropzone = useDropzone({
        accept: {'image/*': ['.jpg', '.jpeg', '.png', '.bmp', '.webp']},
        disabled: !embedderReady || !storeReady || searching,
        multiple: false,
        onDrop: onQueryDrop,
    });

    const runQuery = async () => {
        if (!selected || !queryFile || searching) return;
        setSearching(true);
        setSearchError(null);
        setResults(null);
        const form = new FormData();
        form.append('file', queryFile);
        form.append('collection', selected.name);
        form.append('top_k', String(topK));
        if (selected.mode === 'objects' && classFilter.trim()) {
            form.append('class_name', classFilter.trim());
        }
        try {
            const response = await fetch(`${baseUrl}/search`, {method: 'POST', body: form});
            const body = await readResponse<{results?: SearchResult[]}>(response);
            setResults(Array.isArray(body.results) ? body.results : []);
        } catch (cause) {
            setSearchError(cause instanceof Error ? cause.message : t('检索失败', 'Query failed'));
        } finally {
            setSearching(false);
        }
    };

    const modeLabel = (mode: CollectionMode) => mode === 'objects'
        ? t('目标区域', 'Object regions')
        : t('整张图片', 'Whole images');

    const formatDate = (value: string | null) => {
        if (!value) return t('尚未入库', 'Never ingested');
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(zh ? 'zh-CN' : 'en-US');
    };

    const renderServiceNotice = () => {
        if (backendDown) {
            return <div className='ServiceNotice error' role='alert'>
                <span>{t('无法连接拓展引擎，当前仅显示上次读取的数据。', 'Cannot reach the extension engine. Showing the last loaded data.')}</span>
                <button type='button' onClick={refreshStatus}>{t('重试', 'Retry')}</button>
            </div>;
        }
        if (storeBad) {
            return <div className='ServiceNotice error' role='alert'>
                {t('向量存储不可用：', 'Vector store unavailable: ')}{status?.vector_store.error}
            </div>;
        }
        if (embedderBad) {
            return <div className='ServiceNotice error' role='alert'>
                <span>{t('特征模型不可用：', 'Feature model unavailable: ')}{status?.embedder.error}</span>
                <button type='button' disabled={warmingUp} onClick={warmup}>{t('重试加载', 'Retry loading')}</button>
            </div>;
        }
        if (status?.embedder.state === 'not_loaded') {
            return <div className='ServiceNotice info'>
                <span>{t('特征模型尚未加载。浏览集合不受影响；入库和快速向量检索需要先加载模型。',
                    'The feature model is not loaded. Collection browsing remains available; ingest and quick vector query require it.')}</span>
                <button type='button' disabled={warmingUp} onClick={warmup}>
                    {warmingUp ? t('正在启动…', 'Starting…') : t('加载特征模型', 'Load feature model')}
                </button>
            </div>;
        }
        if (status?.embedder.state === 'loading') {
            return <div className='ServiceNotice info' role='status'>
                {t('特征模型加载中', 'Loading feature model')}{status.embedder.progress > 0 ? ` · ${Math.round(status.embedder.progress)}%` : '…'}
            </div>;
        }
        return null;
    };

    const renderCreateCollection = () => (
        <div className='CreateCollectionCard'>
            <label className='FieldStack'>
                <span>{t('集合名称', 'Collection name')}</span>
                <input
                    autoFocus
                    value={newName}
                    placeholder={t('例如：产线缺陷', 'e.g. line-defects')}
                    onChange={event => setNewName(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') createCollection(); }}
                />
            </label>
            <fieldset className='ModePicker'>
                <legend>{t('向量单位（创建后不可修改）', 'Vector unit (immutable after creation)')}</legend>
                <button
                    type='button'
                    className={createMode === 'objects' ? 'ModeOption selected' : 'ModeOption'}
                    role='radio'
                    aria-checked={createMode === 'objects'}
                    onClick={() => setCreateMode('objects')}
                >
                    <strong>{t('目标区域', 'Object regions')}</strong>
                    <span>{t('先检测目标，每个目标生成一个向量', 'Detect objects first; one vector per object')}</span>
                </button>
                <button
                    type='button'
                    className={createMode === 'images' ? 'ModeOption selected' : 'ModeOption'}
                    role='radio'
                    aria-checked={createMode === 'images'}
                    onClick={() => setCreateMode('images')}
                >
                    <strong>{t('整张图片', 'Whole images')}</strong>
                    <span>{t('每张图片生成一个全局向量', 'Create one global vector per image')}</span>
                </button>
            </fieldset>
            {createError && <div className='InlineError' role='alert'>{createError}</div>}
            <div className='InlineActions'>
                <button type='button' className='SecondaryButton' onClick={() => setShowCreate(false)}>{t('取消', 'Cancel')}</button>
                <button
                    type='button'
                    className='PrimaryButton'
                    disabled={!newName.trim() || creating || !storeReady || storeBad || backendDown}
                    onClick={createCollection}
                >
                    {creating ? t('创建中…', 'Creating…') : t('创建集合', 'Create collection')}
                </button>
            </div>
        </div>
    );

    const renderCollections = () => (
        <aside className='CollectionsPanel'>
            <div className='PanelHeading'>
                <div>
                    <span className='Eyebrow'>{t('资源', 'Resources')}</span>
                    <strong>{t('向量集合', 'Collections')}</strong>
                </div>
                <span className='CountBadge'>{collections.length}</span>
            </div>
            <button
                type='button'
                className='NewCollectionButton'
                disabled={!storeReady || storeBad || backendDown}
                onClick={() => { setShowCreate(value => !value); setCreateError(null); }}
            >
                <span aria-hidden='true'>＋</span>{t('新建集合', 'New collection')}
            </button>
            {showCreate && renderCreateCollection()}
            {collectionsLoading && <div className='CollectionState' role='status'>{t('正在读取集合…', 'Loading collections…')}</div>}
            {!collectionsLoading && collectionsError && (
                <div className='CollectionState error' role='alert'>
                    <span>{collectionsError}</span>
                    <button type='button' onClick={refreshCollections}>{t('重试', 'Retry')}</button>
                </div>
            )}
            {!collectionsLoading && !collectionsError && collections.length === 0 && (
                <div className='CollectionState empty'>
                    <strong>{t('还没有向量集合', 'No collections yet')}</strong>
                    <span>{t('新建集合后即可导入图片并生成向量。', 'Create a collection, then add images to generate vectors.')}</span>
                </div>
            )}
            <div className='CollectionList' role='list'>
                {collections.map(collection => (
                    <button
                        type='button'
                        role='listitem'
                        key={collection.name}
                        className={selectedName === collection.name ? 'CollectionRow selected' : 'CollectionRow'}
                        aria-current={selectedName === collection.name ? 'true' : undefined}
                        onClick={() => setSelectedName(collection.name)}
                    >
                        <span className='CollectionRowTop'>
                            <strong title={collection.display_name}>{collection.display_name}</strong>
                            <span>{collection.count.toLocaleString()}</span>
                        </span>
                        <span className='CollectionRowMeta'>
                            <span className={`ModeBadge ${collection.mode}`}>{modeLabel(collection.mode)}</span>
                            <span>{collection.dim}{t(' 维', 'd')}</span>
                        </span>
                    </button>
                ))}
            </div>
        </aside>
    );

    const renderDatasetSource = () => (
        <div className='SourceCard'>
            <label className='FieldStack'>
                <span>{t('选择数据任务', 'Select a Data Task')}</span>
                <select
                    value={datasetId}
                    disabled={datasetsLoading || !!datasetsError}
                    onChange={event => setDatasetId(event.target.value)}
                >
                    <option value=''>{datasetsLoading
                        ? t('正在读取…', 'Loading…')
                        : t('请选择一个数据集', 'Choose a dataset')}</option>
                    {datasets.map(dataset => (
                        <option key={dataset.id} value={dataset.id}>
                            {dataset.name}（{dataset.image_count}）
                        </option>
                    ))}
                </select>
            </label>
            {datasetsError && <div className='InlineError' role='alert'>
                {t('数据任务不可用；你仍可切换到本地上传。', 'Data Tasks are unavailable; local upload is still available.')}
                <button type='button' onClick={refreshDatasets}>{t('重试', 'Retry')}</button>
            </div>}
            {!datasetsLoading && !datasetsError && datasets.length === 0 && (
                <div className='MutedText'>{t('暂无数据任务数据集，可改用本地上传。', 'No Data Task datasets; use local upload instead.')}</div>
            )}
        </div>
    );

    const renderUploadSource = () => (
        <div {...ingestDropzone.getRootProps({className: `UploadZone${ingestDropzone.isDragActive ? ' active' : ''}`})}>
            <input {...ingestDropzone.getInputProps()} />
            <span className='UploadIcon' aria-hidden='true'>⇧</span>
            <strong>{pendingFiles.length > 0
                ? t(`已选择 ${pendingFiles.length} 个文件`, `${pendingFiles.length} file(s) selected`)
                : t('拖入图片或 ZIP', 'Drop images or a ZIP')}</strong>
            <span>{t('支持 JPG、PNG、BMP、WebP 与 ZIP', 'JPG, PNG, BMP, WebP and ZIP are supported')}</span>
        </div>
    );

    const renderIngest = () => {
        if (!selected) return null;
        const noSource = ingestSource === 'dataset' ? !datasetId : pendingFiles.length === 0;
        const disabled = !embedderReady || !storeReady || activeJob || submittingIngest || noSource;
        return <div className='WorkspaceBody'>
            <div className='ImmutableModeNotice'>
                <span>{t('本集合向量单位', 'Collection vector unit')}</span>
                <strong>{modeLabel(selected.mode)}</strong>
                <small>{t('创建时已固定，后续入库将始终使用该粒度。', 'Fixed at creation; every ingest uses this granularity.')}</small>
            </div>
            <div className='FormSection'>
                <span className='FormLabel'>{t('数据来源', 'Data source')}</span>
                <div className='SegmentedControl' role='tablist' aria-label={t('入库数据来源', 'Ingest source')}>
                    <button
                        type='button'
                        role='tab'
                        aria-selected={ingestSource === 'dataset'}
                        className={ingestSource === 'dataset' ? 'active' : ''}
                        onClick={() => { setIngestSource('dataset'); setPendingFiles([]); }}
                    >{t('数据任务', 'Data Tasks')}</button>
                    <button
                        type='button'
                        role='tab'
                        aria-selected={ingestSource === 'upload'}
                        className={ingestSource === 'upload' ? 'active' : ''}
                        onClick={() => { setIngestSource('upload'); setDatasetId(''); }}
                    >{t('本地上传', 'Local upload')}</button>
                </div>
            </div>
            {ingestSource === 'dataset' ? renderDatasetSource() : renderUploadSource()}
            {ingestError && <div className='InlineError' role='alert'>{ingestError}</div>}
            <button type='button' className='PrimaryButton' disabled={disabled} onClick={startIngest}>
                {submittingIngest ? t('正在提交…', 'Submitting…') : t('开始生成向量', 'Start vector ingest')}
            </button>
        </div>;
    };

    const renderQuery = () => {
        if (!selected) return null;
        return <div className='WorkspaceBody'>
            <div className='QueryBoundaryNote'>
                <strong>{t('快速向量检索', 'Quick vector query')}</strong>
                <span>{t('用于验证当前集合中的向量相似度；高精度检索是独立功能。',
                    'Use this to validate vector similarity in this collection. High-precision retrieval is a separate feature.')}</span>
            </div>
            <div className='QueryComposer'>
                <div {...queryDropzone.getRootProps({className: `QueryDropzone${queryDropzone.isDragActive ? ' active' : ''}`})}>
                    <input {...queryDropzone.getInputProps()} />
                    {queryPreview
                        ? <img src={queryPreview} alt={queryFile?.name || t('查询图片', 'Query image')}/>
                        : <span>{t('拖入或点击选择查询图片', 'Drop or click to choose a query image')}</span>}
                </div>
                <div className='QueryFields'>
                    <label className='FieldStack compact'>
                        <span>Top-K</span>
                        <input
                            type='number'
                            min={1}
                            max={100}
                            value={topK}
                            onChange={event => setTopK(Math.max(1, Math.min(100, Number(event.target.value) || 12)))}
                        />
                    </label>
                    {selected.mode === 'objects' && <label className='FieldStack'>
                        <span>{t('类别过滤（可选）', 'Class filter (optional)')}</span>
                        <input
                            value={classFilter}
                            placeholder={t('例如：person', 'e.g. person')}
                            onChange={event => setClassFilter(event.target.value)}
                        />
                    </label>}
                    <button
                        type='button'
                        className='PrimaryButton'
                        disabled={!embedderReady || !storeReady || !queryFile || searching}
                        onClick={runQuery}
                    >
                        {searching ? t('检索中…', 'Querying…') : t('执行快速检索', 'Run quick query')}
                    </button>
                </div>
            </div>
            {searchError && <div className='InlineError' role='alert'>{searchError}</div>}
            {results !== null && results.length === 0 && <div className='ResultEmpty'>{t('没有找到相似向量', 'No similar vectors found')}</div>}
            {results !== null && results.length > 0 && <div className='ResultGrid' aria-live='polite'>
                {results.map((result, index) => (
                    <div className='ResultCard' key={`${result.filename}-${index}`}>
                        {result.thumbnail
                            ? <img src={result.thumbnail} alt={result.filename}/>
                            : <div className='ThumbPlaceholder'>{t('无缩略图', 'No preview')}</div>}
                        <span className='ScoreBadge'>{(result.score * 100).toFixed(1)}%</span>
                        <div className='ResultMeta'>
                            {result.class_name && <span className='ClassTag'>{result.class_name}</span>}
                            <span title={result.filename}>{result.filename}</span>
                        </div>
                    </div>
                ))}
            </div>}
        </div>;
    };

    const renderSelectedCollection = () => {
        if (!selected) {
            return <div className='WorkspaceEmpty'>
                <span className='EmptyGlyph' aria-hidden='true'>◇</span>
                <strong>{t('选择或新建一个向量集合', 'Select or create a vector collection')}</strong>
                <span>{t('集合用于隔离不同业务、向量粒度与特征模型。', 'Collections isolate business domains, vector units and feature models.')}</span>
            </div>;
        }
        return <section className='CollectionWorkspace'>
            <header className='CollectionHeader'>
                <div className='CollectionTitle'>
                    <div>
                        <span className='Eyebrow'>{t('当前集合', 'Current collection')}</span>
                        <h3>{selected.display_name}</h3>
                    </div>
                    <span className={`ModeBadge ${selected.mode}`}>{modeLabel(selected.mode)}</span>
                </div>
                <button
                    type='button'
                    className='DangerButton'
                    disabled={selectedJobActive}
                    onClick={() => { setDeleteConfirm(true); setDeleteError(null); }}
                >{t('删除集合', 'Delete collection')}</button>
            </header>
            <div className='MetadataGrid'>
                <div><span>{t('向量数量', 'Vectors')}</span><strong>{selected.count.toLocaleString()}</strong></div>
                <div><span>{t('向量维度', 'Dimensions')}</span><strong>{selected.dim}</strong></div>
                <div><span>{t('特征模型', 'Embedder')}</span><strong title={selected.embedder}>{selected.embedder}</strong></div>
                <div><span>{t('最近入库', 'Last ingest')}</span><strong>{formatDate(selected.last_ingest_at)}</strong></div>
            </div>
            {deleteConfirm && <div className='DeleteConfirm' role='alert'>
                <div>
                    <strong>{t('永久删除这个集合？', 'Permanently delete this collection?')}</strong>
                    <span>{t('集合内向量与插件保存的上传副本会被删除；数据任务中的源数据不受影响。',
                        'Vectors and plugin-managed upload copies will be removed; Data Task source data is unchanged.')}</span>
                    {deleteError && <span className='InlineError'>{deleteError}</span>}
                </div>
                <div className='InlineActions'>
                    <button type='button' className='SecondaryButton' onClick={() => setDeleteConfirm(false)}>{t('取消', 'Cancel')}</button>
                    <button type='button' className='DangerButton solid' disabled={deleting} onClick={deleteCollection}>
                        {deleting ? t('删除中…', 'Deleting…') : t('确认删除', 'Delete')}
                    </button>
                </div>
            </div>}
            <div className='WorkspaceTabs' role='tablist' aria-label={t('集合操作', 'Collection actions')}>
                <button
                    type='button'
                    role='tab'
                    aria-selected={activeTab === 'ingest'}
                    className={activeTab === 'ingest' ? 'active' : ''}
                    onClick={() => setActiveTab('ingest')}
                >{t('添加数据', 'Add data')}</button>
                <button
                    type='button'
                    role='tab'
                    aria-selected={activeTab === 'query'}
                    className={activeTab === 'query' ? 'active' : ''}
                    onClick={() => setActiveTab('query')}
                >{t('快速向量检索', 'Quick vector query')}</button>
            </div>
            {activeTab === 'ingest' ? renderIngest() : renderQuery()}
        </section>;
    };

    const renderJob = () => {
        if (!job) return null;
        const percent = job.total_images > 0
            ? Math.min(100, Math.round((job.processed_images / job.total_images) * 100))
            : 0;
        const label = JOB_STATE_LABELS[job.state] || JOB_STATE_LABELS.queued;
        return <div className={`ActivityStrip ${job.state}`} aria-live='polite'>
            <div className='ActivityMain'>
                <span className='ActivityDot'/>
                <div>
                    <strong>{t(label[0], label[1])} · {job.collection}</strong>
                    <span>
                        {job.processed_images}/{job.total_images} {t('张图片', 'images')} ·{' '}
                        {job.inserted_objects.toLocaleString()} {t('个向量', 'vectors')}
                        {job.skipped_images > 0 && ` · ${job.skipped_images} ${t('跳过', 'skipped')}`}
                    </span>
                </div>
            </div>
            <div
                className='ActivityProgress'
                role='progressbar'
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={t('入库进度', 'Ingest progress')}
            ><span style={{width: `${percent}%`}}/></div>
            {job.error && <div className='InlineError'>{job.error}</div>}
            {activeJob
                ? <button type='button' className='SecondaryButton' onClick={cancelIngest}>{t('取消任务', 'Cancel job')}</button>
                : <button type='button' className='SecondaryButton' onClick={() => setJob(null)}>{t('隐藏', 'Dismiss')}</button>}
        </div>;
    };

    const renderContent = () => (
        <div className='VectorDbPopupContent'>
            <div className='VectorDbIntro'>
                <div>
                    <span className='Eyebrow'>{t('拓展服务', 'Extension service')}</span>
                    <p>{t('管理视觉向量集合、导入业务数据，并用快速向量检索验证索引。高精度检索保持为独立功能。',
                        'Manage visual-vector collections, ingest business data and validate indexes with quick vector queries. High-precision retrieval remains separate.')}</p>
                </div>
                <div className='ServiceChips' aria-label={t('服务概况', 'Service overview')}>
                    <span className={`ServiceChip ${storeReady ? 'ready' : 'pending'}`}>
                        <i/>{storeReady ? t('向量存储就绪', 'Store ready') : t('检查向量存储', 'Checking store')}
                    </span>
                    <span className={`ServiceChip ${embedderReady ? 'ready' : 'pending'}`}>
                        <i/>{embedderReady
                            ? `${status?.embedder.model} · ${status?.embedder.dim || '—'}d · ${status?.embedder.device || '—'}`
                            : t('特征模型未就绪', 'Embedder not ready')}
                    </span>
                </div>
            </div>
            {renderServiceNotice()}
            <div className='OverviewStats'>
                <div><span>{t('集合', 'Collections')}</span><strong>{collections.length}</strong></div>
                <div><span>{t('向量总数', 'Total vectors')}</span><strong>{totalVectors.toLocaleString()}</strong></div>
                <div><span>{t('活动任务', 'Active jobs')}</span><strong>{activeJob ? 1 : 0}</strong></div>
            </div>
            <div className='VectorWorkspace'>
                {renderCollections()}
                {renderSelectedCollection()}
            </div>
            {renderJob()}
        </div>
    );

    return <GenericYesNoPopup
        title={t('向量数据库', 'Vector Database')}
        renderContent={renderContent}
        skipAcceptButton
        rejectLabel={t('关闭', 'Close')}
        onReject={() => PopupActions.close()}
    />;
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
});

export default connect(mapStateToProps)(VectorDbPopup);
