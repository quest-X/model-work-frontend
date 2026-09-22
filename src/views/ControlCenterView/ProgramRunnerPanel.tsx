import React, {useEffect, useState} from 'react';
import {Language} from '../../data/LanguageConfig';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeProgramSnapshot,
    ComputeRuntimeEvent,
    ComputeRuntimeService,
    ComputeRuntimeSnapshot,
} from '../../services/ComputeClusterService';
import CameraTimeline from '../EditorView/CameraTimeline/CameraTimeline';
import '../EditorView/CameraPlayer/CameraPlayer.scss';

type ProgramRunnerView = 'programs' | 'preview' | 'endpoints' | 'artifacts' | 'telegrams' | 'logs';
type ProgramTone = 'healthy' | 'warning' | 'offline';
type ResultCategory = 'all' | 'video' | 'image' | 'data' | 'telegram' | 'log';

interface IProps {
    node: ComputeClusterNode;
    zh: boolean;
    maximized: boolean;
    onToggleMaximized: () => void;
}

interface ProgramRunnerCache {
    snapshot: ComputeRuntimeSnapshot | null;
    programs: ComputeProgramSnapshot | null;
    events: ComputeRuntimeEvent[];
}

const programRunnerCache = new Map<string, ProgramRunnerCache>();

const runtimeTone = (state: ComputeRuntimeService['state']): ProgramTone =>
    state === 'healthy' ? 'healthy' : state === 'unavailable' ? 'offline' : 'warning';

const runtimeStateLabel = (state: ComputeRuntimeService['state'], zh: boolean): string => ({
    healthy: zh ? '正常' : 'Healthy',
    degraded: zh ? '降级' : 'Degraded',
    unavailable: zh ? '不可用' : 'Unavailable',
    unknown: zh ? '未知' : 'Unknown',
})[state];

const interfaceTone = (
    state: ComputeProgramSnapshot['programs'][number]['interfaces'][number]['state'],
): ProgramTone => state === 'healthy' ? 'healthy' : state === 'unavailable' ? 'offline' : 'warning';

const interfaceStateLabel = (
    state: ComputeProgramSnapshot['programs'][number]['interfaces'][number]['state'],
    zh: boolean,
): string => ({
    healthy: zh ? '正常' : 'Healthy',
    unavailable: zh ? '不可用' : 'Unavailable',
    not_checked: zh ? '未检查' : 'Not checked',
})[state];

const programName = (service: ComputeRuntimeService, zh: boolean): string => {
    if (!zh) return service.name;
    if (service.service_id === 'node-service') return '节点服务';
    if (service.service_id === 'task-executor') return '任务执行器';
    return service.name;
};

const programKind = (service: ComputeRuntimeService, zh: boolean): string =>
    service.kind === 'worker'
        ? (zh ? '工作进程' : 'Worker')
        : (zh ? '常驻服务' : 'Service');

const dateTime = (timestamp: number, zh: boolean): string => timestamp
    ? new Date(timestamp * 1000).toLocaleString(zh ? 'zh-CN' : 'en-US')
    : (zh ? '未知' : 'Unknown');

const duration = (seconds: number | null, zh: boolean): string => {
    if (seconds === null) return zh ? '未上报' : 'Not reported';
    if (seconds < 60) return zh ? `${Math.round(seconds)} 秒` : `${Math.round(seconds)}s`;
    if (seconds < 3600) return zh
        ? `${Math.floor(seconds / 60)} 分钟`
        : `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return zh
        ? `${Math.floor(seconds / 3600)} 小时`
        : `${Math.floor(seconds / 3600)}h`;
    return zh
        ? `${Math.floor(seconds / 86400)} 天`
        : `${Math.floor(seconds / 86400)}d`;
};

const bytes = (value: number): string => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = Math.max(0, value);
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
    }
    return `${size >= 100 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
};

type ProgramArtifact = ComputeProgramSnapshot['programs'][number]['artifacts'][number];

const artifactCategory = (artifact: ProgramArtifact): Exclude<ResultCategory, 'all'> => {
    if (artifact.kind === 'video') return 'video';
    if (artifact.kind === 'image') return 'image';
    if (artifact.name.toLowerCase() === 'ixcom.jsonl') return 'telegram';
    if (artifact.name.toLowerCase().endsWith('.jsonl')) return 'log';
    return 'data';
};

const artifactCategoryLabel = (category: ResultCategory, zh: boolean): string => ({
    all: zh ? '全部' : 'All',
    video: zh ? '视频' : 'Videos',
    image: zh ? '图片' : 'Images',
    data: zh ? '数据' : 'Data',
    telegram: zh ? '电文' : 'Telegrams',
    log: zh ? '日志' : 'Logs',
}[category]);

const localDateKey = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
};
const todayDateKey = (): string => localDateKey(Date.now() / 1000);

const RESULT_PREVIEW_BYTES = 256 * 1024;

const formatResultPreview = (contentType: string, value: string, truncated: boolean): string => {
    if (!truncated && contentType.startsWith('application/json')) {
        try {
            return JSON.stringify(JSON.parse(value), null, 2);
        } catch {
            return value;
        }
    }
    return value;
};

const isTelegramLog = (message: string): boolean => {
    try {
        return JSON.parse(message)?.src === 'ixcom';
    } catch {
        return false;
    }
};

const bufferedPercent = (media: HTMLMediaElement): number => {
    if (!Number.isFinite(media.duration) || media.duration <= 0) return 0;
    let bufferedSeconds = 0;
    for (let index = 0; index < media.buffered.length; index += 1) {
        bufferedSeconds += Math.max(0, media.buffered.end(index) - media.buffered.start(index));
    }
    return Math.min(100, Math.floor(bufferedSeconds / media.duration * 100));
};

const taskStateLabel = (state: string, zh: boolean): string => ({
    queued: zh ? '排队' : 'Queued',
    running: zh ? '运行中' : 'Running',
    paused: zh ? '已暂停' : 'Paused',
    succeeded: zh ? '成功' : 'Succeeded',
    failed: zh ? '失败' : 'Failed',
    cancelled: zh ? '已取消' : 'Cancelled',
})[state] || state;

