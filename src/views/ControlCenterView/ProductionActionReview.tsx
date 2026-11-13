import React, {useEffect, useRef, useState} from 'react';
import {ComputeClusterService, ProductionOperationProposal} from '../../services/ComputeClusterService';
import {APPROVAL_IDENTITY_CHANGED, getApprovalIdentity, signAuthorization} from '../../services/ApprovalIdentityService';
import './ProductionActionReview.scss';

const OPERATIONS: Record<string, {label: string; en: string; authorization: string}> = {
    storage_scan: {label: '扫描存储', en: 'Scan storage', authorization: 'agentos.storage.scan'},
    duplicate_scan: {label: '扫描重复文件', en: 'Find duplicate files', authorization: 'agentos.duplicate.scan'},
    startup_set: {label: '修改启动项', en: 'Change startup item', authorization: 'agentos.startup.set_enabled'},
    performance_apply: {label: '切换性能模式', en: 'Change performance mode', authorization: 'agentos.performance.mode_apply'},
    upgrade: {label: '升级软件', en: 'Upgrade software', authorization: 'node.upgrade'},
    model_activate: {label: '切换模型版本', en: 'Activate model version', authorization: 'model.version.change'},
    model_rollback: {label: '回退模型版本', en: 'Roll back model', authorization: 'model.version.change'},
    config_restore: {label: '恢复配置', en: 'Restore configuration', authorization: 'config.restore.apply'},
};

const STATES: Record<string, string> = {awaiting_review: '待审查', preparing: '正在准备授权', prepared: '待签名', submitting: '正在提交', submitted: '已提交', rejected: '已拒绝', prepare_failed: '准备失败', outcome_unknown: '执行结果待查', pending: '待签名', approved: '已批准', executing: '正在执行', succeeded: '执行成功', failed: '执行失败', expired: '授权过期', normal: '动作复验通过', unknown: '证据不足', not_ready: '等待执行结果'};

const FIELDS: Record<string, string> = {
    roots: '扫描目录', min_file_bytes: '文件阈值（字节）', max_results: '最多结果', max_groups: '最多重复组',
    item_id: '启动项标识', enabled: '目标启用状态', expected_enabled: '当前启用状态',
    expected_current_mode: '当前性能模式', target_mode: '目标性能模式',
    model_id: '模型', license_id: '目标版本标识', expected_license_id: '当前版本标识', rollback: '回退',
    backup_id: '配置备份', release_version: '目标软件版本', platform: '系统', architecture: '架构',
    drain_timeout_seconds: '等待任务结束（秒）', name: '名称', requires_restart: '需要重启',
};

const targetRows = (proposal: ProductionOperationProposal): [string, string][] => {
    const payload = proposal.target as {request?: {arguments?: object}; manifest?: object};
    const values = {...(payload.request?.arguments || payload.request || payload), ...payload.manifest,
        ...proposal.authorization?.target, ...proposal.authorization?.parameters};
    return Object.entries(values).filter(([key]) => key in FIELDS).map(([key, value]) => [key,
        key === 'roots' && Array.isArray(value)
            ? value.map(root => root.path).join(', ')
            : String(value === null ? '—' : value).slice(0, 1024)]);
};

const validProposal = (value: ProductionOperationProposal, id: string): boolean =>
    value?.schema_version === 'production.action-proposal.v1' && value.proposal_id === id
    && /^[0-9a-f-]{36}$/.test(value.node_id) && !!OPERATIONS[value.operation]
    && !!value.target && typeof value.target === 'object'
    && (!value.authorization || (value.authorization.target_installation_id === value.node_id
        && value.authorization.operation === OPERATIONS[value.operation].authorization));

const stateLabel = (proposal: ProductionOperationProposal, zh: boolean): string => {
    const state = proposal.execution?.post_verification?.state || proposal.execution?.state || proposal.state;
    return zh ? (STATES[state] || state) : state;
};

const ReviewTarget = ({proposal, nodes, zh}: {
    proposal: ProductionOperationProposal; nodes: {node_id: string; name: string}[]; zh: boolean;
}) => <>
    <h3>{zh ? OPERATIONS[proposal.operation].label : OPERATIONS[proposal.operation].en}</h3>
    <p>{nodes.find(node => node.node_id === proposal.node_id)?.name || proposal.node_id}</p>
    <dl>{targetRows(proposal).map(([key, value]) => <div key={key}><dt>{zh ? FIELDS[key] : key}</dt><dd>{value}</dd></div>)}</dl>
    {proposal.operation === 'upgrade' && <p>{zh ? '升级可能中断程序并重启设备。请核对目标版本和生产窗口。' : 'An upgrade may interrupt programs and restart this device. Check the version and production window.'}</p>}
    <p role='status'>{zh ? '请求状态' : 'Request state'}: {stateLabel(proposal, zh)}</p>
</>;

