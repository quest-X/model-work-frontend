import React, {useEffect, useMemo, useState} from 'react';
import {
    ComputeClusterNode,
    computeNodeUpgradeAvailable,
    computeNodeUpgradeReady,
    compareNodeVersions,
    ComputeClusterService,
    ComputeUpgradeBatch,
    ComputeUpgradeBatchNode,
    ComputeUpgradeManifest,
} from '../../../services/ComputeClusterService';
import {ApprovalIdentityPanel} from '../../Common/ApprovalIdentityPanel';

export const ACTIVE_BATCH_KEY = 'opensight.compute-upgrade-batch.v1';
const manifestKey = (manifest: ComputeUpgradeManifest): string =>
    `${manifest.platform}/${manifest.architecture}`;
const architecture = (value: string): string => ({amd64: 'x86_64', arm64: 'aarch64'}[value.toLowerCase()] || value.toLowerCase());
const nodeKey = (node: ComputeClusterNode): string =>
    `${node.resources.platform.toLowerCase()}/${architecture(node.resources.architecture)}`;

// eslint-disable-next-line complexity
const stateLabel = (state: string, zh: boolean, errorCode?: string | null): string => {
    if (state === 'approval_submitting' && errorCode === 'upgrade_delivery_uncertain') {
        return zh ? '等待节点确认' : 'Waiting for node confirmation';
    }
    return ({
        awaiting_authorization: zh ? '等待批次确认' : 'Awaiting batch approval',
        authorized: zh ? '已确认，等待自动升级' : 'Approved, waiting to upgrade',
        approval_submitting: zh ? '正在提交授权' : 'Submitting approval',
        running: zh ? '升级中' : 'Upgrading',
        queued: zh ? '已排队' : 'Queued',
        draining: zh ? '等待任务结束' : 'Draining',
        downloading: zh ? '下载中' : 'Downloading',
        prepared: zh ? '已准备' : 'Prepared',
        installing: zh ? '安装中' : 'Installing',
        checking: zh ? '健康检查' : 'Health check',
        rolling_back: zh ? '正在回退' : 'Rolling back',
        recovery_required: zh ? '需要人工恢复' : 'Recovery required',
        rolled_back: zh ? '已回退' : 'Rolled back',
        succeeded: zh ? '成功' : 'Succeeded',
        failed: zh ? '失败' : 'Failed',
        cancelled: zh ? '已取消' : 'Cancelled',
        rejected: zh ? '已拒绝' : 'Rejected',
    }[state] || state);
};

const errorLabel = (code: string, zh: boolean): string => ({
    authorization_user_unknown: zh ? '审批身份未登记到目标节点' : 'Approval identity is not registered on the target node',
    authorization_user_revoked: zh ? '审批身份已被禁用' : 'Approval identity has been disabled',
    authorization_user_mismatch: zh ? '审批身份与已登记信息不一致' : 'Approval identity does not match the registered identity',
    authorization_scope_denied: zh ? '审批身份无节点升级权限' : 'Approval identity cannot authorize node upgrades',
    authorization_signature_invalid: zh ? '审批签名无效' : 'Approval signature is invalid',
    authorization_expired: zh ? '审批已过期' : 'Approval has expired',
    upgrade_delivery_uncertain: zh ? '尚未确认节点是否已收到升级任务' : 'Node receipt of the upgrade task is not confirmed yet',
    upgrade_delivery_unconfirmed: zh ? '未能确认节点是否收到升级任务' : 'Could not confirm whether the node received the upgrade task',
    upgrade_source_version_unsupported: zh ? '节点版本不在此升级包支持范围' : 'The node version is outside this release package support range',
}[code] || '');

