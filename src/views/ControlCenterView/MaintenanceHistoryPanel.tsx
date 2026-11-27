import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ACCOUNT_SESSION_CHANGED} from '../../services/AccountService';
import {
    ComputeClusterNode, ComputeClusterService, ComputeUpgradeResult, isComputeAccessDenied, MaintenanceEvent,
    MaintenancePage, MaintenanceSource,
} from '../../services/ComputeClusterService';
import {upgradeStateLabel} from '../PopupView/ComputeClusterPopup/ComputeUpgradePanel';

const operations: Record<MaintenanceEvent['operation'], [string, string]> = {
    'agentos.startup.set_enabled': ['启动项变更', 'Startup item change'],
    'node.upgrade': ['节点软件更新', 'Node software update'],
    'model.version.change': ['模型版本变更', 'Model version change'],
    'model.delivery.commit': ['模型包安装', 'Model package installation'],
    'config.restore.apply': ['配置恢复', 'Configuration restore'],
};
const states = {
    pending: ['待审批', 'Awaiting approval'],
    approved: ['已审批', 'Approved'],
    executing: ['开始执行', 'Execution started'],
    succeeded: ['已记录执行回执', 'Execution receipt recorded'],
    failed: ['已记录失败', 'Failure recorded'],
    rejected: ['审批已拒绝或取消', 'Approval rejected or cancelled'],
    expired: ['审批已过期', 'Approval expired'],
    unrecognized: ['阶段无法确认', 'Stage unconfirmed'],
} as const;
const fields = {
    item_id: ['启动项编号', 'Startup item ID'],
    request_id: ['请求编号', 'Request ID'],
    release_version: ['目标版本', 'Target version'],
    job_id: ['升级任务编号', 'Upgrade job ID'],
    model_id: ['模型标识', 'Model ID'],
    license_id: ['模型许可编号', 'Model license ID'],
    backup_id: ['配置备份编号', 'Configuration backup ID'],
} as const;

const JobEvidence = ({nodeId, jobId, version, zh}: {nodeId: string; jobId: string; version?: string; zh: boolean}) => {
    const [result, setResult] = useState<ComputeUpgradeResult>();
    const [error, setError] = useState(false);
    const [busy, setBusy] = useState(false);
    const request = useRef<AbortController>();
    useEffect(() => () => request.current?.abort(), []);

    const load = () => {
        if (request.current) return;
        const controller = new AbortController();
        request.current = controller;
        setBusy(true);
        setError(false);
        setResult(undefined);
        void ComputeClusterService.upgradeJob(nodeId, jobId, controller.signal).then(data => {
            if (controller.signal.aborted) return;
            if (data.job_id !== jobId || (version && data.release_version !== version)) {
                setError(true);
                return;
            }
            setResult(data);
        }).catch(() => {
            if (!controller.signal.aborted) setError(true);
        }).finally(() => {
            request.current = undefined;
            if (!controller.signal.aborted) setBusy(false);
        });
    };

    return <>
        <button type='button' onClick={load} disabled={busy}>{zh ? '查询实际升级状态' : 'Check actual upgrade status'}</button>
        {busy && <small role='status'>{zh ? '正在读取升级任务…' : 'Reading upgrade job…'}</small>}
        {error && <small role='alert'>{zh ? '暂无法确认升级任务状态。' : 'Upgrade job status could not be confirmed.'}</small>}
        {result && <small role='status'>{zh ? '升级任务' : 'Upgrade job'} · {upgradeStateLabel(result.state, zh, result.error_code)}</small>}
    </>;
};

const AuditRow = ({event, nodeId, zh}: {event: MaintenanceEvent; nodeId: string; zh: boolean}) => {
    const lang = zh ? 0 : 1;
    const jobId = event.reference.job_id;
    const stage = event.operation === 'node.upgrade' && event.state === 'succeeded'
        ? (zh ? '升级任务已接收' : 'Upgrade job accepted') : states[event.state][lang];
    return <li>
        <div>
            <strong>{operations[event.operation][lang]}</strong>
            <small>{new Date(event.created_at * 1000).toLocaleString(zh ? 'zh-CN' : 'en-US')}</small>
            <details>
                <summary>{zh ? '关联证据' : 'Evidence references'}</summary>
                <dl>
                    <dt>{zh ? '审批编号' : 'Approval ID'}</dt><dd><code>{event.authorization_id ?? '—'}</code></dd>
                    <dt>{zh ? '记录身份' : 'Recorded identity'}</dt><dd><code>{event.user_id ?? '—'}</code></dd>
                    {Object.entries(event.reference).map(([field, value]) => <React.Fragment key={field}>
                        <dt>{fields[field as keyof typeof fields][lang]}</dt><dd><code>{value}</code></dd>
                    </React.Fragment>)}
                    {event.error_code && <><dt>{zh ? '原因代码' : 'Reason code'}</dt><dd><code>{event.error_code}</code></dd></>}
                </dl>
                {jobId && event.state === 'succeeded' && <JobEvidence nodeId={nodeId} jobId={jobId}
                    version={event.reference.release_version} zh={zh}/>}
            </details>
        </div>
        <span>{stage}</span>
    </li>;
};

