import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useDropzone} from 'react-dropzone';
import {connect} from 'react-redux';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {getEngineBaseUrl, getExtensionEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import './VectorDbPopup.scss';

type Granularity = 'image' | 'bbox';
type WorkspaceTab = 'ingest' | 'history';
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
    profiles?: Record<Granularity, FeatureProfile>;
}

interface FeatureProfile {
    profile_id: string;
    model: string;
    dimension: number;
    granularity: Granularity;
    metric: string;
}

interface CollectionInfo {
    name: string;
    display_name: string;
    dim: number;
    embedder: string;
    granularity: Granularity;
    mode?: 'objects' | 'images';
    count: number;
    created_at: string;
    last_ingest_at: string | null;
    schema_version: number;
    profile_id: string;
    profile: FeatureProfile;
    library_id: string;
    target_id?: string;
    target_name?: string;
    scene_id?: string;
    scene_name?: string;
    world_id?: string | null;
    version: number;
    active: boolean;
    index_type: string;
    index_params: Record<string, unknown>;
    compatible: boolean;
    compatibility_reason: string | null;
    quality: {
        valid_vectors?: number;
        invalid_vectors?: number;
        norm_min?: number;
        norm_max?: number;
        norm_mean?: number;
        failed_images?: number;
        skipped_images?: number;
    };
}

interface TargetGroup {
    targetId: string;
    targetName: string;
    vectorCount: number;
    versions: CollectionInfo[];
}

interface SceneGroup {
    sceneId: string;
    sceneName: string;
    vectorCount: number;
    targets: TargetGroup[];
}

interface IngestJob {
    job_id: string;
    state: string;
    collection: string;
    granularity: Granularity;
    mode?: 'objects' | 'images';
    source: string;
    dataset_id?: string | null;
    total_images: number;
    processed_images: number;
    inserted_objects: number;
    inserted_vectors: number;
    skipped_images: number;
    failed_images: number;
    invalid_vectors: number;
    throughput_images_per_sec: number;
    eta_seconds: number | null;
    resumable: boolean;
    error: string | null;
    started_at?: string | null;
    updated_at?: string | null;
    finished_at?: string | null;
}

interface DatasetSummary {
    id: string;
    name: string;
    image_count: number;
}

interface IProps {
    language: Language;
}

const TERMINAL_JOB_STATES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

const JOB_STATE_LABELS: Record<string, [string, string]> = {
    completed: ['入库完成', 'Ingest completed'],
    failed: ['入库失败', 'Ingest failed'],
    cancelled: ['已取消', 'Cancelled'],
    interrupted: ['任务已中断', 'Ingest interrupted'],
    running: ['正在入库', 'Ingesting'],
    queued: ['等待入库', 'Queued'],
};

const collectionTargetId = (collection: CollectionInfo) =>
    collection.target_id || collection.library_id || `target_${collection.name}`;

const collectionTargetName = (collection: CollectionInfo) =>
    collection.target_name || collection.display_name || collection.name;

const collectionGranularity = (collection: CollectionInfo): Granularity =>
    collection.granularity || (collection.mode === 'images' ? 'image' : 'bbox');