// The four views share one polling boundary so closing the runner cancels every request together.
// eslint-disable-next-line complexity
export const ProgramRunnerPanel: React.FC<IProps> = ({
    node,
    zh,
    maximized,
    onToggleMaximized,
}) => {
    const cached = programRunnerCache.get(node.node_id);
    const [view, setView] = useState<ProgramRunnerView>('programs');
    const [snapshot, setSnapshot] = useState<ComputeRuntimeSnapshot | null>(cached?.snapshot || null);
    const [programs, setPrograms] = useState<ComputeProgramSnapshot | null>(cached?.programs || null);
    const [events, setEvents] = useState<ComputeRuntimeEvent[]>(cached?.events || []);
    const [runtimeError, setRuntimeError] = useState('');
    const [programsError, setProgramsError] = useState('');
    const [eventsError, setEventsError] = useState('');
    const [selectedServiceId, setSelectedServiceId] = useState('');
    const [logServiceId, setLogServiceId] = useState('');
    const [prettyTelegramLogs, setPrettyTelegramLogs] = useState(true);
    const [selectedArtifactId, setSelectedArtifactId] = useState('');
    const [artifactDate, setArtifactDate] = useState(todayDateKey);
    const [artifactCategoryFilter, setArtifactCategoryFilter] = useState<ResultCategory>('all');
    const [artifactQuery, setArtifactQuery] = useState('');
    const [loadedVideoId, setLoadedVideoId] = useState('');
    const [readyVideoId, setReadyVideoId] = useState('');
    const [videoPreviewProgress, setVideoPreviewProgress] = useState(0);
    const [videoPreviewError, setVideoPreviewError] = useState('');
    const [loadedImageId, setLoadedImageId] = useState('');
    const [imagePreviewError, setImagePreviewError] = useState('');
    const [resultPreview, setResultPreview] = useState('');
    const [resultPreviewError, setResultPreviewError] = useState('');
    const [resultPreviewLoading, setResultPreviewLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshProgress, setRefreshProgress] = useState(0);
    const [previewNonce, setPreviewNonce] = useState(Date.now());
    const [previewState, setPreviewState] = useState<'loading' | 'playing' | 'error'>('loading');
    const [previewNow, setPreviewNow] = useState(() => new Date());
    const runtimeCapable = node.online && node.capabilities.includes('runtime.read.v1');
    const programsCapable = node.online && node.capabilities.includes('runtime.programs.read.v1');
    const runtimeVisible = runtimeCapable || snapshot !== null;
    const programsVisible = programsCapable || programs !== null;
    const logsVisible = runtimeVisible || programsVisible || events.length > 0;
    const showingCache = !node.online && (snapshot !== null || programs !== null || events.length > 0);
    const pollingPaused = view === 'artifacts' && programs !== null;
    const eventsRequested = view === 'telegrams' || view === 'logs';
    const connectionLabel = node.online
        ? pollingPaused
            ? (zh ? '在线 · 结果预览期间暂停状态刷新' : 'Online · status refresh paused during result preview')
            : (zh ? '在线 · 程序状态每 5 秒刷新' : 'Online · program status refreshes every 5 seconds')
        : showingCache
            ? (zh ? '离线 · 显示最后缓存' : 'Offline · showing last cached data')
            : (zh ? '离线' : 'Offline');

    useEffect(() => {
        const next = programRunnerCache.get(node.node_id);
        setView('programs');
        setSnapshot(next?.snapshot || null);
        setPrograms(next?.programs || null);
        setEvents(next?.events || []);
        setRuntimeError('');
        setProgramsError('');
        setEventsError('');
        setSelectedServiceId('');
        setLogServiceId('');
        setPrettyTelegramLogs(true);
        setSelectedArtifactId('');
        setArtifactDate(todayDateKey());
        setArtifactCategoryFilter('all');
        setArtifactQuery('');
        setLoadedVideoId('');
        setReadyVideoId('');
        setVideoPreviewProgress(0);
        setVideoPreviewError('');
        setLoadedImageId('');
        setImagePreviewError('');
        setResultPreview('');
        setResultPreviewError('');
        setResultPreviewLoading(false);
        setRefreshProgress(0);
        setPreviewState('loading');
        setPreviewNonce(Date.now());
    }, [node.node_id]);

    useEffect(() => {
        if (pollingPaused || !runtimeCapable && !programsCapable) return undefined;
        const controller = new AbortController();
        let inFlight = false;
        // eslint-disable-next-line complexity
        const load = async () => {
            if (inFlight) return;
            inFlight = true;
            setRefreshing(true);
            setRefreshProgress(0);
            const requestCount = Number(runtimeCapable)
                + Number(programsCapable)
                + Number(runtimeCapable && eventsRequested);
            let completedRequests = 0;
            const track = <T,>(request: Promise<T>): Promise<T> => request.finally(() => {
                completedRequests += 1;
                if (!controller.signal.aborted) {
                    setRefreshProgress(Math.round(completedRequests / requestCount * 100));
                }
            });
            const updateCache = (patch: Partial<ProgramRunnerCache>) => {
                const current = programRunnerCache.get(node.node_id);
                programRunnerCache.set(node.node_id, {
                    snapshot: current?.snapshot || null,
                    programs: current?.programs || null,
                    events: current?.events || [],
                    ...patch,
                });
            };
            const requests: Promise<void>[] = [];
            if (runtimeCapable) {
                requests.push(track(ComputeClusterService.runtime(node.node_id, controller.signal)).then(
                    value => {
                        if (controller.signal.aborted) return;
                        updateCache({snapshot: value});
                        setSnapshot(value);
                        setRuntimeError('');
                    },
                    reason => {
                        if (controller.signal.aborted) return;
                        setRuntimeError(reason instanceof Error ? reason.message : String(reason));
                    },
                ));
            }
            if (programsCapable) {
                requests.push(track(ComputeClusterService.programs(node.node_id, controller.signal)).then(
                    value => {
                        if (controller.signal.aborted) return;
                        updateCache({programs: value});
                        setPrograms(value);
                        setProgramsError('');
                    },
                    reason => {
                        if (controller.signal.aborted) return;
                        setProgramsError(reason instanceof Error ? reason.message : String(reason));
                    },
                ));
            }
            if (runtimeCapable && eventsRequested) {
                requests.push(track(ComputeClusterService.runtimeEvents(
                    node.node_id,
                    0,
                    100,
                    controller.signal,
                )).then(
                    value => {
                        if (controller.signal.aborted) return;
                        updateCache({events: value.events});
                        setEvents(value.events);
                        setEventsError('');
                    },
                    reason => {
                        if (controller.signal.aborted) return;
                        setEventsError(reason instanceof Error ? reason.message : String(reason));
                    },
                ));
            }
            await Promise.all(requests);
            if (!controller.signal.aborted) {
                if (!runtimeCapable) {
                    setRuntimeError('');
                }
                if (!programsCapable) {
                    setProgramsError('');
                }
                if (!eventsRequested) {
                    setEventsError('');
                }
                setRefreshing(false);
            }
            inFlight = false;
        };
        void load();
        const timer = window.setInterval(() => void load(), 5000);
        return () => {
            controller.abort();
            window.clearInterval(timer);
        };
    }, [eventsRequested, node.node_id, pollingPaused, programsCapable, runtimeCapable]);

    const selectedService = snapshot?.services.find(service =>
        service.service_id === selectedServiceId
    ) || snapshot?.services[0] || null;
    const serviceNames = new Map(
        (snapshot?.services || []).map(service => [service.service_id, programName(service, zh)]),
    );
    (programs?.programs || []).forEach(program =>
        serviceNames.set(program.program_id, program.name)
    );
    const endpointRows = (programs?.programs || []).flatMap(program =>
        program.interfaces.map(endpoint => ({
            ...endpoint,
            key: `${program.program_id}-${endpoint.method}-${endpoint.path}`,
            program_id: program.program_id,
            program_name: program.name,
        }))
    );
    const livePreview = endpointRows.find(endpoint =>
        endpoint.method === 'GET' && endpoint.path === '/stream.mjpeg'
    ) || endpointRows.find(endpoint =>
        endpoint.method === 'GET' && endpoint.path === '/rtsp'
    );
    const previewUrl = livePreview
        ? `${ComputeClusterService.programInterfaceStreamUrl(
            node.node_id,
            livePreview.program_id,
            livePreview.path,
        )}&v=${previewNonce}`
        : '';
    const reconnectPreview = () => {
        setPreviewState('loading');
        setPreviewNonce(previous => previous + 1);
    };

    useEffect(() => {
        if (view !== 'preview') return undefined;
        const updateNow = () => setPreviewNow(new Date());
        updateNow();
        const timer = window.setInterval(updateNow, 1000);
        return () => window.clearInterval(timer);
    }, [view]);
    const matchesLogFilter = (event: {service_id: string; message: string}): boolean =>
        view === 'telegrams'
            ? isTelegramLog(event.message)
            : !logServiceId || event.service_id === logServiceId;
    const filteredEvents = [...events]
        .filter(matchesLogFilter)
        .reverse();
    const programEvents = (programs?.programs || []).flatMap(program =>
        program.events.map(event => ({...event, service_id: program.program_id}))
    ).filter(matchesLogFilter)
        .sort((left, right) => right.created_at - left.created_at);
    const logRows = [
        ...filteredEvents.map(event => ({...event, key: `runtime-${event.cursor}`})),
        ...programEvents.map((event, index) => ({
            ...event,
            key: `program-${event.service_id}-${event.created_at}-${index}`,
            task_id: null,
        })),
    ].sort((left, right) => right.created_at - left.created_at);
    const programArtifacts = (programs?.programs || []).flatMap(program =>
        program.artifacts.map(artifact => ({
            ...artifact,
            selection_id: `${program.program_id}:${artifact.artifact_id}`,
            program_id: program.program_id,
            program_name: program.name,
        }))
    ).sort((left, right) => right.modified_at - left.modified_at);
    const filteredProgramArtifacts = programArtifacts.filter(artifact => {
        const matchesDate = !artifactDate || localDateKey(artifact.modified_at) === artifactDate;
        const category = artifactCategory(artifact);
        const matchesCategory = artifactCategoryFilter === 'all'
            || category === artifactCategoryFilter;
        const query = artifactQuery.trim().toLowerCase();
        const matchesQuery = !query
            || artifact.name.toLowerCase().includes(query)
            || artifact.relative_path.toLowerCase().includes(query)
            || artifact.program_name.toLowerCase().includes(query);
        return matchesDate && matchesCategory && matchesQuery;
    });
    const selectedArtifact = filteredProgramArtifacts.find(artifact =>
        artifact.selection_id === selectedArtifactId
    ) || filteredProgramArtifacts[0] || null;
    const artifactGroups = (['video', 'image', 'data', 'telegram', 'log'] as const).map(category => ({
        category,
        artifacts: filteredProgramArtifacts.filter(artifact => artifactCategory(artifact) === category),
    }));
    const selectedArtifactUrl = selectedArtifact
        ? ComputeClusterService.programArtifactUrl(
            node.node_id,
            selectedArtifact.program_id,
            selectedArtifact.artifact_id,
            selectedArtifact.modified_at,
        )
        : '';
    const resultPreviewTruncated = Boolean(
        selectedArtifact?.kind === 'data'
        && selectedArtifact.size_bytes > RESULT_PREVIEW_BYTES,
    );

    useEffect(() => {
        setLoadedVideoId('');
        setReadyVideoId('');
        setVideoPreviewProgress(0);
        setVideoPreviewError('');
        setLoadedImageId('');
        setImagePreviewError('');
    }, [selectedArtifact?.selection_id]);

    useEffect(() => {
        setResultPreview('');
        setResultPreviewError('');
        setResultPreviewLoading(false);
        if (!selectedArtifact || selectedArtifact.kind !== 'data' || !selectedArtifactUrl) {
            return undefined;
        }
        const controller = new AbortController();
        setResultPreviewLoading(true);
        void fetch(selectedArtifactUrl, {
            headers: {Range: `bytes=0-${RESULT_PREVIEW_BYTES - 1}`},
            signal: controller.signal,
        }).then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text();
        }).then(value => {
            if (!controller.signal.aborted) {
                setResultPreview(formatResultPreview(
                    selectedArtifact.content_type,
                    value,
                    resultPreviewTruncated,
                ));
                setResultPreviewLoading(false);
            }
        }).catch(error => {
            if (!controller.signal.aborted) {
                setResultPreviewError(error instanceof Error ? error.message : String(error));
                setResultPreviewLoading(false);
            }
        });
        return () => controller.abort();
    }, [
        resultPreviewTruncated,
        selectedArtifact?.content_type,
        selectedArtifact?.selection_id,
        selectedArtifactUrl,
    ]);

    const capturedAt = snapshot?.captured_at
        || programs?.captured_at
        || node.resources.captured_at;

    const unavailable = (title: string, detail = '') => <div className='ControlMonitorUnavailable'>
        <strong>{title}</strong>
        {detail && <span>{detail}</span>}
    </div>;

    return <section
        className={`ControlResourceMonitor ControlProgramRunner${maximized ? ' maximized' : ''}`}
        role='dialog'
        aria-modal='true'
        aria-label={zh ? `${node.name} 程序运行器` : `${node.name} program runner`}
    >
        <header>
            <div>
                <span>{zh ? '程序运行器' : 'Program Runner'}</span>
                <h2>{node.name}</h2>
                <p>
                    <span className='ControlProgramConnection' role='status' aria-label={connectionLabel}>
                        <span className={`ControlStatusDot ${node.online ? 'healthy' : 'offline'}`} aria-hidden='true'/>
                        {connectionLabel}
                    </span>
                    {' · '}{dateTime(capturedAt, zh)}
                </p>
            </div>
            <div className='ComputeClusterHeaderActions'>
                <button
                    type='button'
                    className={`window-toggle ${maximized ? 'restore' : 'maximize'}`}
                    aria-label={maximized
                        ? (zh ? '还原程序运行器窗口' : 'Restore program runner window')
                        : (zh ? '放大程序运行器窗口' : 'Maximize program runner window')}
                    aria-pressed={maximized}
                    onClick={onToggleMaximized}
                ><i aria-hidden='true'/></button>
            </div>
        </header>

        <div className='ControlMonitorWorkspace'>
            <nav className='ControlMonitorNav' aria-label={zh ? '程序运行器导航' : 'Program runner navigation'}>
                {([
                    ['programs', zh ? '程序' : 'Programs'],
                    ['preview', zh ? '预览' : 'Preview'],
                    ['endpoints', zh ? '接口' : 'APIs'],
                    ['artifacts', zh ? '结果' : 'Results'],
                    ['telegrams', zh ? '电文' : 'Telegrams'],
                    ['logs', zh ? '日志' : 'Logs'],
                ] as [ProgramRunnerView, string][]).map(([item, label]) => <button
                    type='button'
                    key={item}
                    aria-current={view === item ? 'page' : undefined}
                    onClick={() => setView(item)}
                >{label}</button>)}
            </nav>

            <div className='ControlMonitorContent'>
                {view === 'programs' && (!runtimeVisible
                    ? unavailable(
                        zh ? '当前节点尚不支持程序状态' : 'Program status is not supported',
                        node.online
                            ? (zh ? '升级节点程序后可查看程序、接口和日志。' : 'Upgrade the node software to view programs, APIs, and logs.')
                            : (zh ? '节点恢复在线后才能读取程序状态。' : 'The node must return online before program status can be read.'),
                    )
                    : snapshot?.services.length && selectedService
                        ? <div className='ControlProgramWorkspace'>
                            <aside className='ControlProgramList' aria-label={zh ? '程序列表' : 'Program list'}>
                                {snapshot.services.map(service => <button
                                    type='button'
                                    key={service.service_id}
                                    aria-current={selectedService.service_id === service.service_id ? 'page' : undefined}
                                    onClick={() => setSelectedServiceId(service.service_id)}
                                >
                                    <span className={`ControlStatusDot ${runtimeTone(service.state)}`} aria-hidden='true'/>
                                    <span>
                                        <strong>{programName(service, zh)}</strong>
                                        <small>{programKind(service, zh)} · {service.version || (zh ? '版本未知' : 'Unknown version')}</small>
                                    </span>
                                    <em>{runtimeStateLabel(service.state, zh)}</em>
                                </button>)}
                            </aside>
                            <section className='ControlProgramDetail' aria-label={zh ? '程序详情' : 'Program details'}>
                                <header>
                                    <div>
                                        <span>{programKind(selectedService, zh)}</span>
                                        <h3>{programName(selectedService, zh)}</h3>
                                        <p>{selectedService.name}</p>
                                    </div>
                                    <strong className={runtimeTone(selectedService.state)}>
                                        {runtimeStateLabel(selectedService.state, zh)}
                                    </strong>
                                </header>
                                <dl>
                                    <div>
                                        <dt>{zh ? '进程' : 'Process'}</dt>
                                        <dd>PID {selectedService.process?.pid ?? '—'} · {
                                            selectedService.process?.state === 'running'
                                                ? (zh ? '运行中' : 'Running')
                                                : selectedService.process?.state === 'stopped'
                                                    ? (zh ? '已停止' : 'Stopped')
                                                    : (zh ? '未知' : 'Unknown')
                                        }</dd>
                                    </div>
                                    <div>
                                        <dt>{zh ? '接口健康' : 'Endpoint health'}</dt>
                                        <dd>
                                            {selectedService.health.status_code === null
                                                ? 'HTTP —'
                                                : `HTTP ${selectedService.health.status_code}`}
                                            {' · '}
                                            {selectedService.health.latency_ms === null
                                                ? (zh ? '延迟未上报' : 'Latency not reported')
                                                : `${selectedService.health.latency_ms} ms`}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>{zh ? '版本' : 'Version'}</dt>
                                        <dd>{selectedService.version || '—'}</dd>
                                    </div>
                                    <div>
                                        <dt>{zh ? '运行时间' : 'Uptime'}</dt>
                                        <dd>{duration(selectedService.uptime_seconds, zh)}</dd>
                                    </div>
                                    <div>
                                        <dt>{zh ? '重启次数' : 'Restarts'}</dt>
                                        <dd>{selectedService.restart_count ?? (zh ? '未上报' : 'Not reported')}</dd>
                                    </div>
                                    <div>
                                        <dt>{zh ? '运行环境' : 'Environment'}</dt>
                                        <dd>{node.resources.platform} · {node.resources.architecture}</dd>
                                    </div>
                                </dl>
                                <section className='ControlProgramDeployments' aria-label={zh ? '已注册程序' : 'Registered programs'}>
                                    <header>
                                        <strong>{zh ? '已注册程序' : 'Registered programs'}</strong>
                                        <span>{programs?.programs.length ?? 0}</span>
                                    </header>
                                    {!programsCapable
                                        ? <p>{zh ? '升级节点程序后可读取受控程序目录。' : 'Upgrade the node software to read the managed program directory.'}</p>
                                        : programsError
                                            ? <p className='error'>{programsError}</p>
                                            : programs
                                                ? programs.programs.length > 0
                                                    ? <div>{programs.programs.map(program => <article key={program.program_id}>
                                                        <header>
                                                            <span className={`ControlStatusDot ${runtimeTone(program.state)}`} aria-hidden='true'/>
                                                            <strong>{program.name}</strong>
                                                            <em>{runtimeStateLabel(program.state, zh)}</em>
                                                        </header>
                                                        <dl>
                                                            <div><dt>{zh ? '版本' : 'Version'}</dt><dd>{program.version}</dd></div>
                                                            <div><dt>{zh ? '模式' : 'Mode'}</dt><dd>{program.mode === 'production'
                                                                ? (zh ? '生产' : 'Production')
                                                                : (zh ? '调试' : 'Debug')}</dd></div>
                                                            <div><dt>{zh ? '程序目录' : 'Program directory'}</dt><dd>{program.root}</dd></div>
                                                            <div><dt>{zh ? '独立环境' : 'Environment'}</dt><dd>{program.environment}</dd></div>
                                                            <div><dt>{zh ? '加密声明' : 'Encryption declaration'}</dt><dd>{({
                                                                encrypted: zh ? '已加密' : 'Encrypted',
                                                                plain: zh ? '未加密' : 'Plain',
                                                                unknown: zh ? '未知' : 'Unknown',
                                                            })[program.encryption]}</dd></div>
                                                            <div><dt>{zh ? '服务' : 'Service'}</dt><dd>{program.service.name}
                                                            {' · '}PID {program.service.pid ?? '—'}</dd></div>
                                                        </dl>
                                                    </article>)}</div>
                                                    : <p>{zh ? '节点尚未注册部署程序。' : 'No deployed programs are registered on this node.'}</p>
                                                : <p>{zh
                                                    ? `正在读取受控程序目录… ${refreshProgress}%`
                                                    : `Loading the managed program directory… ${refreshProgress}%`}</p>}
                                    {Boolean(programs?.invalid_manifests) && <p className='warning'>
                                        {zh
                                            ? `${programs?.invalid_manifests} 个程序清单未通过安全校验`
                                            : `${programs?.invalid_manifests} program manifests failed validation`}
                                    </p>}
                                </section>
                                {Object.keys(selectedService.task_counts || {}).length > 0 && <div className='ControlProgramTaskCounts'>
                                    <strong>{zh ? '任务状态' : 'Task status'}</strong>
                                    <span>{Object.entries(selectedService.task_counts || {})
                                        .map(([state, count]) => `${taskStateLabel(state, zh)} ${count}`)
                                        .join(' · ')}</span>
                                </div>}
                                {selectedService.execution?.last_exit && <div className='ControlProgramLastExit'>
                                    <strong>{zh ? '最近退出' : 'Latest exit'}</strong>
                                    <span>{selectedService.execution.last_exit.reason || (zh ? '未提供原因' : 'No reason reported')}
                                    {' · '}{dateTime(selectedService.execution.last_exit.recorded_at, zh)}</span>
                                </div>}
                                <div className='ControlProgramCapabilityNote' role='status'>
                                    <strong>{zh ? '当前管理范围' : 'Current management scope'}</strong>
                                    <span>{zh
                                        ? '已接入程序目录、独立环境、运行模式、加密声明、状态、进程、接口健康、运行结果与结构化日志。部署、加密执行、启停及模式切换仍需一次性授权接口。'
                                        : 'Program directories, environments, modes, encryption declarations, status, processes, endpoint health, runtime results, and structured logs are available. Deployment, encryption actions, lifecycle actions, and mode changes still require one-time authorization APIs.'}</span>
                                </div>
                            </section>
                        </div>
                        : unavailable(
                            runtimeError
                                ? (zh ? '程序状态暂不可用' : 'Program status is unavailable')
                                : refreshing && !snapshot
                                    ? (zh
                                        ? `正在读取程序状态… ${refreshProgress}%`
                                        : `Loading program status… ${refreshProgress}%`)
                                    : (zh ? '暂无程序状态' : 'No program status'),
                            runtimeError,
                        ))}

                {view === 'preview' && (!programsVisible
                    ? unavailable(
                        zh ? '当前节点尚不支持实时预览' : 'Live preview is not supported',
                        node.online
                            ? (zh ? '升级节点程序后可查看实时画面。' : 'Upgrade the node software to view the live stream.')
                            : (zh ? '节点恢复在线后才能读取实时画面。' : 'The node must return online before the live stream can be read.'),
                    )
                    : livePreview
                        ? <section className='ControlProgramPreview' aria-label={zh ? '程序预览' : 'Program preview'}>
                            <div className='ControlProgramLivePreview CameraPlayer'>
                                <div className='CameraPlayerHeader'>
                                    <div className='CameraPlayerIdentity'>
                                        <span className={`CameraLiveDot ${previewState}`}/>
                                        <strong>{livePreview.program_name}</strong>
                                        <span className='CameraLiveBadge'>
                                            {previewState === 'playing'
                                                ? 'LIVE'
                                                : previewState === 'error'
                                                    ? (zh ? '连接失败' : 'FAILED')
                                                    : (zh ? '连接中' : 'CONNECTING')}
                                        </span>
                                    </div>
                                    <div className='CameraPlayerMeta'>
                                        <span>{livePreview.name}</span>
                                        <span>{livePreview.path}</span>
                                        <button type='button' onClick={reconnectPreview}>
                                            {zh ? '重新连接' : 'Reconnect'}
                                        </button>
                                    </div>
                                </div>
                                <div className='CameraPlayerStage'>
                                    <div className='CameraComparePane effect'>
                                        {previewState === 'loading' && <div className='CameraPlayerNotice'>
                                            <span className='CameraPlayerSpinner'/>
                                            {zh ? '正在建立实时画面…' : 'Opening live stream…'}
                                        </div>}
                                        {previewState === 'error' && <div className='CameraPlayerNotice error'>
                                            <strong>{zh ? '实时画面连接失败' : 'Unable to open live stream'}</strong>
                                            <span>{zh
                                                ? `请检查程序状态和 ${livePreview.path} 接口。`
                                                : `Check the program and ${livePreview.path} API.`}</span>
                                            <button type='button' onClick={reconnectPreview}>
                                                {zh ? '重试' : 'Retry'}
                                            </button>
                                        </div>}
                                        <img
                                            key={previewNonce}
                                            src={previewUrl}
                                            alt={zh
                                                ? `${livePreview.program_name} 现场实时画面`
                                                : `${livePreview.program_name} live site preview`}
                                            onLoad={() => setPreviewState('playing')}
                                            onError={() => setPreviewState('error')}
                                            draggable={false}
                                        />
                                    </div>
                                </div>
                                <CameraTimeline
                                    language={zh ? Language.CHINESE : Language.ENGLISH}
                                    dayTime={previewNow}
                                />
                            </div>
                        </section>
                        : unavailable(
                            programsError
                                ? (zh ? '实时预览暂不可用' : 'Live preview is unavailable')
                                : refreshing && !programs
                                    ? (zh
                                        ? `正在读取实时预览… ${refreshProgress}%`
                                        : `Loading live preview… ${refreshProgress}%`)
                                    : (zh ? '该程序未声明 /rtsp 预览接口' : 'The program has not declared a /rtsp preview API'),
                            programsError,
                        ))}

                {view === 'endpoints' && (!programsVisible
                    ? unavailable(
                        zh ? '当前节点尚不支持程序接口' : 'Program APIs are not supported',
                        node.online
                            ? (zh ? '升级节点程序后可查看程序接口。' : 'Upgrade the node software to view program APIs.')
                            : (zh ? '节点恢复在线后才能读取程序接口。' : 'The node must return online before program APIs can be read.'),
                    )
                    : <section className='ControlMonitorProcesses ControlMonitorInventory ControlProgramInterfaces' aria-label={zh ? '程序接口' : 'Program APIs'}>
                        <header className='ControlMonitorSearchHeader'>
                            <div>
                                <h3>{zh ? '接口' : 'APIs'}</h3>
                                <p>{zh ? '每 5 秒检查程序声明的安全只读接口' : 'Declared safe read-only APIs refresh every 5 seconds'}</p>
                            </div>
                            <span className='ControlProgramEndpointCount'>{endpointRows.length}</span>
                        </header>
                        {programsError && <p className='ControlProgramError' role='status'>
                            {programsError}
                        </p>}
                        {endpointRows.length > 0 ? <table>
                            <thead><tr>
                                <th>{zh ? '程序' : 'Program'}</th>
                                <th>{zh ? '方法' : 'Method'}</th>
                                <th>{zh ? '路径' : 'Path'}</th>
                                <th>{zh ? '功能' : 'Function'}</th>
                                <th>{zh ? '状态' : 'Status'}</th>
                                <th>{zh ? '响应' : 'Response'}</th>
                                <th>{zh ? '延迟' : 'Latency'}</th>
                                <th>{zh ? '最近检查' : 'Last checked'}</th>
                            </tr></thead>
                            <tbody>{endpointRows.map(endpoint => <tr key={endpoint.key}>
                                <td>{endpoint.program_name}</td>
                                <td><code>{endpoint.method}</code></td>
                                <td>{endpoint.method === 'GET'
                                    ? <a
                                        className='ControlProgramEndpointLink'
                                        href={ComputeClusterService.programInterfaceUrl(
                                            node.node_id,
                                            endpoint.program_id,
                                            endpoint.path,
                                        )}
                                        target='_blank'
                                        rel='noreferrer'
                                    ><code>{endpoint.path}</code></a>
                                    : <code>{endpoint.path}</code>}</td>
                                <td><span className='ControlProgramEndpointName'>
                                    <span className={`ControlStatusDot ${interfaceTone(endpoint.state)}`} aria-hidden='true'/>
                                    <span><strong>{endpoint.name}</strong><small>{endpoint.description}</small></span>
                                </span></td>
                                <td>{interfaceStateLabel(endpoint.state, zh)}</td>
                                <td>{endpoint.status_code === null ? '—' : `HTTP ${endpoint.status_code}`}</td>
                                <td>{endpoint.latency_ms === null ? '—' : `${endpoint.latency_ms} ms`}</td>
                                <td>{endpoint.checked_at === null ? '—' : dateTime(endpoint.checked_at, zh)}</td>
                            </tr>)}</tbody>
                        </table> : unavailable(
                            programsError
                                ? (zh ? '程序接口暂不可用' : 'Program APIs are unavailable')
                                : refreshing && !programs
                                    ? (zh
                                        ? `正在读取程序接口… ${refreshProgress}%`
                                        : `Loading program APIs… ${refreshProgress}%`)
                                    : (zh ? '该程序未声明接口' : 'The program has not declared any APIs'),
                        )}
                    </section>)}

                {view === 'artifacts' && (!programsVisible
                    ? unavailable(
                        zh ? '当前节点尚不支持程序结果' : 'Program results are not supported',
                        node.online
                            ? (zh ? '升级节点程序后可查看录像、图片和数据文件。' : 'Upgrade the node software to view recordings, images, and data files.')
                            : (zh ? '节点恢复在线后才能读取程序结果。' : 'The node must return online before results can be read.'),
                    )
                    : <section className='ControlProgramArtifacts' aria-label={zh ? '程序结果' : 'Program results'}>
                        <header className='ControlMonitorSearchHeader'>
                            <div>
                                <h3>{zh ? '运行结果' : 'Runtime results'}</h3>
                                <p>{zh ? '录像、图表与配套数据' : 'Recordings, charts, and paired data'}</p>
                            </div>
                            <div className='ControlProgramArtifactFilters'>
                                <input
                                    type='search'
                                    value={artifactQuery}
                                    aria-label={zh ? '搜索结果' : 'Search results'}
                                    placeholder={zh ? '搜索文件名或路径' : 'Search file name or path'}
                                    onChange={event => setArtifactQuery(event.target.value)}
                                />
                                <input
                                    type='date'
                                    value={artifactDate}
                                    aria-label={zh ? '筛选结果日期' : 'Filter results by date'}
                                    onChange={event => setArtifactDate(event.target.value)}
                                />
                                <select
                                    aria-label={zh ? '筛选结果类型' : 'Filter result type'}
                                    value={artifactCategoryFilter}
                                    onChange={event => setArtifactCategoryFilter(event.target.value as ResultCategory)}
                                >
                                    {(['all', 'video', 'image', 'data', 'telegram', 'log'] as ResultCategory[]).map(category => <option
                                        key={category}
                                        value={category}
                                    >{artifactCategoryLabel(category, zh)}</option>)}
                                </select>
                                {(artifactDate || artifactQuery || artifactCategoryFilter !== 'all') && <button
                                    type='button'
                                    onClick={() => {
                                        setArtifactDate('');
                                        setArtifactQuery('');
                                        setArtifactCategoryFilter('all');
                                    }}
                                >{zh ? '清除筛选' : 'Clear filters'}</button>}
                                <span>{filteredProgramArtifacts.length}/{programArtifacts.length}</span>
                            </div>
                        </header>
                        {programsError && programs && <div className='ControlRefreshWarning' role='status'>
                            <span>
                                {zh ? '刷新失败，正在重试：' : 'Refresh failed; retrying: '}
                                {programsError}
                            </span>
                        </div>}
                        {programsError && !programs
                            ? <p className='ControlProgramError' role='status'>{programsError}</p>
                            : programArtifacts.length > 0 && selectedArtifact
                                ? <div className='ControlProgramArtifactWorkspace'>
                                    <aside aria-label={zh ? '结果列表' : 'Result list'}>
                                        {artifactGroups.map(group => group.artifacts.length > 0 && <section
                                            className='ControlProgramArtifactGroup'
                                            key={group.category}
                                        >
                                            <header>
                                                <strong>{artifactCategoryLabel(group.category, zh)}</strong>
                                                <span>{group.artifacts.length}</span>
                                            </header>
                                            {group.artifacts.map(artifact => <button
                                                type='button'
                                                key={`${artifact.program_id}-${artifact.artifact_id}`}
                                                aria-current={artifact.selection_id === selectedArtifact.selection_id
                                                    ? 'page'
                                                    : undefined}
                                                onClick={() => setSelectedArtifactId(artifact.selection_id)}
                                            >
                                                <strong>{artifact.name}</strong>
                                                <span>{artifact.program_name} · {bytes(artifact.size_bytes)}</span>
                                                <small>{dateTime(artifact.modified_at, zh)}</small>
                                            </button>)}
                                        </section>)}
                                    </aside>
                                    <div className='ControlProgramArtifactPreview'>
                                        <header>
                                            <div>
                                                <strong>{selectedArtifact.name}</strong>
                                                <span>{selectedArtifact.relative_path}</span>
                                            </div>
                                            <em>{bytes(selectedArtifact.size_bytes)}</em>
                                        </header>
                                        {selectedArtifact.kind === 'video'
                                            ? loadedVideoId === selectedArtifact.selection_id
                                                ? <div className='ControlProgramPreviewFrame'>
                                                    {videoPreviewError
                                                        ? <div className='ControlProgramPreviewPlaceholder'>
                                                            <strong>{zh ? '视频预览加载失败' : 'Video preview failed'}</strong>
                                                            <span>{videoPreviewError}</span>
                                                                <button
                                                                    type='button'
                                                                    onClick={() => {
                                                                        setLoadedVideoId('');
                                                                        setVideoPreviewError('');
                                                                        setReadyVideoId('');
                                                                        setVideoPreviewProgress(0);
                                                                    }}
                                                            >{zh ? '重新加载视频' : 'Reload video'}</button>
                                                        </div>
                                                        : readyVideoId !== selectedArtifact.selection_id && <div className='ControlProgramPreviewPlaceholder'>
                                                            <strong>{zh
                                                                ? `正在加载视频预览 ${videoPreviewProgress}%`
                                                                : `Loading video preview ${videoPreviewProgress}%`}</strong>
                                                            <span>{zh ? '正在读取视频文件' : 'Reading the video file'}</span>
                                                        </div>}
                                                    {readyVideoId === selectedArtifact.selection_id
                                                        && videoPreviewProgress < 100
                                                        && <span className='ControlProgramPreviewProgress'>
                                                            {zh
                                                                ? `视频加载 ${videoPreviewProgress}%`
                                                                : `Video loading ${videoPreviewProgress}%`}
                                                        </span>}
                                                    <video
                                                        className={readyVideoId === selectedArtifact.selection_id ? '' : 'is-loading'}
                                                        controls
                                                        preload='auto'
                                                        src={selectedArtifactUrl}
                                                        onDurationChange={event =>
                                                            setVideoPreviewProgress(bufferedPercent(event.currentTarget))}
                                                        onProgress={event =>
                                                            setVideoPreviewProgress(bufferedPercent(event.currentTarget))}
                                                        onLoadedData={event => {
                                                            setVideoPreviewProgress(bufferedPercent(event.currentTarget));
                                                            setReadyVideoId(selectedArtifact.selection_id);
                                                        }}
                                                        onCanPlayThrough={() => setVideoPreviewProgress(100)}
                                                        onError={() => setVideoPreviewError(zh ? '无法读取视频文件' : 'Unable to read the video file')}
                                                    />
                                                </div>
                                                : <div className='ControlProgramPreviewPlaceholder'>
                                                    <strong>{zh ? '视频预览未加载' : 'Video preview is not loaded'}</strong>
                                                    <span>{zh ? '点击后才会读取视频文件' : 'The video is fetched only after you load the preview'}</span>
                                                    <button
                                                        type='button'
                                                        onClick={() => {
                                                            setLoadedVideoId(selectedArtifact.selection_id);
                                                            setReadyVideoId('');
                                                            setVideoPreviewProgress(0);
                                                            setVideoPreviewError('');
                                                        }}
                                                    >{zh ? '加载视频预览' : 'Load video preview'}</button>
                                                </div>
                                            : selectedArtifact.kind === 'image'
                                                ? <div className='ControlProgramPreviewFrame'>
                                                    {imagePreviewError
                                                        ? <div className='ControlProgramPreviewPlaceholder'>
                                                            <strong>{zh ? '图片预览加载失败' : 'Image preview failed'}</strong>
                                                            <span>{imagePreviewError}</span>
                                                        </div>
                                                        : loadedImageId !== selectedArtifact.selection_id && <div className='ControlProgramPreviewPlaceholder'>
                                                            <strong>{zh ? '正在加载图片预览…' : 'Loading image preview…'}</strong>
                                                            <span>{zh ? '正在读取图片文件' : 'Reading the image file'}</span>
                                                        </div>}
                                                    <img
                                                        className={loadedImageId === selectedArtifact.selection_id ? '' : 'is-loading'}
                                                        src={selectedArtifactUrl}
                                                        alt={selectedArtifact.name}
                                                        onLoad={() => setLoadedImageId(selectedArtifact.selection_id)}
                                                        onError={() => setImagePreviewError(zh ? '无法读取图片文件' : 'Unable to read the image file')}
                                                    />
                                                </div>
                                                : <div className='ControlProgramResultData'>
                                                    {resultPreviewLoading
                                                        ? <div className='ControlProgramPreviewPlaceholder ControlProgramResultPlaceholder'>
                                                            <strong>{zh ? '正在加载数据预览…' : 'Loading data preview…'}</strong>
                                                            <span>{zh ? '正在读取结果文件' : 'Reading the result file'}</span>
                                                        </div>
                                                        : resultPreviewError
                                                            ? <div className='ControlProgramPreviewPlaceholder ControlProgramResultPlaceholder error'>
                                                                <strong>{zh ? '数据预览加载失败' : 'Data preview failed'}</strong>
                                                                <span>{resultPreviewError}</span>
                                                            </div>
                                                            : <pre aria-label={zh ? '结果内容预览' : 'Result content preview'}>
                                                                {resultPreview || (zh ? '文件为空' : 'Empty file')}
                                                            </pre>}
                                                    <footer>
                                                        <span>{zh ? '网页内预览' : 'In-page preview'}</span>
                                                        {resultPreviewTruncated && <span>
                                                            {zh
                                                                ? `仅预览前 ${bytes(RESULT_PREVIEW_BYTES)}`
                                                                : `Previewing the first ${bytes(RESULT_PREVIEW_BYTES)}`}
                                                        </span>}
                                                    </footer>
                                                </div>}
                                        <a
                                            className='ControlProgramArtifactDownload'
                                            href={selectedArtifactUrl}
                                            download={selectedArtifact.name}
                                            aria-label={zh ? '下载原文件' : 'Download original file'}
                                            title={zh ? '下载原文件' : 'Download original file'}
                                        >
                                            <span>{zh ? '下载' : 'Download'}</span>
                                        </a>
                                    </div>
                                </div>
                                : unavailable(
                                    refreshing && !programs
                                        ? (zh
                                            ? `正在读取程序结果… ${refreshProgress}%`
                                            : `Loading program results… ${refreshProgress}%`)
                                        : programArtifacts.length > 0
                                            ? (zh ? '没有符合筛选条件的结果' : 'No results match the filters')
                                            : (zh ? '暂无录像、图片或数据文件' : 'No recordings, images, or data files'),
                                )}
                    </section>)}

                {(view === 'telegrams' || view === 'logs') && (!logsVisible
                    ? unavailable(
                        view === 'telegrams'
                            ? (zh ? '当前节点尚不支持电文' : 'Telegrams are not supported')
                            : (zh ? '当前节点尚不支持结构化日志' : 'Structured logs are not supported'),
                        node.online
                            ? (view === 'telegrams'
                                ? (zh ? '升级节点程序后可查看电文。' : 'Upgrade the node software to view telegrams.')
                                : (zh ? '升级节点程序后可查看日志。' : 'Upgrade the node software to view logs.'))
                            : (view === 'telegrams'
                                ? (zh ? '节点恢复在线后才能读取电文。' : 'The node must return online before telegrams can be read.')
                                : (zh ? '节点恢复在线后才能读取日志。' : 'The node must return online before logs can be read.')),
                    )
                    : <section
                        className='ControlProgramLogs'
                        aria-label={view === 'telegrams'
                            ? (zh ? '程序电文' : 'Program telegrams')
                            : (zh ? '程序日志' : 'Program logs')}
                    >
                        <header className='ControlMonitorSearchHeader'>
                            <div>
                                <h3>{view === 'telegrams'
                                    ? (zh ? '电文' : 'Telegrams')
                                    : (zh ? '结构化日志' : 'Structured logs')}</h3>
                                <p>{view === 'telegrams'
                                    ? (zh ? '程序收发电文' : 'Program telegram traffic')
                                    : (zh ? '任务与程序运行事件' : 'Task and program runtime events')}</p>
                            </div>
                            <div className='ControlProgramLogTools'>
                                {view === 'telegrams' && <div
                                    className='ControlProgramLogFormat'
                                    role='group'
                                    aria-label={zh ? '电文显示格式' : 'Telegram display format'}
                                >
                                    <button
                                        type='button'
                                        aria-pressed={prettyTelegramLogs}
                                        onClick={() => setPrettyTelegramLogs(true)}
                                    >{zh ? '美化格式' : 'Pretty'}</button>
                                    <button
                                        type='button'
                                        aria-pressed={!prettyTelegramLogs}
                                        onClick={() => setPrettyTelegramLogs(false)}
                                    >{zh ? '原始格式' : 'Raw'}</button>
                                </div>}
                                {view === 'logs' && <select
                                    aria-label={zh ? '筛选日志程序' : 'Filter log program'}
                                    value={logServiceId}
                                    onChange={event => setLogServiceId(event.target.value)}
                                >
                                    <option value=''>{zh ? '全部程序' : 'All programs'}</option>
                                    {(snapshot?.services || []).map(service => <option
                                        key={service.service_id}
                                        value={service.service_id}
                                    >{programName(service, zh)}</option>)}
                                    {(programs?.programs || []).map(program => <option
                                        key={program.program_id}
                                        value={program.program_id}
                                    >{program.name}</option>)}
                                </select>}
                            </div>
                        </header>
                        {(eventsError || programsError) && <p className='ControlProgramError' role='status'>
                            {[eventsError, programsError].filter(Boolean).join(' · ')}
                        </p>}
                        {logRows.length > 0 ? <ol>
                            {logRows.map(event => <li className={event.level} key={event.key}>
                                <span className='ControlProgramLogTime'>{dateTime(event.created_at, zh)}</span>
                                <span className='ControlProgramLogProgram'>
                                    {serviceNames.get(event.service_id) || event.service_id}
                                </span>
                                <span className='ControlProgramLogType'>{event.event_type}</span>
                                {view === 'telegrams'
                                    ? <pre className='ControlProgramLogMessage' aria-label={zh ? '电文内容' : 'Telegram content'}>
                                        {prettyTelegramLogs
                                            ? JSON.stringify(JSON.parse(event.message), null, 2)
                                            : event.message}
                                    </pre>
                                    : <strong>{event.message}</strong>}
                                <small>{event.task_id ? `${zh ? '任务' : 'Task'} ${event.task_id}` : ''}</small>
                            </li>)}
                        </ol> : unavailable(
                            eventsError || programsError
                                ? (view === 'telegrams'
                                    ? (zh ? '电文暂不可用' : 'Telegrams are unavailable')
                                    : (zh ? '日志暂不可用' : 'Logs are unavailable'))
                                : refreshing && !snapshot && !programs && events.length === 0
                                    ? (view === 'telegrams'
                                        ? (zh ? `正在读取电文… ${refreshProgress}%` : `Loading telegrams… ${refreshProgress}%`)
                                        : (zh ? `正在读取日志… ${refreshProgress}%` : `Loading logs… ${refreshProgress}%`))
                                    : (view === 'telegrams'
                                        ? (zh ? '暂无电文' : 'No telegrams')
                                        : (zh ? '暂无结构化日志' : 'No structured logs')),
                        )}
                    </section>)}
            </div>
        </div>
    </section>;
};