const AuditSource = ({node, source, zh}: {node: ComputeClusterNode; source: MaintenanceSource; zh: boolean}) => {
    const [before, setBefore] = useState<number | null>(null);
    const [revision, setRevision] = useState(0);
    const [page, setPage] = useState<MaintenancePage>();
    const [error, setError] = useState<'denied' | 'failed'>();
    const {node_id: nodeId, installation_id: installationId} = node;

    const reload = useCallback(() => {
        setPage(undefined);
        setError(undefined);
        setBefore(null);
        setRevision(current => current + 1);
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        const sessionChanged = () => {
            controller.abort();
            reload();
        };
        window.addEventListener(ACCOUNT_SESSION_CHANGED, sessionChanged);
        void ComputeClusterService.maintenanceEvents(nodeId, source, before, controller.signal).then(data => {
            if (controller.signal.aborted) return;
            if (data.schema_version !== 'runtime.maintenance.events.v1' || data.installation_id !== installationId || data.source !== source) {
                setError('failed');
                return;
            }
            setPage(data);
        }).catch(reason => {
            if (!controller.signal.aborted) setError(isComputeAccessDenied(reason) ? 'denied' : 'failed');
        });
        return () => {
            controller.abort();
            window.removeEventListener(ACCOUNT_SESSION_CHANGED, sessionChanged);
        };
    }, [before, installationId, nodeId, reload, revision, source]);

    const next = page?.next_before ?? null;
    return <>
        <div className='ControlMaintenanceActions'>
            <button type='button' onClick={reload} disabled={!page && !error}>{zh ? '刷新最新记录' : 'Refresh latest records'}</button>
            <button type='button' disabled={next === null} onClick={() => {
                setPage(undefined);
                setBefore(next);
            }}>{zh ? '更早记录' : 'Older records'}</button>
        </div>
        {!page && !error && <p role='status'>{zh ? '正在读取维护记录…' : 'Reading maintenance history…'}</p>}
        {error === 'denied' && <p role='alert'>{zh ? '当前账号无权读取此设备的维护记录。' : 'Your account cannot read maintenance history for this device.'}</p>}
        {error === 'failed' && <p role='alert'>{zh ? '维护记录读取失败，请重试。' : 'Maintenance history could not be read. Try again.'}</p>}
        {page && (page.events.length ? <ul>{page.events.map(event => <AuditRow key={event.event_id} event={event} nodeId={nodeId} zh={zh}/>)}</ul>
            : <p>{zh ? '当前来源暂无维护记录。' : 'No maintenance records from this source.'}</p>)}
    </>;
};

export const MaintenanceHistoryPanel = ({node, zh}: {node: ComputeClusterNode; zh: boolean}) => {
    const [source, setSource] = useState<MaintenanceSource>('controller');
    const nodeReadable = node.capabilities.includes('runtime.maintenance.read.v1') && (node.online || node.network.ssh_available);
    return <section className='ControlManagerMaintenance' aria-label={zh ? '当前设备的维护记录' : 'Maintenance history for this device'}>
        <h3>{zh ? '维护记录' : 'Maintenance history'}</h3>
        <p>{zh ? '同一审批编号可在控制端与节点记录中核对。升级完成情况以任务状态为准。'
            : 'Match controller and node entries by approval ID. Check the upgrade job for the final result.'}</p>
        <div className='ControlMaintenanceActions'>
            <button type='button' aria-pressed={source === 'controller'} onClick={() => setSource('controller')}>
                {zh ? '控制端记录' : 'Controller records'}
            </button>
            <button type='button' aria-pressed={source === 'node'} onClick={() => setSource('node')}>
                {zh ? '节点记录' : 'Node records'}
            </button>
        </div>
        {source === 'node' && !nodeReadable
            ? <p role='status'>{zh ? '当前节点不可达或版本尚不支持维护记录。' : 'The node is unreachable or does not support maintenance history.'}</p>
            : <AuditSource key={source} node={node} source={source} zh={zh}/>}
    </section>;
};