const ReviewActions = ({proposal, busy, zh, prepare, approve, reject, refresh}: {
    proposal: ProductionOperationProposal; busy: boolean; zh: boolean;
    prepare: () => void; approve: () => void; reject: () => void; refresh: () => void;
}) => <>
    {proposal.state === 'awaiting_review' && <button type='button' disabled={busy} onClick={prepare}>
        {zh ? '读取实际目标并准备授权' : 'Inspect target and prepare approval'}
    </button>}
    {proposal.state === 'prepared' && proposal.authorization && <>
        <p>{zh ? '请核对实际目标，签名后将执行以上操作。' : 'Check the actual target. Signing will execute this operation.'}</p>
        <button className='primary' type='button' disabled={busy} onClick={approve}>{zh ? '同意并执行' : 'Approve and execute'}</button>
    </>}
    {['awaiting_review', 'prepared'].includes(proposal.state) && <button type='button' disabled={busy} onClick={reject}>{zh ? '拒绝' : 'Reject'}</button>}
    <button type='button' disabled={busy} onClick={refresh}>{zh ? '刷新执行与复验结果' : 'Refresh execution and verification'}</button>
</>;

export const ProductionActionReview = ({nodes, zh}: {nodes: {node_id: string; name: string}[]; zh: boolean}) => {
    const [query] = useState(() => new URLSearchParams(window.location.search));
    const id = query.get('ops_proposal') || '';
    const project = query.get('ops_project') || 'default-project';
    const [proposal, setProposal] = useState<ProductionOperationProposal>();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [closed, setClosed] = useState(false);
    const [identityGeneration, setIdentityGeneration] = useState(0);
    const dialog = useRef<HTMLDialogElement>(null);
    const activeGeneration = useRef(0);
    const validId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id);

    const accept = (value: ProductionOperationProposal) => {
        if (!validProposal(value, id)) throw new Error('operation_proposal_scope_mismatch');
        setProposal(value);
    };
    const perform = async (action: () => Promise<ProductionOperationProposal>) => {
        if (busy) return;
        setBusy(true);
        setError('');
        const startedGeneration = activeGeneration.current;
        try {
            const value = await action();
            if (startedGeneration === activeGeneration.current) accept(value);
        } catch (reason) {
            if (startedGeneration === activeGeneration.current) setError(reason instanceof Error ? reason.message : String(reason));
        }
        finally { setBusy(false); }
    };
    const close = () => {
        setClosed(true);
        const url = new URL(window.location.href);
        url.searchParams.delete('ops_proposal'); url.searchParams.delete('ops_project');
        window.history.replaceState(null, '', url);
    };
    const approve = () => perform(async () => {
        if (!proposal?.authorization || !validProposal(proposal, id)) throw new Error('operation_authorization_missing');
        const startedGeneration = activeGeneration.current;
        const signature = await signAuthorization(proposal.authorization);
        if (startedGeneration !== activeGeneration.current) throw new Error('approval_identity_changed');
        return ComputeClusterService.approveOperationProposal(id, project, signature);
    });

    useEffect(() => {
        const changed = () => { activeGeneration.current += 1; setProposal(undefined); setIdentityGeneration(value => value + 1); };
        window.addEventListener(APPROVAL_IDENTITY_CHANGED, changed);
        return () => window.removeEventListener(APPROVAL_IDENTITY_CHANGED, changed);
    }, []);
    useEffect(() => {
        if (!validId || closed) return undefined;
        const controller = new AbortController();
        ComputeClusterService.operationProposal(id, project, controller.signal).then(value => {
            if (!controller.signal.aborted) accept(value);
        }).catch(reason => { if (!controller.signal.aborted) setError(String(reason)); });
        const element = dialog.current;
        if (element && !element.open) {
            if (element.showModal) element.showModal(); else element.setAttribute('open', '');
        }
        return () => controller.abort();
    }, [id, project, validId, closed, identityGeneration]);

    if (!validId || closed) return null;
    return <dialog ref={dialog} className='ControlResourceMonitor ProductionActionReview' aria-labelledby='production-review-title'
        onCancel={event => { event.preventDefault(); close(); }}>
        <header>
            <div><h2 id='production-review-title'>{zh ? '设备操作审查' : 'Review device operation'}</h2></div>
            <button type='button' onClick={close} aria-label={zh ? '关闭审查' : 'Close review'}>×</button>
        </header>
        <div className='ProductionActionReviewBody'>
            {error && <p role='alert'>{error}</p>}
            {!proposal ? <p role='status'>{zh ? '正在读取请求…' : 'Loading request…'}</p> : <>
                <ReviewTarget proposal={proposal} nodes={nodes} zh={zh}/>
                <ReviewActions proposal={proposal} busy={busy} zh={zh} approve={approve}
                    prepare={() => perform(() => ComputeClusterService.prepareOperationProposal(id, project, getApprovalIdentity().user))}
                    reject={() => perform(() => ComputeClusterService.rejectOperationProposal(id, project))}
                    refresh={() => perform(() => ComputeClusterService.operationProposal(id, project))}/>
            </>}
        </div>
    </dialog>;
};