const processEvents = (
    batch: ComputeUpgradeBatch,
    node: ComputeUpgradeBatchNode,
): {state: string; created_at: number; error_code: string | null}[] => {
    const events: {state: string; created_at: number; error_code: string | null}[] = [
        {state: 'awaiting_authorization', created_at: batch.created_at, error_code: null},
    ];
    const deliveryStartedAt = node.delivery_started_at
        ?? (node.result?.events?.length ? undefined : batch.delivery_started_at);
    if (typeof deliveryStartedAt === 'number' && Number.isFinite(deliveryStartedAt)) {
        events.push({state: 'approval_submitting', created_at: deliveryStartedAt, error_code: null});
    }
    events.push(...(node.result?.events || []));
    const last = events[events.length - 1];
    if (last.state !== node.state || last.error_code !== node.error_code) {
        events.push({
            state: node.state,
            created_at: node.result?.updated_at || batch.updated_at,
            error_code: node.error_code,
        });
    }
    return events.filter((event, position) => position === 0
        || event.state !== events[position - 1].state
        || event.error_code !== events[position - 1].error_code);
};

// The compact panel owns its one batch lifecycle, including restart recovery and approval.
export const ComputeUpgradePanel: React.FC<{
    nodes: ComputeClusterNode[];
    releases: ComputeUpgradeManifest[];
    releasesLoading: boolean;
    releasesError: string;
    refreshReleases: () => Promise<void>;
    selected: string[];
    zh: boolean;
}> = ({nodes, releases, releasesLoading, releasesError, refreshReleases, selected, zh}) => { // eslint-disable-line complexity
    const [release, setRelease] = useState('');
    const manifests = useMemo(() => Object.fromEntries(releases.filter(item => item.release_version === release)
        .map(item => [manifestKey(item), item])), [releases, release]);
    const versions = Array.from(new Set(releases.map(item => item.release_version)));
    const [batch, setBatch] = useState<ComputeUpgradeBatch | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const eligible = useMemo(() => nodes.filter(computeNodeUpgradeReady), [nodes]);

    useEffect(() => {
        const batchId = localStorage.getItem(ACTIVE_BATCH_KEY);
        if (!batchId) return;
        void ComputeClusterService.upgradeBatch(batchId).then(setBatch).catch(reason => {
            // An observation outage is not proof the durable batch disappeared.
            setError(reason instanceof Error ? reason.message : String(reason));
        });
    }, []);

    useEffect(() => {
        if (!batch || !['authorized', 'running', 'approval_submitting'].includes(batch.state)) return undefined;
        let disposed = false;
        let timer: number;
        const poll = async () => {
            try {
                const next = await ComputeClusterService.upgradeBatch(batch.batch_id);
                if (!disposed) setBatch(next);
            } catch (reason) {
                if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
            } finally {
                if (!disposed) timer = window.setTimeout(() => void poll(), 2000);
            }
        };
        timer = window.setTimeout(() => void poll(), 2000);
        return () => { disposed = true; window.clearTimeout(timer); };
    }, [batch?.batch_id, batch?.state]);

    useEffect(() => {
        setRelease(current => releases.some(item => item.release_version === current) ? current : '');
    }, [releases]);

    const compatible = (node: ComputeClusterNode): boolean => {
        const manifest = manifests[nodeKey(node)];
        return Boolean(manifest && computeNodeUpgradeAvailable(node, [manifest]));
    };

    const compatibilityLabel = (node: ComputeClusterNode): string => {
        if (!release) return zh ? '请先选择版本' : 'Select a release first';
        const manifest = manifests[nodeKey(node)];
        if (!manifest) return zh ? '该版本不适用于此节点' : 'Release unavailable for this node';
        const targetComparison = compareNodeVersions(node.agent_version, manifest.release_version);
        if (targetComparison === 0) return zh ? '已是目标版本，无需升级' : 'Already on the target version';
        if (targetComparison > 0) return zh ? '当前版本高于目标版本' : 'Current version is newer than the target';
        return compatible(node)
            ? (zh ? '可从当前控制端升级' : 'Ready from this controller')
            : (zh ? '节点版本不在升级包支持范围' : 'Node version is outside the supported range');
    };

    const start = async () => {
        setBusy(true);
        setError('');
        try {
            const created = await ComputeClusterService.createMainUpgradeBatch(selected, release);
            localStorage.setItem(ACTIVE_BATCH_KEY, created.batch_id);
            setBatch(created);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    };

    const approve = async () => {
        if (!batch) return;
        const targets = batch.nodes.slice(batch.current_index).map(item => {
            const node = nodes.find(candidate => candidate.node_id === item.node_id);
            return `${node?.name || item.node_id} (${item.node_id})\nv${item.manifest.release_version} · ${item.manifest.platform}/${item.manifest.architecture}\nSHA-256 ${item.manifest.sha256}`;
        }).join('\n\n');
        if (!window.confirm(`${zh ? '一次批准以下整个升级批次' : 'Approve this entire upgrade batch once'}\n\n${targets}\n\n${zh ? '授权截止' : 'Approval expires'}: ${new Date(batch.expires_at * 1000).toLocaleString()}\n${zh ? '等待任务结束上限' : 'Drain timeout'}: ${batch.drain_timeout_seconds}s\n${zh ? '按所列顺序自动逐台升级，失败即停；仅这些机器、这些版本、本批次有效。' : 'Upgrade in the listed order, stop on failure. Only these machines and releases, one use each.'}`)) return;
        setBusy(true);
        setError('');
        try {
            setBatch(await ComputeClusterService.approveUpgradeBatch(batch));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    };

    const reject = async () => {
        if (!batch) return;
        setBusy(true);
        setError('');
        try {
            setBatch(await ComputeClusterService.rejectUpgradeBatch(batch.batch_id));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    };

    return <section className='ComputeUpgradePanel'>
        <header>
            <div><span>OTA</span><h3>{zh ? '一键升级节点' : 'One-confirmation node upgrade'}</h3></div>
            <p>{zh ? '一次确认整个批次，服务端自动逐台升级，关闭页面也可继续；上一台验收成功才进入下一台，失败立即停批。' : 'Confirm the batch once. The server continues even after this page closes; each node must pass health acceptance before the next starts.'}</p>
        </header>
        <ApprovalIdentityPanel zh={zh}/>
        {!batch && <>
            <div className='ComputeUpgradeManifestInput'>
                <label htmlFor='compute-main-release'>{zh ? '当前控制端的升级版本' : 'Release on this controller'}</label>
                <select id='compute-main-release' value={release} disabled={releasesLoading || busy} onChange={event => {
                    setRelease(event.target.value);
                }}>
                    <option value=''>{releasesLoading ? (zh ? '正在读取控制端安装包…' : 'Loading controller packages…') : (zh ? '请选择目标版本' : 'Select target version')}</option>
                    {versions.map(version => <option key={version} value={version}>v{version}</option>)}
                </select>
                <button type='button' disabled={releasesLoading || busy} onClick={() => void refreshReleases()}>{zh ? '刷新版本' : 'Refresh releases'}</button>
                <small>{zh ? '安装包由当前控制端分发，发布信息和校验由系统自动处理。' : 'This controller distributes the package and handles release metadata and verification.'}</small>
                {!releasesLoading && !releasesError && versions.length === 0 && <p role='status'>{zh ? '当前控制端尚未发布可用安装包。请先发布目标版本，再刷新列表。' : 'No packages published on this controller. Publish a target release, then refresh.'}</p>}
            </div>
            <div className='ComputeUpgradeSelection'>
                <div><strong>{zh ? `已选择 ${selected.length} 台设备` : `${selected.length} devices selected`}</strong><small>{zh ? '在下方作业区中勾选升级设备。' : 'Select upgrade devices in the work areas below.'}</small></div>
                {selected.map(nodeId => {
                    const node = eligible.find(item => item.node_id === nodeId);
                    return node && <article key={node.node_id}>
                    <div><strong>{node.name}</strong><small>{node.resources.platform} · {node.resources.architecture}</small></div>
                    <div className='ComputeUpgradeNodeState'>
                        <strong>{zh ? '当前版本' : 'Current version'} v{node.agent_version}</strong>
                        <span>{compatibilityLabel(node)}</span>
                    </div>
                </article>;
                })}
                {eligible.length === 0 && <p>{zh ? '没有已启用 OTA、非异常且可联通的节点。' : 'No enabled, reachable, non-abnormal OTA nodes.'}</p>}
            </div>
            <button type='button' disabled={busy || releasesLoading || !release || selected.length === 0 || selected.some(id => {
                const node = eligible.find(item => item.node_id === id);
                return !node || !compatible(node);
            })} onClick={() => void start()}>{busy ? (zh ? '创建中…' : 'Creating…') : (zh ? '创建升级批次' : 'Create upgrade batch')}</button>
        </>}
        {batch && <div className='ComputeUpgradeBatch'>
            <div><strong>v{batch.release_version}</strong><span>{stateLabel(batch.state, zh, batch.error_code)}</span><code>{batch.batch_id.slice(0, 8)}</code></div>
            {batch.nodes.map((item, index) => {
                const events = processEvents(batch, item);
                return <article key={item.job_id} className={index === batch.current_index ? 'current' : ''}>
                    <span>{index + 1}</span>
                    <div><strong>{nodes.find(node => node.node_id === item.node_id)?.name || item.node_id}</strong><small>{item.manifest.platform} · {item.manifest.architecture}</small></div>
                    <span>{stateLabel(item.state, zh, item.error_code)}{item.error_code && <>
                        {' · '}{errorLabel(item.error_code, zh) && <>{errorLabel(item.error_code, zh)} · </>}<code>{item.error_code}</code>
                    </>}</span>
                    <details className='ComputeUpgradeLog' open={index === batch.current_index}>
                        <summary>{zh ? '升级过程日志' : 'Upgrade process log'} <span>{events.length}</span></summary>
                        <ol role='list' aria-live='polite' aria-label={zh ? '升级过程日志' : 'Upgrade process log'}>{events.map((event, position) => <li key={`${event.created_at}-${event.state}-${position}`}>
                            <time dateTime={new Date(event.created_at * 1000).toISOString()}>{new Date(event.created_at * 1000).toLocaleString()}</time>
                            <span>{stateLabel(event.state, zh, event.error_code)}</span>
                            {event.error_code && <span>{errorLabel(event.error_code, zh) && <>{errorLabel(event.error_code, zh)} · </>}<code>{event.error_code}</code></span>}
                        </li>)}</ol>
                        {!item.result?.events?.length && item.state !== 'awaiting_authorization'
                            && <small>{zh ? '未收到节点阶段记录；以上为主控已确认的过程。' : 'No node event history received; showing controller-confirmed progress.'}</small>}
                        {item.result?.events_truncated
                            && <small>{zh ? '记录过多，仅显示最近 1024 条。' : 'Too many entries; showing the latest 1024.'}</small>}
                    </details>
                </article>;
            })}
            {batch.state === 'awaiting_authorization' && <div className='ComputeUpgradeActions'>
                <button type='button' disabled={busy} onClick={() => void approve()}>{zh ? '确认整个升级批次' : 'Approve entire batch'}</button>
                <button type='button' className='danger' disabled={busy} onClick={() => void reject()}>{zh ? '拒绝并停批' : 'Reject and stop'}</button>
            </div>}
            {['succeeded', 'failed'].includes(batch.state) && <button type='button' onClick={() => {
                localStorage.removeItem(ACTIVE_BATCH_KEY);
                setBatch(null);
            }}>{zh ? '关闭批次记录' : 'Close batch record'}</button>}
        </div>}
        {(error || releasesError) && <p className='ComputeClusterError' role='alert'>{error || releasesError}</p>}
    </section>;
};