const normalizeCollection = (collection: CollectionInfo): CollectionInfo => {
    const targetId = collectionTargetId(collection);
    const targetName = collectionTargetName(collection);
    return {
        ...collection,
        display_name: targetName,
        target_id: targetId,
        target_name: targetName,
        scene_id: collection.scene_id || 'scene_default',
        scene_name: collection.scene_name || '默认场景',
        granularity: collectionGranularity(collection),
        schema_version: collection.schema_version || 1,
        version: collection.version || 1,
        active: collection.active ?? true,
        compatible: collection.compatible ?? true,
        quality: collection.quality || {},
        index_type: collection.index_type || 'FLAT',
        index_params: collection.index_params || {},
    };
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
    const [newSceneName, setNewSceneName] = useState('默认场景');
    const [newTargetName, setNewTargetName] = useState('');
    const [createGranularity, setCreateGranularity] = useState<Granularity>('bbox');
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [versioning, setVersioning] = useState(false);

    const [activeTab, setActiveTab] = useState<WorkspaceTab>('ingest');
    const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
    const [datasetsLoading, setDatasetsLoading] = useState(true);
    const [datasetsError, setDatasetsError] = useState<string | null>(null);
    const [ingestSource, setIngestSource] = useState<IngestSource>('dataset');
    const [datasetId, setDatasetId] = useState('');
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [submittingIngest, setSubmittingIngest] = useState(false);
    const [job, setJob] = useState<IngestJob | null>(null);
    const [jobs, setJobs] = useState<IngestJob[]>([]);
    const [jobsLoading, setJobsLoading] = useState(true);
    const [jobsError, setJobsError] = useState<string | null>(null);
    const [ingestError, setIngestError] = useState<string | null>(null);

    const selected = collections.find(collection => collection.name === selectedName) || null;
    const hierarchy = useMemo<SceneGroup[]>(() => {
        const sceneMap = new Map<string, {
            sceneId: string;
            sceneName: string;
            vectorCount: number;
            targets: Map<string, TargetGroup>;
        }>();
        collections.forEach(collection => {
            const sceneId = collection.scene_id || 'scene_default';
            const targetId = collection.target_id || collection.library_id;
            let scene = sceneMap.get(sceneId);
            if (!scene) {
                scene = {
                    sceneId,
                    sceneName: collection.scene_name || '默认场景',
                    vectorCount: 0,
                    targets: new Map<string, TargetGroup>(),
                };
                sceneMap.set(sceneId, scene);
            }
            let target = scene.targets.get(targetId);
            if (!target) {
                target = {
                    targetId,
                    targetName: collection.target_name || collection.display_name,
                    vectorCount: 0,
                    versions: [],
                };
                scene.targets.set(targetId, target);
            }
            target.versions.push(collection);
            target.vectorCount += collection.count;
            scene.vectorCount += collection.count;
        });
        return Array.from(sceneMap.values())
            .sort((left, right) => left.sceneName.localeCompare(right.sceneName))
            .map(scene => ({
                sceneId: scene.sceneId,
                sceneName: scene.sceneName,
                vectorCount: scene.vectorCount,
                targets: Array.from(scene.targets.values())
                    .sort((left, right) => left.targetName.localeCompare(right.targetName))
                    .map(target => ({
                        ...target,
                        versions: target.versions.sort((left, right) => left.version - right.version),
                    })),
            }));
    }, [collections]);
    const totalTargets = useMemo(
        () => hierarchy.reduce((total, scene) => total + scene.targets.length, 0),
        [hierarchy],
    );
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
    const activeJobsCount = jobs.filter(item => !TERMINAL_JOB_STATES.has(item.state)).length;

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
            const nextCollections = Array.isArray(data.collections)
                ? data.collections.map(normalizeCollection)
                : [];
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
            setDatasetsError(cause instanceof Error ? cause.message : t('数据管理不可用', 'Data Management unavailable'));
        } finally {
            setDatasetsLoading(false);
        }
    }, [coreBaseUrl, t]);

    const recoverJob = useCallback(async () => {
        setJobsLoading(true);
        setJobsError(null);
        try {
            const response = await fetch(`${baseUrl}/jobs`);
            const data = await readResponse<{jobs?: IngestJob[]}>(response);
            const nextJobs = Array.isArray(data.jobs) ? data.jobs : [];
            setJobs(nextJobs);
            const visible = nextJobs.find(item => !TERMINAL_JOB_STATES.has(item.state))
                || nextJobs.find(item => item.resumable);
            setJob(visible || null);
        } catch (cause) {
            setJobsError(cause instanceof Error ? cause.message : t('入库记录加载失败', 'Failed to load ingest history'));
        } finally {
            setJobsLoading(false);
        }
    }, [baseUrl, t]);

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
                setJobs(current => {
                    const exists = current.some(item => item.job_id === nextJob.job_id);
                    return exists
                        ? current.map(item => item.job_id === nextJob.job_id ? nextJob : item)
                        : [nextJob, ...current];
                });
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
        setIngestSource('dataset');
        setIngestError(null);
        setDeleteConfirm(false);
        setDeleteError(null);
    }, [selectedName]);

    const warmup = async () => {
        setWarmingUp(true);
        try {
            const response = await fetch(`${baseUrl}/warmup`, {method: 'POST'});
            await readResponse(response);
            await refreshStatus();
        } catch {
            await refreshStatus();
        } finally {
            setWarmingUp(false);
        }
    };

    const createTarget = async () => {
        const sceneName = newSceneName.trim();
        const targetName = newTargetName.trim();
        if (!sceneName || !targetName || creating) return;
        setCreating(true);
        setCreateError(null);
        try {
            const existingScene = hierarchy.find(scene => scene.sceneName === sceneName);
            const response = await fetch(`${baseUrl}/targets`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    scene_id: existingScene?.sceneId,
                    scene_name: sceneName,
                    target_name: targetName,
                    granularity: createGranularity,
                }),
            });
            const created = await readResponse<CollectionInfo>(response);
            setNewTargetName('');
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

    const createCurrentVersion = async () => {
        if (!selected || versioning) return;
        setVersioning(true);
        setIngestError(null);
        try {
            const response = await fetch(
                `${baseUrl}/targets/${encodeURIComponent(selected.target_id || selected.library_id)}/versions`,
                {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({}),
                },
            );
            const created = await readResponse<CollectionInfo>(response);
            await refreshCollections();
            setSelectedName(created.name);
        } catch (cause) {
            setIngestError(cause instanceof Error ? cause.message : t('创建版本失败', 'Failed to create version'));
        } finally {
            setVersioning(false);
        }
    };

    const activateVersion = async () => {
        if (!selected || selected.active || versioning) return;
        setVersioning(true);
        try {
            const response = await fetch(
                `${baseUrl}/collections/${encodeURIComponent(selected.name)}/activate`,
                {method: 'POST'},
            );
            await readResponse(response);
            await refreshCollections();
        } catch (cause) {
            setIngestError(cause instanceof Error ? cause.message : t('切换版本失败', 'Failed to activate version'));
        } finally {
            setVersioning(false);
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
        disabled: !embedderReady || !storeReady || !selected?.compatible || activeJob || submittingIngest,
        multiple: true,
        onDrop: onIngestDrop,
    });

    const startIngest = async () => {
        if (!selected || activeJob || submittingIngest) return;
        setSubmittingIngest(true);
        setIngestError(null);
        const form = new FormData();
        form.append('granularity', selected.granularity);
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
            const queuedJob: IngestJob = {
                job_id: body.job_id,
                state: 'queued',
                collection: selected.name,
                granularity: selected.granularity,
                source: ingestSource,
                total_images: 0,
                processed_images: 0,
                inserted_vectors: 0,
                inserted_objects: 0,
                skipped_images: 0,
                failed_images: 0,
                invalid_vectors: 0,
                throughput_images_per_sec: 0,
                eta_seconds: null,
                resumable: false,
                error: null,
                started_at: new Date().toISOString(),
            };
            setJob(queuedJob);
            setJobs(current => [queuedJob, ...current.filter(item => item.job_id !== queuedJob.job_id)]);
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

    const resumeIngest = async () => {
        if (!job || activeJob || !job.resumable) return;
        try {
            const response = await fetch(
                `${baseUrl}/jobs/${encodeURIComponent(job.job_id)}/resume`,
                {method: 'POST'},
            );
            await readResponse(response);
            const resumed = {...job, state: 'queued', error: null};
            setJob(resumed);
            setJobs(current => current.map(item => item.job_id === resumed.job_id ? resumed : item));
        } catch (cause) {
            setIngestError(cause instanceof Error ? cause.message : t('恢复失败', 'Resume failed'));
        }
    };

    const granularityLabel = (granularity: Granularity) => granularity === 'bbox'
        ? t('目标框', 'Bounding boxes')
        : t('整张图片', 'Whole images');

    const formatDate = (value?: string | null) => {
        if (!value) return t('尚未入库', 'Never ingested');
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(zh ? 'zh-CN' : 'en-US');
    };

    const formatDuration = (item: IngestJob) => {
        if (!item.started_at) return '—';
        const started = new Date(item.started_at).getTime();
        const ended = new Date(item.finished_at || item.updated_at || Date.now()).getTime();
        if (Number.isNaN(started) || Number.isNaN(ended)) return '—';
        const seconds = Math.max(0, Math.round((ended - started) / 1000));
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        return `${minutes}m ${seconds % 60}s`;
    };

    const formatVectorNorm = (collection: CollectionInfo) => collection.quality.norm_mean != null
        ? `${collection.quality.norm_mean.toFixed(4)} (${collection.quality.norm_min?.toFixed(3)}–${collection.quality.norm_max?.toFixed(3)})`
        : '—';

    const renderVersionAction = (collection: CollectionInfo) => {
        if (collection.active || !collection.compatible) return null;
        return <button
            type='button'
            className='SecondaryButton'
            disabled={versioning}
            onClick={activateVersion}
        >{t('设为当前版本', 'Make active')}</button>;
    };

    const renderProfileWarning = (collection: CollectionInfo) => {
        if (collection.compatible) return null;
        const compatibleSibling = collections.find(candidate =>
            collectionTargetId(candidate) === collectionTargetId(collection)
            && candidate.compatible,
        );
        return <div className='ProfileWarning' role='alert'>
            <div>
                <strong>{t('当前特征模型与这个版本不兼容', 'Current feature model is incompatible with this version')}</strong>
                <span>{collection.compatibility_reason}</span>
            </div>
            {compatibleSibling
                ? <button
                    type='button'
                    className='PrimaryButton'
                    onClick={() => setSelectedName(compatibleSibling.name)}
                >{t(`切换到兼容的 v${compatibleSibling.version}`, `Open compatible v${compatibleSibling.version}`)}</button>
                : <button type='button' className='PrimaryButton' disabled={versioning} onClick={createCurrentVersion}>
                    {versioning ? t('创建中…', 'Creating…') : t('新建当前模型版本', 'Create current-model version')}
                </button>}
        </div>;
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
                <span>{t('特征模型尚未加载。浏览集合和入库记录不受影响；生成向量需要先加载模型。',
                    'The feature model is not loaded. Browsing collections and ingest history remain available; vector ingest requires it.')}</span>
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

    const renderCreateTarget = () => (
        <div className='CreateCollectionCard'>
            <label className='FieldStack'>
                <span>{t('场景名称', 'Scene name')}</span>
                <input
                    autoFocus
                    list='vector-db-scenes'
                    value={newSceneName}
                    placeholder={t('例如：钢板产线', 'e.g. steel line')}
                    onChange={event => setNewSceneName(event.target.value)}
                />
                <datalist id='vector-db-scenes'>
                    {hierarchy.map(scene => <option key={scene.sceneId} value={scene.sceneName}/>) }
                </datalist>
            </label>
            <label className='FieldStack'>
                <span>{t('目标名称', 'Target name')}</span>
                <input
                    value={newTargetName}
                    placeholder={t('例如：划痕', 'e.g. scratch')}
                    onChange={event => setNewTargetName(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') createTarget(); }}
                />
            </label>
            <fieldset className='ModePicker'>
                <legend>{t('向量单位（创建后不可修改）', 'Vector unit (immutable after creation)')}</legend>
                <button
                    type='button'
                    className={createGranularity === 'bbox' ? 'ModeOption selected' : 'ModeOption'}
                    role='radio'
                    aria-checked={createGranularity === 'bbox'}
                    onClick={() => setCreateGranularity('bbox')}
                >
                    <strong>{t('目标框', 'Bounding boxes')}</strong>
                    <span>{t('数据批次读取标注框；散图上传自动检测', 'Use batch annotations; detect objects for loose uploads')}</span>
                </button>
                <button
                    type='button'
                    className={createGranularity === 'image' ? 'ModeOption selected' : 'ModeOption'}
                    role='radio'
                    aria-checked={createGranularity === 'image'}
                    onClick={() => setCreateGranularity('image')}
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
                    disabled={!newSceneName.trim() || !newTargetName.trim() || creating || !storeReady || storeBad || backendDown}
                    onClick={createTarget}
                >
                    {creating ? t('创建中…', 'Creating…') : t('创建目标及 v1', 'Create target and v1')}
                </button>
            </div>
        </div>
    );

    const renderCollections = () => (
        <aside className='CollectionsPanel'>
            <div className='PanelHeading'>
                <div>
                    <span className='Eyebrow'>{t('资源', 'Resources')}</span>
                    <strong>{t('场景 / 目标', 'Scenes / targets')}</strong>
                </div>
                <span className='CountBadge'>{totalTargets}</span>
            </div>
            <button
                type='button'
                className='NewCollectionButton'
                disabled={!storeReady || storeBad || backendDown}
                onClick={() => { setShowCreate(value => !value); setCreateError(null); }}
            >
                <span aria-hidden='true'>＋</span>{t('新建目标', 'New target')}
            </button>
            {showCreate && renderCreateTarget()}
            {collectionsLoading && <div className='CollectionState' role='status'>{t('正在读取目录…', 'Loading catalog…')}</div>}
            {!collectionsLoading && collectionsError && (
                <div className='CollectionState error' role='alert'>
                    <span>{collectionsError}</span>
                    <button type='button' onClick={refreshCollections}>{t('重试', 'Retry')}</button>
                </div>
            )}
            {!collectionsLoading && !collectionsError && collections.length === 0 && (
                <div className='CollectionState empty'>
                    <strong>{t('还没有目标', 'No targets yet')}</strong>
                    <span>{t('新建场景下的目标后，即可生成第一个向量版本。', 'Create a target in a scene to generate its first vector version.')}</span>
                </div>
            )}
            <div className='HierarchyList' role='tree' aria-label={t('向量目录', 'Vector catalog')}>
                {hierarchy.map(scene => (
                    <section className='SceneGroup' role='treeitem' aria-expanded='true' key={scene.sceneId}>
                        <div className='SceneHeading'>
                            <span aria-hidden='true'>▾</span>
                            <strong title={scene.sceneName}>{scene.sceneName}</strong>
                            <small>{scene.targets.length} {t('个目标', 'targets')}</small>
                        </div>
                        <div className='TargetList' role='group'>
                            {scene.targets.map(target => (
                                <div className='TargetGroup' key={target.targetId}>
                                    <div className='TargetHeading'>
                                        <strong title={target.targetName}>{target.targetName}</strong>
                                        <span>{target.vectorCount.toLocaleString()}</span>
                                    </div>
                                    <div className='VersionList'>
                                        {target.versions.map(collection => (
                                            <button
                                                type='button'
                                                key={collection.name}
                                                className={selectedName === collection.name ? 'VersionRow selected' : 'VersionRow'}
                                                aria-current={selectedName === collection.name}
                                                onClick={() => setSelectedName(collection.name)}
                                            >
                                                <span className={`VersionDot ${collection.active ? 'active' : ''}`}/>
                                                <strong>v{collection.version}</strong>
                                                <span>{granularityLabel(collection.granularity)}</span>
                                                <small>{collection.count.toLocaleString()}</small>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </aside>
    );

    const renderDatasetSource = () => (
        <div className='SourceCard'>
            <label className='FieldStack'>
                <span>{t('选择数据批次', 'Select a data batch')}</span>
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
                {t('数据管理不可用；你仍可切换到本地上传。', 'Data Management is unavailable; local upload is still available.')}
                <button type='button' onClick={refreshDatasets}>{t('重试', 'Retry')}</button>
            </div>}
            {!datasetsLoading && !datasetsError && datasets.length === 0 && (
                <div className='MutedText'>{t('暂无数据批次，可从文件队列同步或改用本地上传。', 'No data batches; sync one from File Queue or use local upload.')}</div>
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
        const disabled = !embedderReady || !storeReady || !selected.compatible
            || activeJob || submittingIngest || noSource;
        return <div className='WorkspaceBody'>
            <div className='ImmutableModeNotice'>
                <span>{t('本版本向量单位', 'Version vector unit')}</span>
                <strong>{granularityLabel(selected.granularity)}</strong>
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
                    >{t('数据管理', 'Data Management')}</button>
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

    const renderHistory = () => {
        if (!selected) return null;
        const selectedJobs = jobs.filter(item => item.collection === selected.name);
        return <div className='WorkspaceBody IngestHistory'>
            <div className='HistoryHeading'>
                <div>
                    <strong>{t('入库记录', 'Ingest history')}</strong>
                    <span>{t('记录持久保存在拓展引擎中，页面刷新后仍可追溯。',
                        'Records are persisted by the extension engine and remain available after refresh.')}</span>
                </div>
                <button type='button' className='SecondaryButton' disabled={jobsLoading} onClick={recoverJob}>
                    {jobsLoading ? t('刷新中…', 'Refreshing…') : t('刷新记录', 'Refresh')}
                </button>
            </div>
            {jobsError && <div className='InlineError' role='alert'>{jobsError}</div>}
            {!jobsLoading && !jobsError && selectedJobs.length === 0 && (
                <div className='HistoryEmpty'>{t('这个版本还没有入库记录。', 'This version has no ingest history yet.')}</div>
            )}
            <div className='HistoryList'>
                {selectedJobs.map(item => {
                    const label = JOB_STATE_LABELS[item.state] || JOB_STATE_LABELS.queued;
                    const source = item.source === 'dataset'
                        ? item.dataset_id || t('数据管理', 'Data Management')
                        : t('本地上传', 'Local upload');
                    return <article className={`HistoryRow ${item.state}`} key={item.job_id}>
                        <div className='HistoryState'>
                            <span className='HistoryDot'/>
                            <div>
                                <strong>{t(label[0], label[1])}</strong>
                                <small title={item.job_id}>{item.job_id.slice(0, 12)}</small>
                            </div>
                        </div>
                        <div className='HistoryMetric'>
                            <span>{t('数据来源', 'Source')}</span>
                            <strong title={source}>{source}</strong>
                        </div>
                        <div className='HistoryMetric'>
                            <span>{t('处理结果', 'Processed')}</span>
                            <strong>{item.processed_images}/{item.total_images} · {item.inserted_vectors ?? item.inserted_objects} {t('向量', 'vectors')}</strong>
                        </div>
                        <div className='HistoryMetric'>
                            <span>{t('开始时间 / 耗时', 'Started / duration')}</span>
                            <strong>{formatDate(item.started_at)} · {formatDuration(item)}</strong>
                        </div>
                        <div className='HistoryMetric anomalies'>
                            <span>{t('异常', 'Anomalies')}</span>
                            <strong>{item.failed_images} {t('失败', 'failed')} · {item.skipped_images} {t('跳过', 'skipped')} · {item.invalid_vectors} {t('无效', 'invalid')}</strong>
                        </div>
                        {item.error && <div className='HistoryError'>{item.error}</div>}
                    </article>;
                })}
            </div>
        </div>;
    };

    const renderDeleteConfirmation = () => {
        if (!deleteConfirm) return null;
        return <div className='DeleteConfirm' role='alert'>
            <div>
                <strong>{t('永久删除这个版本？', 'Permanently delete this version?')}</strong>
                <span>{t('该版本的向量与插件保存的上传副本会被删除；同一目标的其他版本和源数据不受影响。',
                    'Vectors and plugin-managed upload copies will be removed; Data Management source data is unchanged.')}</span>
                {deleteError && <span className='InlineError'>{deleteError}</span>}
            </div>
            <div className='InlineActions'>
                <button type='button' className='SecondaryButton' onClick={() => setDeleteConfirm(false)}>{t('取消', 'Cancel')}</button>
                <button type='button' className='DangerButton solid' disabled={deleting} onClick={deleteCollection}>
                    {deleting ? t('删除中…', 'Deleting…') : t('确认删除', 'Delete')}
                </button>
            </div>
        </div>;
    };

    const renderActiveWorkspace = () => activeTab === 'ingest' ? renderIngest() : renderHistory();

    const renderSelectedCollection = () => {
        if (!selected) {
            return <div className='WorkspaceEmpty'>
                <span className='EmptyGlyph' aria-hidden='true'>◇</span>
                <strong>{t('选择或新建一个目标', 'Select or create a target')}</strong>
                <span>{t('场景管理业务上下文，目标管理检索对象，版本锁定特征模型配方。',
                    'Scenes hold business context, targets hold retrieval subjects, and versions lock feature recipes.')}</span>
            </div>;
        }
        return <section className='CollectionWorkspace'>
            <header className='CollectionHeader'>
                <div className='CollectionTitle'>
                    <div>
                        <span className='Eyebrow'>
                            {selected.scene_name || t('默认场景', 'Default scene')} / {t('目标', 'Target')}
                        </span>
                        <h3>{selected.target_name || selected.display_name}</h3>
                    </div>
                    <span className={`ModeBadge ${selected.granularity}`}>
                        {granularityLabel(selected.granularity)} · v{selected.version}
                    </span>
                </div>
                <div className='InlineActions'>
                    {renderVersionAction(selected)}
                    <button
                        type='button'
                        className='DangerButton'
                        disabled={selectedJobActive}
                        onClick={() => { setDeleteConfirm(true); setDeleteError(null); }}
                    >{t('删除版本', 'Delete version')}</button>
                </div>
            </header>
            <div className='MetadataGrid'>
                <div><span>{t('场景', 'Scene')}</span><strong>{selected.scene_name || t('默认场景', 'Default scene')}</strong></div>
                <div><span>{t('目标', 'Target')}</span><strong>{selected.target_name || selected.display_name}</strong></div>
                <div><span>{t('向量数量', 'Vectors')}</span><strong>{selected.count.toLocaleString()}</strong></div>
                <div><span>{t('向量维度', 'Dimensions')}</span><strong>{selected.dim}</strong></div>
                <div><span>{t('特征模型', 'Embedder')}</span><strong title={selected.embedder}>{selected.embedder}</strong></div>
                <div><span>{t('特征配置', 'Feature Profile')}</span><strong title={selected.profile_id}>{selected.profile_id}</strong></div>
                <div><span>{t('物理版本', 'Physical version')}</span><strong>v{selected.version} · {selected.active ? t('当前', 'active') : t('历史', 'inactive')}</strong></div>
                <div><span>{t('向量索引', 'Vector index')}</span><strong>{selected.index_type}</strong></div>
                <div><span>{t('最近入库', 'Last ingest')}</span><strong>{formatDate(selected.last_ingest_at)}</strong></div>
                <div><span>{t('向量范数', 'Vector norm')}</span><strong>{formatVectorNorm(selected)}</strong></div>
                <div><span>{t('异常统计', 'Anomalies')}</span><strong>
                    {selected.quality.invalid_vectors || 0} {t('无效向量', 'invalid vectors')} ·{' '}
                    {selected.quality.failed_images || 0} {t('失败图片', 'failed images')}
                </strong></div>
            </div>
            {renderProfileWarning(selected)}
            {renderDeleteConfirmation()}
            <div className='WorkspaceTabs' role='tablist' aria-label={t('版本操作', 'Version actions')}>
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
                    aria-selected={activeTab === 'history'}
                    className={activeTab === 'history' ? 'active' : ''}
                    onClick={() => setActiveTab('history')}
                >{t('入库记录', 'Ingest history')}</button>
            </div>
            {renderActiveWorkspace()}
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
                        {(job.inserted_vectors ?? job.inserted_objects).toLocaleString()} {t('个向量', 'vectors')}
                        {job.skipped_images > 0 && ` · ${job.skipped_images} ${t('跳过', 'skipped')}`}
                        {job.failed_images > 0 && ` · ${job.failed_images} ${t('失败', 'failed')}`}
                        {job.throughput_images_per_sec > 0 && ` · ${job.throughput_images_per_sec.toFixed(1)} img/s`}
                        {job.eta_seconds != null && job.eta_seconds > 0 && ` · ETA ${Math.ceil(job.eta_seconds)}s`}
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
                : job.resumable
                    ? <button type='button' className='SecondaryButton' onClick={resumeIngest}>{t('继续任务', 'Resume job')}</button>
                    : <button type='button' className='SecondaryButton' onClick={() => setJob(null)}>{t('隐藏', 'Dismiss')}</button>}
        </div>;
    };

    const renderContent = () => (
        <div className='VectorDbPopupContent'>
            <div className='VectorDbIntro'>
                <div>
                    <span className='Eyebrow'>{t('拓展服务', 'Extension service')}</span>
                    <p>{t('按场景、目标和版本管理 DINO 向量，导入业务数据，并追踪每一次入库任务与质量结果。检索功能统一放在「视觉检索」。',
                        'Manage DINO vectors by scene, target and version, ingest business data, and track every ingest run and quality result. Retrieval is unified under Visual Retrieval.')}</p>
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
                <div><span>{t('场景', 'Scenes')}</span><strong>{hierarchy.length}</strong></div>
                <div><span>{t('目标', 'Targets')}</span><strong>{totalTargets}</strong></div>
                <div><span>{t('向量总数', 'Total vectors')}</span><strong>{totalVectors.toLocaleString()}</strong></div>
                <div><span>{t('活动任务', 'Active jobs')}</span><strong>{activeJobsCount}</strong></div>
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
