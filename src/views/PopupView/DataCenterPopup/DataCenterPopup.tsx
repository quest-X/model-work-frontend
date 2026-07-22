import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {connect} from 'react-redux';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {QueueActions} from '../../../logic/actions/QueueActions';
import {ImageRepository} from '../../../logic/imageRepository/ImageRepository';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {updateActivePopupType} from '../../../store/general/actionCreators';
import {updateQueueItem} from '../../../store/queue/actionCreators';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {ImageData, LabelName} from '../../../store/labels/types';
import {QueueDataSyncStatus, QueueItem, QueueItemType} from '../../../store/queue/types';
import {getEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import {DataBatchSyncService} from '../../../services/DataBatchSyncService';
import {TrainingDatasetSelection} from '../../../services/TrainingDatasetSelection';
import {
    DatasetActionTarget,
    DatasetEditSelection,
    DatasetExportSelection,
    DatasetInferenceSelection,
} from '../../../services/DatasetActionSelection';
import {PendingImportFiles} from '../../../utils/PendingImportFiles';
import './DataCenterPopup.scss';

interface DatasetVersionSummary {
    revision: number;
    operation_type: string;
    operation_name?: string | null;
    created_at: string;
    parent_revision?: number | null;
    image_count: number;
    annotated_count?: number | null;
}

interface DatasetSummary {
    id: string;
    name: string;
    project_name?: string | null;
    created_at: string;
    image_count: number;
    classes: string[];
    format: string;
    source_type?: string;
    source_id?: string | null;
    revision?: number;
    status?: string;
    updated_at?: string | null;
    storage_version?: number;
    unique_asset_count?: number | null;
    logical_bytes?: number | null;
    deduplicated_bytes?: number;
    last_task_at?: string | null;
    last_task_type?: string | null;
    versions?: DatasetVersionSummary[];
}

interface DatasetStats {
    image_count: number;
    class_distribution: Record<string, number>;
    annotated_count: number;
    annotation_coverage: number;
}

type DataTier = 'temporary' | 'persistent';

const TIER_BY_NAVIGATION_KEY: Partial<Record<string, DataTier>> = {
    ArrowDown: 'persistent',
    End: 'persistent',
    ArrowUp: 'temporary',
    Home: 'temporary',
};

interface IProps {
    language: Language;
    projectName: string;
    queueItems: QueueItem[];
    activeQueueItemId: string | null;
    imagesData: ImageData[];
    labels: LabelName[];
    updateActivePopupTypeAction: (activePopupType: PopupWindowType) => void;
    updateQueueItemAction: (itemId: string, updates: Partial<QueueItem>) => void;
}

const itemCount = (item: QueueItem): number => {
    if (item.type === QueueItemType.FOLDER) return item.files?.length || 0;
    if (item.type === QueueItemType.VIDEO) {
        return item.extractionMetadata?.totalFrames || item.extractedFrames?.length || 0;
    }
    return item.file ? 1 : 0;
};

const getDatasetStatus = (dataset: DatasetSummary, zh: boolean): {className: string; label: string} => {
    const status = (dataset.status || 'ready').toLowerCase();
    const statusLabels: Record<string, string> = {
        ready: zh ? '已就绪' : 'Ready',
        syncing: zh ? '同步中' : 'Syncing',
        processing: zh ? '处理中' : 'Processing',
        error: zh ? '异常' : 'Error',
    };
    return {className: status, label: statusLabels[status] || dataset.status || status};
};

const formatDatasetTime = (value: string | null | undefined, zh: boolean): string => {
    if (!value) return zh ? '暂无记录' : 'No record';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);
};

const versionOperationLabel = (version: DatasetVersionSummary, zh: boolean): string => {
    if (version.operation_name) return version.operation_name;
    const labels: Record<string, [string, string]> = {
        raw: ['原始数据', 'Raw data'],
        annotation_edit: ['标注编辑', 'Annotation edit'],
        cleaning: ['数据清洗', 'Data cleaning'],
        augmentation: ['数据增强', 'Data augmentation'],
        legacy_update: ['历史更新', 'Legacy update'],
    };
    const label = labels[version.operation_type] || [version.operation_type, version.operation_type];
    return zh ? label[0] : label[1];
};

