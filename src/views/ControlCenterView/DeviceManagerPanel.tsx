import React, {useState} from 'react';
import {ComputeClusterNode, ComputeRuntimeState} from '../../services/ComputeClusterService';
import {
    checkMessage, checkSummaryLabel, DeviceCheck, DeviceCheckSummary, isFreshDeviceEvidence, programCheckEvidence,
} from './DeviceChecks';
import {PerformanceDiagnosisEvidence} from './PerformanceDiagnosisPanel';
import type {ProgramLogScope} from './ProgramRunnerPanel';
import {ModelVersionsPanel} from './ModelVersionsPanel';
import {ConfigBackupPanel} from './ConfigBackupPanel';
import {SecurityBaselinePanel} from './SecurityBaselinePanel';
import {MaintenanceHistoryPanel} from './MaintenanceHistoryPanel';
import {StartupItemsPanel} from './StartupItemsPanel';
import {formatBytes} from './StorageAnalysisPanel';
import {ComputeUpgradePanel} from '../PopupView/ComputeClusterPopup/ComputeUpgradePanel';
import {useComputeUpgradeReleases} from '../PopupView/ComputeClusterPopup/useComputeUpgradeReleases';

export type DeviceManagerTool = 'storage' | 'duplicates' | 'files' | 'terminal';

interface IProps {
    node: ComputeClusterNode;
    zh: boolean;
    directoryError: string;
    check?: DeviceCheck;
    history: DeviceCheckSummary[];
    busy: boolean;
    onCheck: () => void;
    onShowLatest?: () => void;
    openOverview: () => void;
    openTool: (tool: DeviceManagerTool) => void;
    openRelated: () => void;
    openLogs: (scope?: ProgramLogScope) => void;
}

const stateLabel = (state: ComputeRuntimeState, zh: boolean) => ({
    healthy: zh ? '正常' : 'Normal',
    degraded: zh ? '故障 · 性能下降' : 'Fault · Degraded',
    unavailable: zh ? '故障 · 不可用' : 'Fault · Unavailable',
    unknown: zh ? '未验证' : 'Unverified',
})[state];

const formatTime = (seconds: number, zh: boolean) => seconds > 0
    ? new Date(seconds * 1000).toLocaleString(zh ? 'zh-CN' : 'en-US')
    : (zh ? '未上报' : 'Not reported');

const ServiceEvidence = ({name, state, checkedAt, zh, detail, statusCode, openLogs}: {
    name: string;
    state: ComputeRuntimeState;
    checkedAt: number;
    zh: boolean;
    detail?: string;
    statusCode: number | null;
    openLogs?: () => void;
}) => {
    const stale = checkedAt > 0 && !isFreshDeviceEvidence(checkedAt, Date.now() / 1000);
    const verifiedState = checkedAt > 0 ? state : 'unknown';
    const faulty = verifiedState === 'degraded' || verifiedState === 'unavailable';
    const evidenceDetail = [detail, statusCode !== null ? `HTTP ${statusCode}` : ''].filter(Boolean).join(' · ');
    return <li>
        <strong>{name}</strong>
        <span>{stale ? (zh ? '证据已过期' : 'Evidence expired') : stateLabel(verifiedState, zh)}</span>
        <time>{formatTime(checkedAt, zh)}</time>
        {evidenceDetail && <small>{evidenceDetail}</small>}
        {faulty && (openLogs
            ? <button type='button' onClick={openLogs}>{zh ? '查看日志' : 'View logs'}</button>
            : <small>{zh ? '暂无已关联的日志来源' : 'No linked log source'}</small>)}
    </li>;
};

const DeviceSoftwareUpdate = ({node, zh}: {node: ComputeClusterNode; zh: boolean}) => {
    const catalog = useComputeUpgradeReleases();
    return <ComputeUpgradePanel nodes={[node]} targetNodeId={node.node_id} zh={zh} {...catalog}/>;
};

