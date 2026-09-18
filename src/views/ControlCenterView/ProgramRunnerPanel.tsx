import React, {useEffect, useMemo, useState} from 'react';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeProgramSnapshot,
    ComputeRuntimeEvent,
    ComputeRuntimeInventory,
    ComputeRuntimeService,
    ComputeRuntimeSnapshot,
} from '../../services/ComputeClusterService';

type ProgramRunnerView = 'programs' | 'processes' | 'logs';
type ProgramTone = 'healthy' | 'warning' | 'offline';

interface IProps {
    node: ComputeClusterNode;
    zh: boolean;
    maximized: boolean;
    onClose: () => void;
    onToggleMaximized: () => void;
}

const runtimeTone = (state: ComputeRuntimeService['state']): ProgramTone =>
    state === 'healthy' ? 'healthy' : state === 'unavailable' ? 'offline' : 'warning';

const runtimeStateLabel = (state: ComputeRuntimeService['state'], zh: boolean): string => ({
    healthy: zh ? '正常' : 'Healthy',
    degraded: zh ? '降级' : 'Degraded',
    unavailable: zh ? '不可用' : 'Unavailable',
    unknown: zh ? '未知' : 'Unknown',
})[state];

const processStateLabel = (
    state: ComputeRuntimeInventory['processes'][number]['state'],
    zh: boolean,
): string => ({
    running: zh ? '运行中' : 'Running',
    sleeping: zh ? '休眠' : 'Sleeping',
    stopped: zh ? '已停止' : 'Stopped',
    zombie: zh ? '僵尸进程' : 'Zombie',
    unknown: zh ? '未知' : 'Unknown',
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

const taskStateLabel = (state: string, zh: boolean): string => ({
    queued: zh ? '排队' : 'Queued',
    running: zh ? '运行中' : 'Running',
    paused: zh ? '已暂停' : 'Paused',
    succeeded: zh ? '成功' : 'Succeeded',
    failed: zh ? '失败' : 'Failed',
    cancelled: zh ? '已取消' : 'Cancelled',
})[state] || state;

// The three views share one polling boundary so closing the runner cancels every request together.
// eslint-disable-next-line complexity
export const ProgramRunnerPanel: React.FC<IProps> = ({
    node,
    zh,
    maximized,
    onClose,
    onToggleMaximized,
}) => {
    const [view, setView] = useState<ProgramRunnerView>('programs');
    const [snapshot, setSnapshot] = useState<ComputeRuntimeSnapshot | null>(null);
    const [inventory, setInventory] = useState<ComputeRuntimeInventory | null>(null);
    const [programs, setPrograms] = useState<ComputeProgramSnapshot | null>(null);
    const [events, setEvents] = useState<ComputeRuntimeEvent[]>([]);
    const [runtimeError, setRuntimeError] = useState('');
    const [inventoryError, setInventoryError] = useState('');
    const [programsError, setProgramsError] = useState('');
    const [eventsError, setEventsError] = useState('');
    const [selectedServiceId, setSelectedServiceId] = useState('');
    const [processQuery, setProcessQuery] = useState('');
    const [logServiceId, setLogServiceId] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const runtimeCapable = node.online && node.capabilities.includes('runtime.read.v1');
    const inventoryCapable = node.online && node.capabilities.includes('runtime.inventory.v1');
    const programsCapable = node.online && node.capabilities.includes('runtime.programs.read.v1');

    useEffect(() => {
        setView('programs');
        setSnapshot(null);
        setInventory(null);
        setPrograms(null);
        setEvents([]);
        setRuntimeError('');
        setInventoryError('');
        setProgramsError('');
        setEventsError('');
        setSelectedServiceId('');
        setProcessQuery('');
        setLogServiceId('');
    }, [node.node_id]);

    useEffect(() => {
        if (!runtimeCapable && !inventoryCapable && !programsCapable) return undefined;
        const controller = new AbortController();
        let inFlight = false;
        // eslint-disable-next-line complexity
        const load = async () => {
            if (inFlight) return;
            inFlight = true;
            setRefreshing(true);
            const [runtimeResult, inventoryResult, programsResult, eventsResult] = await Promise.allSettled([
                runtimeCapable
                    ? ComputeClusterService.runtime(node.node_id, controller.signal)
                    : Promise.resolve(null),
                inventoryCapable
                    ? ComputeClusterService.runtimeInventory(node.node_id, controller.signal)
                    : Promise.resolve(null),
                programsCapable
                    ? ComputeClusterService.programs(node.node_id, controller.signal)
                    : Promise.resolve(null),
                runtimeCapable
                    ? ComputeClusterService.runtimeEvents(node.node_id, 0, 100, controller.signal)
                    : Promise.resolve(null),
            ]);
            if (!controller.signal.aborted) {
                if (runtimeResult.status === 'fulfilled') {
                    if (runtimeResult.value) setSnapshot(runtimeResult.value);
                    setRuntimeError('');
                } else {
                    setRuntimeError(runtimeResult.reason instanceof Error
                        ? runtimeResult.reason.message
                        : String(runtimeResult.reason));
                }
                if (inventoryResult.status === 'fulfilled') {
                    if (inventoryResult.value) setInventory(inventoryResult.value);
                    setInventoryError('');
                } else {
                    setInventoryError(inventoryResult.reason instanceof Error
                        ? inventoryResult.reason.message
                        : String(inventoryResult.reason));
                }
                if (programsResult.status === 'fulfilled') {
                    if (programsResult.value) setPrograms(programsResult.value);
                    setProgramsError('');
                } else {
                    setProgramsError(programsResult.reason instanceof Error
                        ? programsResult.reason.message
                        : String(programsResult.reason));
                }
                if (eventsResult.status === 'fulfilled') {
                    if (eventsResult.value) setEvents(eventsResult.value.events);
                    setEventsError('');
                } else {
                    setEventsError(eventsResult.reason instanceof Error
                        ? eventsResult.reason.message
                        : String(eventsResult.reason));
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
    }, [inventoryCapable, node.node_id, programsCapable, refreshVersion, runtimeCapable]);

    const selectedService = snapshot?.services.find(service =>
        service.service_id === selectedServiceId
    ) || snapshot?.services[0] || null;
    const serviceNames = new Map(
        (snapshot?.services || []).map(service => [service.service_id, programName(service, zh)]),
    );
    (programs?.programs || []).forEach(program =>
        serviceNames.set(program.program_id, program.name)
    );
    const filteredProcesses = useMemo(() => {
        const query = processQuery.trim().toLowerCase();
        return [...(inventory?.processes || [])]
            .filter(process => !query
                || process.name.toLowerCase().includes(query)
                || String(process.pid).includes(query)
                || processStateLabel(process.state, zh).toLowerCase().includes(query))
            .sort((left, right) =>
                right.memory_bytes - left.memory_bytes || left.name.localeCompare(right.name)
            );
    }, [inventory, processQuery, zh]);
    const filteredEvents = [...events]
        .filter(event => !logServiceId || event.service_id === logServiceId)
        .reverse();
    const programEvents = (programs?.programs || []).flatMap(program =>
        program.events.map(event => ({...event, service_id: program.program_id}))
    ).filter(event => !logServiceId || event.service_id === logServiceId)
        .sort((left, right) => right.created_at - left.created_at);
    const logRows = [
        ...filteredEvents.map(event => ({...event, key: `runtime-${event.cursor}`})),
        ...programEvents.map((event, index) => ({
            ...event,
            key: `program-${event.service_id}-${event.created_at}-${index}`,
            task_id: null,
        })),
    ].sort((left, right) => right.created_at - left.created_at);
    const capturedAt = snapshot?.captured_at
        || inventory?.captured_at
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
                    {zh ? '程序状态每 5 秒刷新' : 'Program status refreshes every 5 seconds'}
                    {' · '}{dateTime(capturedAt, zh)}
                </p>
            </div>
            <div className='ComputeClusterHeaderActions'>
                <button
                    type='button'
                    className='ControlProgramRefresh'
                    aria-label={zh ? '刷新程序运行器' : 'Refresh program runner'}
                    title={zh ? '刷新' : 'Refresh'}
                    disabled={refreshing}
                    onClick={() => setRefreshVersion(current => current + 1)}
                >↻</button>
                <button
                    type='button'
                    className={`window-toggle ${maximized ? 'restore' : 'maximize'}`}
                    aria-label={maximized
                        ? (zh ? '还原程序运行器窗口' : 'Restore program runner window')
                        : (zh ? '放大程序运行器窗口' : 'Maximize program runner window')}
                    aria-pressed={maximized}
                    onClick={onToggleMaximized}
                ><i aria-hidden='true'/></button>
                <button
                    type='button'
                    aria-label={zh ? '关闭程序运行器' : 'Close program runner'}
                    title={zh ? '关闭' : 'Close'}
                    onClick={onClose}
                >×</button>
            </div>
        </header>

        <div className='ControlMonitorWorkspace'>
            <nav className='ControlMonitorNav' aria-label={zh ? '程序运行器导航' : 'Program runner navigation'}>
                {([
                    ['programs', zh ? '程序' : 'Programs'],
                    ['processes', zh ? '进程' : 'Processes'],
                    ['logs', zh ? '日志' : 'Logs'],
                ] as [ProgramRunnerView, string][]).map(([item, label]) => <button
                    type='button'
                    key={item}
                    aria-current={view === item ? 'page' : undefined}
                    onClick={() => setView(item)}
                >{label}</button>)}
            </nav>

            <div className='ControlMonitorContent'>
                {view === 'programs' && (!runtimeCapable
                    ? unavailable(
                        zh ? '当前节点尚不支持程序状态' : 'Program status is not supported',
                        node.online
                            ? (zh ? '升级节点程序后可查看程序、接口状态和日志。' : 'Upgrade the node software to view programs, endpoint status, and logs.')
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
                                                : <p>{zh ? '正在读取受控程序目录…' : 'Loading the managed program directory…'}</p>}
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
                                        ? '已接入程序目录、独立环境、运行模式、加密声明、状态、进程、接口健康与结构化日志。部署、加密执行、启停及模式切换仍需一次性授权接口。'
                                        : 'Program directories, environments, modes, encryption declarations, status, processes, endpoint health, and structured logs are available. Deployment, encryption actions, lifecycle actions, and mode changes still require one-time authorization APIs.'}</span>
                                </div>
                            </section>
                        </div>
                        : unavailable(
                            runtimeError
                                ? (zh ? '程序状态暂不可用' : 'Program status is unavailable')
                                : (zh ? '正在读取程序状态…' : 'Loading program status…'),
                            runtimeError,
                        ))}

                {view === 'processes' && (!inventoryCapable
                    ? unavailable(
                        zh ? '当前节点尚不支持进程清单' : 'Process inventory is not supported',
                        node.online
                            ? (zh ? '升级节点程序后可查看进程。' : 'Upgrade the node software to view processes.')
                            : (zh ? '节点恢复在线后才能读取进程。' : 'The node must return online before processes can be read.'),
                    )
                    : inventory?.processes_available
                        ? <section className='ControlMonitorProcesses ControlMonitorInventory' aria-label={zh ? '程序运行器进程清单' : 'Program runner process list'}>
                            <header className='ControlMonitorSearchHeader'>
                                <div>
                                    <h3>{zh ? '节点进程' : 'Node processes'}</h3>
                                    <p>{zh ? '按内存占用排序' : 'Sorted by memory usage'}</p>
                                </div>
                                <div className='ControlMonitorSearchTools'>
                                    <input
                                        type='search'
                                        value={processQuery}
                                        aria-label={zh ? '搜索程序运行器进程' : 'Search program runner processes'}
                                        placeholder={zh ? '搜索名称、PID 或状态' : 'Search name, PID, or status'}
                                        onChange={event => setProcessQuery(event.target.value)}
                                    />
                                    <span>{processQuery.trim()
                                        ? `${filteredProcesses.length}/${inventory.processes.length}`
                                        : inventory.processes.length}</span>
                                </div>
                            </header>
                            {filteredProcesses.length > 0 ? <table>
                                <thead><tr>
                                    <th>{zh ? '名称' : 'Name'}</th>
                                    <th>PID</th>
                                    <th>CPU</th>
                                    <th>{zh ? '内存' : 'Memory'}</th>
                                    <th>{zh ? '状态' : 'Status'}</th>
                                </tr></thead>
                                <tbody>{filteredProcesses.map(process => <tr key={process.pid}>
                                    <td>{process.name}</td>
                                    <td>{process.pid}</td>
                                    <td>{process.cpu_percent === null ? '—' : `${process.cpu_percent.toFixed(1)}%`}</td>
                                    <td>{bytes(process.memory_bytes)}</td>
                                    <td>{processStateLabel(process.state, zh)}</td>
                                </tr>)}</tbody>
                            </table> : unavailable(zh ? '未找到匹配进程' : 'No matching processes')}
                        </section>
                        : unavailable(
                            inventoryError
                                ? (zh ? '进程清单暂不可用' : 'The process list is unavailable')
                                : inventory
                                    ? (zh ? '节点无法读取进程清单' : 'The node cannot read its process list')
                                    : (zh ? '正在读取进程清单…' : 'Loading process list…'),
                            inventoryError,
                        ))}

                {view === 'logs' && (!runtimeCapable && !programsCapable
                    ? unavailable(
                        zh ? '当前节点尚不支持结构化日志' : 'Structured logs are not supported',
                        node.online
                            ? (zh ? '升级节点程序后可查看日志。' : 'Upgrade the node software to view logs.')
                            : (zh ? '节点恢复在线后才能读取日志。' : 'The node must return online before logs can be read.'),
                    )
                    : <section className='ControlProgramLogs' aria-label={zh ? '程序日志' : 'Program logs'}>
                        <header className='ControlMonitorSearchHeader'>
                            <div>
                                <h3>{zh ? '结构化日志' : 'Structured logs'}</h3>
                                <p>{zh ? '任务与程序运行事件' : 'Task and program runtime events'}</p>
                            </div>
                            <select
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
                            </select>
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
                                <strong>{event.message}</strong>
                                <small>{event.task_id ? `${zh ? '任务' : 'Task'} ${event.task_id}` : ''}</small>
                            </li>)}
                        </ol> : unavailable(
                            eventsError || programsError
                                ? (zh ? '日志暂不可用' : 'Logs are unavailable')
                                : refreshing
                                    ? (zh ? '正在读取日志…' : 'Loading logs…')
                                    : (zh ? '暂无结构化日志' : 'No structured logs'),
                        )}
                    </section>)}
            </div>
        </div>
    </section>;
};