const taskTypeLabel = (taskType: string | null | undefined, zh: boolean): string => {
    const labels: Record<string, [string, string]> = {
        training: ['训练', 'Training'],
        inference: ['推理', 'Inference'],
        cleaning: ['清洗', 'Cleaning'],
        augmentation: ['增强', 'Augmentation'],
    };
    const label = taskType ? labels[taskType] : undefined;
    if (!label) return '';
    return zh ? label[0] : label[1];
};

export const DataCenterPopup: React.FC<IProps> = ({
    language,
    projectName,
    queueItems,
    activeQueueItemId,
    imagesData,
    labels,
    updateActivePopupTypeAction,
    updateQueueItemAction,
}) => {
    const zh = language === Language.CHINESE;
    const baseUrl = getEngineBaseUrl();

    const [activeTier, setActiveTier] = useState<DataTier>('temporary');
    const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
    const [datasetsLoading, setDatasetsLoading] = useState(true);
    const [datasetsError, setDatasetsError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [stats, setStats] = useState<DatasetStats | null>(null);
    const [statsLoading, setStatsLoading] = useState(false);
    const [statsError, setStatsError] = useState<string | null>(null);
    const [datasetActionId, setDatasetActionId] = useState<string | null>(null);
    const [datasetActionError, setDatasetActionError] = useState<string | null>(null);

    const selectTier = (tier: DataTier) => {
        setActiveTier(tier);
        document.getElementById(`data-tier-${tier}`)?.focus();
    };

    const handleTierKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        const nextTier = TIER_BY_NAVIGATION_KEY[event.key];
        if (!nextTier) return;
        event.preventDefault();
        selectTier(nextTier);
    };

    const queueItemById = useMemo(
        () => new Map(queueItems.map(item => [item.id, item])),
        [queueItems],
    );
    const temporaryItems = useMemo(
        () => queueItems.filter(item => item.dataSyncStatus !== QueueDataSyncStatus.SYNCED),
        [queueItems],
    );

    const refreshDatasets = useCallback(() => {
        setDatasetsLoading(true);
        setDatasetsError(null);
        fetch(`${baseUrl}/datasets`).then(async response => {
            if (!response.ok) throw new Error(`${response.status}`);
            return response.json();
        }).then(data => {
            const nextDatasets = Array.isArray(data.datasets) ? data.datasets : [];
            setDatasets(nextDatasets);
            setSelectedId(current => current && nextDatasets.some((dataset: DatasetSummary) => dataset.id === current)
                ? current
                : null);
        }).catch(() => {
            setDatasetsError(zh ? '无法读取服务器数据集' : 'Unable to load server datasets');
        }).finally(() => setDatasetsLoading(false));
    }, [baseUrl, zh]);

    useEffect(() => {
        refreshDatasets();
        window.addEventListener('opensight:data-center-updated', refreshDatasets);
        return () => window.removeEventListener('opensight:data-center-updated', refreshDatasets);
    }, [refreshDatasets]);

    useEffect(() => {
        const controller = new AbortController();
        setStats(null);
        setStatsError(null);
        if (!selectedId) {
            setStatsLoading(false);
            return undefined;
        }
        setStatsLoading(true);
        fetch(`${baseUrl}/datasets/${selectedId}/stats`, {signal: controller.signal})
            .then(async response => {
                if (!response.ok) throw new Error(`${response.status}`);
                return response.json();
            })
            .then(value => {
                if (!controller.signal.aborted) setStats(value);
            })
            .catch(cause => {
                if (cause instanceof Error && cause.name === 'AbortError') return;
                if (!controller.signal.aborted) {
                    setStatsError(zh ? '数据统计加载失败' : 'Failed to load dataset statistics');
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setStatsLoading(false);
            });
        return () => controller.abort();
    }, [selectedId, baseUrl, zh]);

    const datasetDisplayName = (dataset: DatasetSummary): string => {
        const localSource = dataset.source_id ? queueItemById.get(dataset.source_id) : null;
        const inferredLegacyProject = !dataset.project_name && localSource ? projectName.trim() : '';
        return inferredLegacyProject || dataset.name;
    };

    const syncStatus = (item: QueueItem): {className: string; label: string} => {
        const status = item.dataSyncStatus || QueueDataSyncStatus.LOCAL;
        const labelsByStatus: Record<QueueDataSyncStatus, string> = {
            [QueueDataSyncStatus.LOCAL]: zh ? '仅本地' : 'Local only',
            [QueueDataSyncStatus.SYNCING]: zh ? '正在同步' : 'Syncing',
            [QueueDataSyncStatus.SYNCED]: `${zh ? '服务器快照' : 'Server snapshot'} · v${item.datasetRevision || 1}`,
            [QueueDataSyncStatus.DIRTY]: zh ? '有本地修改' : 'Local changes',
            [QueueDataSyncStatus.ERROR]: zh ? '同步失败' : 'Sync failed',
        };
        return {className: status.toLowerCase(), label: labelsByStatus[status]};
    };

    const openLocalItem = (item: QueueItem) => {
        if (item.id === activeQueueItemId) {
            PopupActions.close();
            return;
        }
        void QueueActions.switchToQueueItem(item, imagesData).then(() => PopupActions.close());
    };

    const syncLocalItem = (item: QueueItem) => {
        const cachedAnnotations = item.id === activeQueueItemId
            ? imagesData
            : ImageRepository.getFileCacheSnapshot(item.id);
        if (!cachedAnnotations) return;
        const annotations = cachedAnnotations;
        void DataBatchSyncService.syncQueueItem(item, annotations, labels).catch(() => undefined);
    };

    const actionTarget = (dataset: DatasetSummary): DatasetActionTarget => ({
        id: dataset.id,
        name: datasetDisplayName(dataset),
        revision: dataset.revision || 1,
        imageCount: dataset.image_count,
        classCount: dataset.classes.length,
        sourceId: dataset.source_id,
    });

    const openDatasetForEditing = (dataset: DatasetSummary) => {
        setDatasetActionId(dataset.id);
        setDatasetActionError(null);
        fetch(`${baseUrl}/datasets/${dataset.id}/export`).then(async response => {
            if (!response.ok) throw new Error(`${response.status}`);
            const archive = await response.blob();
            const safeName = datasetDisplayName(dataset).replace(/[^A-Za-z0-9._-]+/g, '_') || dataset.id;
            DatasetEditSelection.set(actionTarget(dataset));
            PendingImportFiles.set([
                new File([archive], `yolo_full_${safeName}_v${dataset.revision || 1}.zip`, {
                    type: 'application/zip',
                }),
            ]);
            updateActivePopupTypeAction(PopupWindowType.IMPORT_ANNOTATIONS);
        }).catch(() => {
            DatasetEditSelection.set(null);
            setDatasetActionError(zh ? '无法打开服务器数据集' : 'Unable to open server dataset');
        }).finally(() => setDatasetActionId(null));
    };

    const openInferenceSettings = (datasetId: string) => {
        DatasetInferenceSelection.set(datasetId);
        updateActivePopupTypeAction(PopupWindowType.DATASET_INFERENCE);
    };

    const openTrainingSettings = (datasetId: string) => {
        TrainingDatasetSelection.set(datasetId);
        updateActivePopupTypeAction(PopupWindowType.TRAINING_TASK);
    };

    const openExportSettings = (dataset: DatasetSummary) => {
        DatasetExportSelection.set(actionTarget(dataset));
        updateActivePopupTypeAction(PopupWindowType.DATASET_EXPORT);
    };

    const deleteDataset = (dataset: DatasetSummary, event: React.MouseEvent) => {
        event.stopPropagation();
        const datasetName = datasetDisplayName(dataset);
        const prompt = zh
            ? `确定永久删除服务器数据集“${datasetName}”吗？此操作不可撤销。`
            : `Permanently delete server dataset “${datasetName}”? This cannot be undone.`;
        if (!window.confirm(prompt)) return;
        fetch(`${baseUrl}/datasets/${dataset.id}`, {method: 'DELETE'}).then(response => {
            if (!response.ok) throw new Error(`${response.status}`);
            if (selectedId === dataset.id) setSelectedId(null);
            const localSource = dataset.source_id ? queueItemById.get(dataset.source_id) : null;
            if (localSource) {
                updateQueueItemAction(localSource.id, {
                    dataSyncStatus: QueueDataSyncStatus.LOCAL,
                    datasetId: undefined,
                    datasetRevision: undefined,
                    syncedAt: undefined,
                });
            }
            refreshDatasets();
        }).catch(() => undefined);
    };

    const localItemUnit = (item: QueueItem): string => item.type === QueueItemType.VIDEO
        ? (zh ? '帧' : 'frames')
        : (zh ? '张图片' : 'images');

    const syncActionLabel = (item: QueueItem, hasReliableSnapshot: boolean): string => {
        if (item.dataSyncStatus === QueueDataSyncStatus.SYNCING) return zh ? '同步中…' : 'Syncing…';
        if (!hasReliableSnapshot) return zh ? '先打开后同步' : 'Open before syncing';
        if (item.datasetId) return zh ? '更新服务器' : 'Update server';
        return zh ? '同步到服务器' : 'Sync to server';
    };

    const renderLocalDataCard = (item: QueueItem) => {
        const status = syncStatus(item);
        const isActive = item.id === activeQueueItemId;
        const localProjectName = projectName.trim() || item.name;
        const supportsSync = item.type !== QueueItemType.VIDEO;
        const syncing = item.dataSyncStatus === QueueDataSyncStatus.SYNCING;
        const hasReliableSnapshot = isActive || ImageRepository.hasFileCache(item.id);
        return <article className={`LocalDataCard${isActive ? ' active' : ''}`} key={item.id}>
            <div className='DataCardIdentity'>
                <div className='DataCardTitleRow'>
                    <strong title={localProjectName}>{localProjectName}</strong>
                    {isActive && <span className='CurrentBadge'>{zh ? '当前打开' : 'Open'}</span>}
                </div>
                <span>{itemCount(item)} {localItemUnit(item)} · {zh ? '前端临时数据' : 'temporary frontend data'}</span>
                <span className={`SyncState ${status.className}`} aria-live='polite'>{status.label}</span>
                {item.dataSyncError && <span className='InlineError'>{item.dataSyncError}</span>}
            </div>
            <div className='DataCardActions'>
                <button type='button' onClick={() => openLocalItem(item)}>
                    {zh ? '查看 / 标注' : 'View / annotate'}
                </button>
                {supportsSync && <button
                    type='button'
                    className='PrimaryAction'
                    disabled={syncing || !hasReliableSnapshot}
                    onClick={() => syncLocalItem(item)}
                >{syncActionLabel(item, hasReliableSnapshot)}</button>}
                {!supportsSync && <span className='UnsupportedHint'>{zh ? '视频暂不支持持久化' : 'Video persistence is not supported yet'}</span>}
            </div>
        </article>;
    };

    const renderDatasetTimes = (dataset: DatasetSummary) => {
        const taskType = taskTypeLabel(dataset.last_task_type, zh);
        const taskTime = formatDatasetTime(dataset.last_task_at, zh);
        const taskValue = dataset.last_task_at && taskType ? `${taskType} · ${taskTime}` : taskTime;
        return <div className='DatasetTimeGrid' aria-label={zh ? '数据时间信息' : 'Dataset timestamps'}>
            <div className='DatasetTimeField'>
                <span>{zh ? '创建时间' : 'Created'}</span>
                <time dateTime={dataset.created_at}>{formatDatasetTime(dataset.created_at, zh)}</time>
            </div>
            <div className='DatasetTimeField'>
                <span>{zh ? '编辑时间' : 'Last edited'}</span>
                <time dateTime={dataset.updated_at || dataset.created_at}>
                    {formatDatasetTime(dataset.updated_at || dataset.created_at, zh)}
                </time>
            </div>
            <div className='DatasetTimeField'>
                <span>{zh ? '任务时间' : 'Last task'}</span>
                <time dateTime={dataset.last_task_at || undefined}>{taskValue}</time>
            </div>
        </div>;
    };

    const renderVersionTimeline = (dataset: DatasetSummary) => {
        const versions = dataset.versions?.length
            ? [...dataset.versions].sort((left, right) => left.revision - right.revision)
            : [{
                revision: dataset.revision || 1,
                operation_type: 'raw',
                created_at: dataset.created_at,
                image_count: dataset.image_count,
            }];
        return <div className='VersionHistorySection'>
            <div className='SectionHeader'>{zh ? '数据版本' : 'Data versions'}</div>
            <ol className='VersionTimeline' aria-label={zh ? '数据版本时间轴' : 'Dataset version timeline'}>
                {versions.map(version => (
                    <li
                        className={`VersionCommit${version.revision === (dataset.revision || 1) ? ' current' : ''}`}
                        key={version.revision}
                    >
                        <div className='VersionCommitHeader'>
                            <strong>{versionOperationLabel(version, zh)}</strong>
                            <span>v{version.revision}</span>
                        </div>
                        <time dateTime={version.created_at}>{formatDatasetTime(version.created_at, zh)}</time>
                        <small>{version.image_count} {zh ? '张图片' : 'images'}</small>
                    </li>
                ))}
            </ol>
        </div>;
    };

    // The expanded card intentionally composes the independent timeline, stats and task states.
    // eslint-disable-next-line complexity
    const renderDatasetDetails = (dataset: DatasetSummary, detailsId: string) => (
        <div className='DatasetDetails' id={detailsId}>
            {renderDatasetTimes(dataset)}
            {renderVersionTimeline(dataset)}
            {statsLoading && <div className='StatsState'>{zh ? '正在加载数据统计…' : 'Loading dataset statistics…'}</div>}
            {statsError && <div className='StatsState error'>{statsError}</div>}
            {stats && <div className='StatsPanel'>
                <div className='StatsRow'><span>{zh ? '标注覆盖率' : 'Annotation coverage'}</span><span>{(stats.annotation_coverage * 100).toFixed(0)}%</span></div>
                <div className='StatsRow'><span>{zh ? '已标注' : 'Annotated'}</span><span>{stats.annotated_count} / {stats.image_count}</span></div>
                {Object.entries(stats.class_distribution).map(([className, count]) => (
                    <div className='StatsRow' key={className}><span>{className}</span><span>{count}</span></div>
                ))}
            </div>}
            <div className='TaskLinksSection'>
                <div className='SectionHeader'>{zh ? '下游任务' : 'Downstream tasks'}</div>
                <div className='TaskLinks'>
                    <button
                        type='button'
                        className='TaskLink'
                        disabled={datasetActionId === dataset.id}
                        onClick={() => openDatasetForEditing(dataset)}
                    >
                        {datasetActionId === dataset.id ? (zh ? '正在打开…' : 'Opening…') : (zh ? '编辑' : 'Edit')}
                    </button>
                    <button type='button' className='TaskLink' onClick={() => openInferenceSettings(dataset.id)}>
                        {zh ? '推理' : 'Inference'}
                    </button>
                    <button type='button' className='TaskLink' onClick={() => openTrainingSettings(dataset.id)}>
                        {zh ? '训练' : 'Training'}
                    </button>
                    <button type='button' className='TaskLink' onClick={() => openExportSettings(dataset)}>
                        {zh ? '导出' : 'Export'}
                    </button>
                </div>
                {datasetActionError && <p className='TaskActionError'>{datasetActionError}</p>}
                <p className='TaskCapabilityHint'>
                    {zh
                        ? '编辑会创建可继续标注的前端工作副本；推理完成后生成新版本；训练引用当前快照；导出先确认再生成压缩包。'
                        : 'Edit creates a frontend working copy; inference creates a new revision; training references this snapshot; export confirms before building an archive.'}
                </p>
            </div>
        </div>
    );

    const datasetSourceLabel = (dataset: DatasetSummary, hasLocalSource: boolean): string => {
        const linkedProject = dataset.project_name || (hasLocalSource ? projectName.trim() : '');
        const projectLabel = linkedProject
            ? `${zh ? '项目' : 'Project'} ${linkedProject}`
            : (zh ? '未关联项目' : 'Unassigned project');
        const serverLabel = zh ? '服务器数据集' : 'Server dataset';
        const localCopyLabel = hasLocalSource
            ? ` · ${zh ? '关联本地工作副本' : 'linked local copy'}`
            : '';
        return `${projectLabel} · ${serverLabel} · v${dataset.revision || 1} · ${dataset.id.slice(0, 8)}${localCopyLabel}`;
    };

    const renderDatasetItem = (dataset: DatasetSummary) => {
        const expanded = selectedId === dataset.id;
        const datasetName = datasetDisplayName(dataset);
        const status = getDatasetStatus(dataset, zh);
        const detailsId = `dataset-details-${dataset.id}`;
        const localSource = dataset.source_id ? queueItemById.get(dataset.source_id) : null;
        const sourceLabel = datasetSourceLabel(dataset, !!localSource);
        return <article key={dataset.id} className={`DatasetItem${expanded ? ' selected' : ''}`}>
            <div className='DatasetRow'>
                <button
                    type='button'
                    className='DatasetToggle'
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    onClick={() => setSelectedId(expanded ? null : dataset.id)}
                >
                    <span className='DatasetRowMain'>
                        <span className='DatasetTitleRow'>
                            <span className='DatasetName'>{datasetName}</span>
                            <span className={`DatasetState ${status.className}`} aria-live='polite'>{status.label}</span>
                        </span>
                        <span className='DatasetMeta'>{dataset.image_count} {zh ? '张图片' : 'images'} · {dataset.classes.length} {zh ? '类' : 'classes'}</span>
                        <span className='DatasetSource'>{sourceLabel}</span>
                    </span>
                    <span className={`DatasetChevron${expanded ? ' expanded' : ''}`} aria-hidden='true'>⌄</span>
                </button>
                <button
                    type='button'
                    className='DeleteButton'
                    aria-label={`${zh ? '删除' : 'Delete'} ${datasetName}`}
                    onClick={(event) => deleteDataset(dataset, event)}
                >×</button>
            </div>
            {expanded && renderDatasetDetails(dataset, detailsId)}
        </article>;
    };

    const renderTemporaryData = () => <section className='DataTierPanel' aria-label={zh ? '临时数据' : 'Temporary data'}>
        <div className='TierExplanation'>
            <div>
                <strong>{zh ? '前端临时数据' : 'Temporary frontend data'}</strong>
                <span>{zh ? '查看当前浏览器中的工作副本、标注状态与服务器同步状态。' : 'Inspect browser work copies, annotation state, and server sync status.'}</span>
            </div>
        </div>
        <div className='LocalDataList'>
            {temporaryItems.length === 0 && <div className='EmptyState'>
                <strong>{zh ? '暂无临时数据' : 'No temporary data'}</strong>
                <span>{zh ? '从“操作 → 上传文件”加入图片或数据批次。' : 'Add images or a batch from Actions → Upload files.'}</span>
            </div>}
            {temporaryItems.map(renderLocalDataCard)}
        </div>
    </section>;

    const renderPersistentData = () => <section className='DataTierPanel' aria-label={zh ? '持久化数据' : 'Persistent data'}>
        <div className='TierExplanation persistent'>
            <div>
                <strong>{zh ? '后端持久化数据' : 'Persistent backend data'}</strong>
                <span>{zh ? '查看核心引擎已有的数据快照、运行状态与下游任务入口。' : 'Inspect core-engine snapshots, runtime state, and downstream task entry points.'}</span>
            </div>
            <button type='button' onClick={refreshDatasets} disabled={datasetsLoading}>
                {datasetsLoading ? (zh ? '刷新中…' : 'Refreshing…') : (zh ? '刷新' : 'Refresh')}
            </button>
        </div>
        {datasetsError && <div className='EmptyState error'>
            <strong>{datasetsError}</strong>
            <span>{zh ? '请确认核心引擎的数据服务可用。' : 'Check that the core-engine data service is available.'}</span>
        </div>}
        {!datasetsError && !datasetsLoading && datasets.length === 0 && <div className='EmptyState'>
            <strong>{zh ? '暂无持久化数据' : 'No persistent data'}</strong>
            <span>{zh ? '在“临时数据”中选择一个批次并同步到服务器。' : 'Choose a temporary batch and sync it to the server.'}</span>
        </div>}
        <div className='DatasetList'>
            {datasets.map(renderDatasetItem)}
        </div>
    </section>;

    const renderTierSidebar = () => <aside className='DataTierSidebar'>
        <div className='DataTierNavTitle'>{zh ? '数据来源' : 'Data source'}</div>
        <div
            className='DataTierTabs'
            role='tablist'
            aria-label={zh ? '数据存储层级' : 'Data storage tier'}
            aria-orientation='vertical'
        >
            <button
                id='data-tier-temporary'
                type='button'
                role='tab'
                aria-label={`${zh ? '临时数据' : 'Temporary data'} ${temporaryItems.length}`}
                aria-controls='data-tier-panel'
                aria-selected={activeTier === 'temporary'}
                tabIndex={activeTier === 'temporary' ? 0 : -1}
                className={activeTier === 'temporary' ? 'active temporary' : ''}
                onClick={() => setActiveTier('temporary')}
                onKeyDown={handleTierKeyDown}
            >
                <span className='DataTierTabCopy'>
                    <span>{zh ? '临时数据' : 'Temporary data'}</span>
                    <small>{zh ? '当前前端' : 'Frontend'}</small>
                </span>
                <strong>{temporaryItems.length}</strong>
            </button>
            <button
                id='data-tier-persistent'
                type='button'
                role='tab'
                aria-label={`${zh ? '持久化数据' : 'Persistent data'} ${datasets.length}`}
                aria-controls='data-tier-panel'
                aria-selected={activeTier === 'persistent'}
                tabIndex={activeTier === 'persistent' ? 0 : -1}
                className={activeTier === 'persistent' ? 'active persistent' : ''}
                onClick={() => setActiveTier('persistent')}
                onKeyDown={handleTierKeyDown}
            >
                <span className='DataTierTabCopy'>
                    <span>{zh ? '持久化数据' : 'Persistent data'}</span>
                    <small>{zh ? '核心后端' : 'Backend'}</small>
                </span>
                <strong>{datasets.length}</strong>
            </button>
        </div>
        <p className='DataTierSidebarHint'>
            {zh ? '选择左侧来源，在右侧检查各批次状态。' : 'Choose a source to inspect batch status on the right.'}
        </p>
    </aside>;

    const renderContent = () => (
        <div className='DataCenterPopupContent'>
            <div className='DataWorkspace'>
                {renderTierSidebar()}
                <div
                    id='data-tier-panel'
                    className='DataTierMain'
                    role='tabpanel'
                    aria-labelledby={`data-tier-${activeTier}`}
                >
                    {activeTier === 'temporary' ? renderTemporaryData() : renderPersistentData()}
                </div>
            </div>
        </div>
    );

    return (
        <GenericYesNoPopup
            title={zh ? '数据管理' : 'Data Management'}
            renderContent={renderContent}
            skipAcceptButton
            rejectLabel={zh ? '关闭' : 'Close'}
            onReject={() => PopupActions.close()}
        />
    );
};

const mapDispatchToProps = {
    updateActivePopupTypeAction: updateActivePopupType,
    updateQueueItemAction: updateQueueItem,
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
    projectName: state.general.projectData.name,
    queueItems: state.queue.items,
    activeQueueItemId: state.queue.activeQueueItemId,
    imagesData: state.labels.imagesData,
    labels: state.labels.labels,
});

export default connect(mapStateToProps, mapDispatchToProps)(DataCenterPopup);