// The manager ties all checks to the selected machine and leaves existing tools in place.
// eslint-disable-next-line complexity
export const DeviceManagerPanel = ({
    node, zh, directoryError, check, history, busy, onCheck, onShowLatest, openOverview, openTool, openLogs, openRelated,
}: IProps) => {
    const [startup, setStartup] = useState<'preview' | 'manage'>();
    const [softwareUpdate, setSoftwareUpdate] = useState(false);
    const [modelVersions, setModelVersions] = useState(false);
    const [configBackups, setConfigBackups] = useState(false);
    const [securityBaseline, setSecurityBaseline] = useState(false);
    const [maintenanceHistory, setMaintenanceHistory] = useState(false);
    const startupManageable = node.online && node.capabilities.includes('control.startup.manage.v1');
    const {runtime, programs, performance} = check || {};
    const resourceTime = node.resources.captured_at;
    const now = Date.now() / 1000;
    const resourceStale = resourceTime > 0 && !isFreshDeviceEvidence(resourceTime, now);
    const {disk_total_bytes: diskTotal, disk_free_bytes: diskFree} = node.resources;
    const diskReported = resourceTime > 0 && diskTotal > 0 && diskFree >= 0 && diskFree <= diskTotal;
    const ssh = node.network_dependencies.find(dependency => dependency.dependency_id === 'control_ssh');
    const sshFresh = ssh && !directoryError && isFreshDeviceEvidence(ssh.checked_at, now);
    const sshVerified = sshFresh && ssh.state === 'healthy';
    const sshFault = sshFresh && ssh.state === 'unavailable';
    const businessSnapshot = programs?.status === 'ready' ? programs.value : undefined;
    const businessPrograms = businessSnapshot?.programs.map(program => ({
        program, ...programCheckEvidence(program, businessSnapshot.captured_at),
    })) || [];
    const verifiedPrograms = businessPrograms.filter(item =>
        item.state !== 'unknown' && isFreshDeviceEvidence(item.checkedAt, now)
    );
    const businessFaults = verifiedPrograms.filter(item => item.state === 'unavailable' || item.state === 'degraded').length;
    const businessSummary = !programs ? (zh ? '待自检' : 'Awaiting self-check')
        : programs.status !== 'ready' ? checkMessage(programs.status, zh)
            : !isFreshDeviceEvidence(programs.value.captured_at, now)
                ? (programs.value.captured_at > 0 ? (zh ? '证据已过期' : 'Evidence expired')
                    : (zh ? '未上报' : 'Not reported'))
                : businessPrograms.length
                    ? (zh ? `已验证 ${verifiedPrograms.length}/${businessPrograms.length} · ${businessFaults} 个故障`
                        : `${verifiedPrograms.length}/${businessPrograms.length} verified · ${businessFaults} faults`)
                    : programs.value.invalid_manifests > 0
                        ? (zh ? '程序清单无效' : 'Invalid program manifests')
                        : (zh ? '未挂载程序' : 'No mounted programs');

    const checking = runtime?.status === 'pending' || programs?.status === 'pending'
        || performance?.status === 'pending';
    const tools = [
        {icon: '容量', enIcon: 'DISK', name: zh ? '存储与大文件' : 'Storage and large files',
            detail: zh ? '按目录查大文件、占用较大的目录和文件类型' : 'Find large files, folders, and file types by directory',
            supported: node.capabilities.includes('task.storage.scan.v1'), action: () => openTool('storage')},
        {icon: '重复', enIcon: 'DUPE', name: zh ? '重复文件' : 'Duplicate files',
            detail: zh ? '按内容比对并查看可释放空间' : 'Compare contents and see reclaimable space',
            supported: node.capabilities.includes('task.duplicate.scan.v1'), action: () => openTool('duplicates')},
        {icon: '文件', enIcon: 'FILE', name: zh ? '文件管理' : 'File manager',
            detail: zh ? '查看目录、大小和修改时间' : 'Browse directories, sizes, and timestamps',
            supported: node.capabilities.includes('filesystem.list.v1'), action: () => openTool('files')},
        {icon: '启动', enIcon: 'BOOT', name: zh ? '开机启动项（只读）' : 'Startup items (read-only)',
            detail: zh ? '查看启用状态和启动范围' : 'View enabled state and scope',
            supported: node.capabilities.includes('runtime.startup.read.v1'),
            action: () => setStartup(current => current ? undefined : 'preview'), expanded: Boolean(startup)},
        {icon: '更新', enIcon: 'OTA', name: zh ? '软件更新' : 'Software update',
            detail: zh ? '查看当前设备的版本、签名升级和回退记录' : 'Review versions, signed upgrades, and rollback for this device',
            supported: node.capabilities.includes('control.node.upgrade.v1'),
            action: () => setSoftwareUpdate(current => !current), expanded: softwareUpdate},
        {icon: '模型', enIcon: 'MODEL', name: zh ? '模型版本' : 'Model versions',
            detail: zh ? '查看版本记录，启用或回退已安装版本' : 'Review history and activate or roll back installed releases',
            supported: node.capabilities.includes('runtime.model.versions.v1'),
            action: () => setModelVersions(current => !current), expanded: modelVersions},
        {icon: '配置', enIcon: 'CFG', name: zh ? '配置备份' : 'Configuration backups',
            detail: zh ? '保存配置、预览差异和签名恢复' : 'Save settings, preview differences, and sign a restore',
            supported: node.capabilities.includes('runtime.config.backup.read.v1'),
            action: () => setConfigBackups(current => !current), expanded: configBackups},
        {icon: '安全', enIcon: 'SEC', name: zh ? '系统加固' : 'System hardening',
            detail: zh ? '查看当前设备的只读安全基线' : 'Review the read-only security baseline for this device',
            supported: node.capabilities.includes('runtime.security-baseline.read.v1'),
            action: () => setSecurityBaseline(current => !current), expanded: securityBaseline},
        {icon: '维护', enIcon: 'AUDIT', name: zh ? '维护记录' : 'Maintenance history',
            detail: zh ? '查询维护审批、节点回执和关联编号' : 'Review maintenance approvals, node receipts, and references',
            supported: node.capabilities.includes('runtime.maintenance.read.v1'),
            action: () => setMaintenanceHistory(current => !current), expanded: maintenanceHistory},
        {icon: '设备', enIcon: 'DEV', name: zh ? '关联设备' : 'Associated devices',
            detail: zh ? '查看摄像头、边缘设备和运行日志' : 'Review cameras, edge devices, and runtime logs',
            supported: true, action: openRelated},
        {icon: '日志', enIcon: 'LOG', name: zh ? '运行日志' : 'Runtime logs',
            detail: zh ? '查看当前机器的近期结构化事件' : 'Read recent structured events for this machine',
            supported: node.capabilities.includes('runtime.read.v1') || node.capabilities.includes('runtime.programs.read.v1'),
            action: () => openLogs()},
        {icon: 'SSH', enIcon: 'SSH', name: zh ? '终端连接' : 'Terminal connection',
            detail: zh ? '打开当前机器的受控 SSH 工具' : 'Open the controlled SSH tool for this machine',
            supported: Boolean(node.network.ssh_available), action: () => openTool('terminal')},
    ];

    return <>
        <dl className='ControlManagerSummary'>
            <div><dt>{zh ? '节点状态' : 'Node status'}</dt><dd>{directoryError
                ? (zh ? '读取失败' : 'Read failed')
                : node.online ? (zh ? '在线' : 'Online') : (zh ? '离线' : 'Offline')}</dd>
                <small>{formatTime(node.last_seen_at, zh)}</small></div>
            <div><dt>{zh ? 'SSH 控制路径' : 'SSH control route'}</dt><dd>{sshVerified
                ? (zh ? '可达' : 'Reachable') : sshFault ? (zh ? '故障' : 'Fault') : (zh ? '未验证' : 'Unverified')}
                {sshVerified && node.control_transport ? ` · ${node.control_transport}` : ''}</dd>
                <small>{formatTime(ssh?.checked_at || 0, zh)}</small></div>
            <div><dt>{zh ? '业务可用性' : 'Business availability'}</dt><dd aria-live='polite'>{businessSummary}</dd>
                {businessSnapshot && <small>{formatTime(businessSnapshot.captured_at, zh)}</small>}</div>
            <div><dt>{zh ? '资源采集' : 'Resource capture'}</dt><dd>{resourceStale
                ? (zh ? '已过期' : 'Expired') : formatTime(resourceTime, zh)}</dd>
                {resourceStale && <small>{formatTime(resourceTime, zh)}</small>}</div>
            <div><dt>{zh ? '可用磁盘空间' : 'Available disk space'}</dt><dd>{diskReported
                ? `${formatBytes(diskFree)} / ${formatBytes(diskTotal)}`
                : (zh ? '未上报' : 'Not reported')}</dd>
                {diskReported && resourceStale && <small>{zh ? '上次采集值' : 'Last collected value'}</small>}</div>
        </dl>
        <div className='ControlManagerActions'>
            <button className='primary' type='button' onClick={onCheck} disabled={!node.online || busy}>
                {checking ? (zh ? '正在自检…' : 'Checking…') : (zh ? '手动自检' : 'Run self-check')}
            </button>
            <button type='button' onClick={openOverview}>{zh ? '设备概览' : 'Device overview'}</button>
            {onShowLatest && <button type='button' onClick={onShowLatest}>{zh ? '返回最近自检' : 'Back to latest check'}</button>}
        </div>
        {runtime && programs && performance && <section className='ControlManagerChecks' aria-label={zh ? '设备自检结果' : 'Device check results'}>
            {onShowLatest && <p role='status'>{zh ? '正在查看本批次自检结果。' : 'Viewing the result from this batch.'}</p>}
            <h2>{zh ? '服务状态' : 'Service status'}</h2>
            {runtime.status === 'ready' ? <ul>{runtime.value.services.map(service => <ServiceEvidence
                key={service.service_id}
                name={service.name}
                state={service.health.state}
                checkedAt={service.health.checked_at}
                statusCode={service.health.status_code}
                zh={zh}
                openLogs={service.service_id === 'task-executor' && service.health.checked_at > 0
                    ? () => openLogs({kind: 'runtime', id: service.service_id, checkedAt: service.health.checked_at})
                    : undefined}
            />)}</ul> : <p role='status'>{checkMessage(runtime.status, zh)}</p>}
            <h2>{zh ? '业务程序' : 'Business programs'}</h2>
            {programs.status === 'ready' ? <>
                {businessPrograms.length ? <ul>{businessPrograms.map(({program, state, checkedAt}) => <ServiceEvidence
                    key={program.program_id}
                    name={program.name}
                    state={state}
                    detail={program.service.state === 'running'
                        ? (zh ? '进程运行中' : 'Process running')
                        : program.service.state === 'stopped'
                            ? (zh ? '进程已停止' : 'Process stopped')
                            : (zh ? '进程状态未知' : 'Process status unknown')}
                    checkedAt={checkedAt}
                    statusCode={program.service.state === 'stopped' ? null : program.health.status_code}
                    zh={zh}
                    openLogs={checkedAt > 0
                        ? () => openLogs({kind: 'program', id: program.program_id, checkedAt})
                        : undefined}
                />)}</ul> : <p>{zh ? '未挂载程序' : 'No mounted programs'}</p>}
                {programs.value.invalid_manifests > 0 && <p>{zh ? '无效程序清单' : 'Invalid manifests'} · {programs.value.invalid_manifests}</p>}
            </> : <p role='status'>{checkMessage(programs.status, zh)}</p>}
            <h2>{zh ? '性能诊断' : 'Performance diagnosis'}</h2>
            {performance.status === 'ready'
                ? <PerformanceDiagnosisEvidence diagnosis={performance.value} zh={zh}/>
                : <p role='status'>{checkMessage(performance.status, zh)}</p>}
        </section>}
        <section className='ControlManagerToolSection' aria-labelledby='device-manager-tools-title'>
            <h2 id='device-manager-tools-title'>{zh ? '常用工具' : 'Common tools'}</h2>
            <div className='ControlManagerToolGrid'>
                {tools.map(tool => <button key={tool.name} type='button' aria-label={tool.name}
                    aria-expanded={tool.expanded} onClick={tool.action}>
                    <span className='ControlManagerToolIcon' aria-hidden='true'>{zh ? tool.icon : tool.enIcon}</span>
                    <span className='ControlManagerToolText'><strong>{tool.name}</strong><small>{tool.detail}</small></span>
                    <span className={node.online && tool.supported ? 'available' : 'unavailable'}>
                        {!node.online ? (zh ? '离线' : 'Offline')
                            : tool.supported ? (zh ? '节点支持' : 'Supported by node') : (zh ? '查看支持范围' : 'Check support')}
                    </span>
                </button>)}
            </div>
            {softwareUpdate && <div className='ControlManagerSoftwareUpdate'><DeviceSoftwareUpdate node={node} zh={zh}/></div>}
            {modelVersions && <ModelVersionsPanel node={node} zh={zh}/>}
            {configBackups && <ConfigBackupPanel node={node} zh={zh}/>}
            {securityBaseline && <SecurityBaselinePanel node={node} zh={zh}/>}
            {maintenanceHistory && <MaintenanceHistoryPanel key={`${node.node_id}:${node.installation_id}`} node={node} zh={zh}/>}
            {startup && <div className='ControlManagerStartup'>
                <header>
                    <div>
                        <strong>{startup === 'manage' ? (zh ? '启动项管理' : 'Startup management') : (zh ? '启动项只读预览' : 'Startup item preview')}</strong>
                        <small>{startupManageable
                            ? (zh ? '禁用或恢复前需逐项签名授权。' : 'Disabling or restoring an item requires a separate signed approval.')
                            : (zh ? '当前节点暂不可管理启动项。' : 'Startup management is unavailable for this node.')}</small>
                    </div>
                    {startupManageable && <button type='button' onClick={() => setStartup(startup === 'manage' ? 'preview' : 'manage')}>
                        {startup === 'manage' ? (zh ? '返回只读预览' : 'Return to preview') : (zh ? '进入启动项管理' : 'Manage startup items')}
                    </button>}
                </header>
                <StartupItemsPanel node={node} zh={zh} visible readOnly={startup !== 'manage'}/>
            </div>}
        </section>
        <section className='ControlManagerHistory' aria-labelledby='device-check-history-title'>
            <h2 id='device-check-history-title'>{zh ? '最近自检记录' : 'Recent self-checks'}</h2>
            {history.length > 0 ? <ul>{history.map(item => <li key={item.id}>
                <time dateTime={new Date(item.finishedAt * 1000).toISOString()}>{formatTime(item.finishedAt, zh)}</time>
                <strong>{checkSummaryLabel(item.status, zh)}</strong>
                <small>{zh ? `${item.faults} 项故障或告警` : `${item.faults} faults or warnings`}</small>
                {item.log && <button type='button' onClick={() => openLogs(item.log)}>
                    {zh ? '查看关联日志' : 'View linked logs'}
                </button>}
            </li>)}</ul> : <p>{zh ? '此机器暂无自检记录。' : 'No self-check records for this machine.'}</p>}
        </section>
    </>;
};
