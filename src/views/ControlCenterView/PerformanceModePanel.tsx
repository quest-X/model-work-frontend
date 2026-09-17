import {Button, Dialog, DialogActions, DialogContent, DialogTitle} from '@mui/material';
import React, {useState} from 'react';
import {v4 as uuidv4} from 'uuid';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeLanAsset,
    ComputePerformanceMode,
    ComputePerformanceModeAuthorizationResult,
    ComputePerformanceModeCheck,
    ComputePerformanceModeRequest,
} from '../../services/ComputeClusterService';
import {
    canonicalAuthorizationJson,
    getApprovalIdentity,
    signAuthorization,
} from '../../services/ApprovalIdentityService';

interface IProps {
    nodes: ComputeClusterNode[];
    lanAssets?: ComputeLanAsset[];
    zh: boolean;
    visible: boolean;
}

type Inspection = {
    result?: ComputePerformanceMode;
    error?: 'offline' | 'unsupported' | 'failed';
};

type PerformanceModeScan = {
    nodeKey: string;
    scannedAt?: number;
    inspections: Record<string, Inspection>;
};

type PendingOptimization = {
    node: ComputeClusterNode;
    created: ComputePerformanceModeAuthorizationResult;
};

const PERFORMANCE_MODE_SCAN_KEY = 'opensight.control-center.performance-mode-scan.v1';

const local = (zh: boolean, chinese: string, english: string): string =>
    zh ? chinese : english;

const performanceModeNodeKey = (nodes: ComputeClusterNode[]): string =>
    nodes.map(node => node.node_id).sort().join('|');

const isInspection = (value: unknown): value is Inspection => {
    if (!value || typeof value !== 'object') return false;
    const inspection = value as Inspection;
    if (inspection.error) return ['offline', 'unsupported', 'failed'].includes(inspection.error);
    return inspection.result?.schema_version === 'performance.mode-result.v1'
        && Array.isArray(inspection.result.checks);
};

const cachedPerformanceModeScan = (nodes: ComputeClusterNode[]): PerformanceModeScan => {
    const nodeKey = performanceModeNodeKey(nodes);
    try {
        const stored = JSON.parse(window.localStorage.getItem(PERFORMANCE_MODE_SCAN_KEY) || 'null') as {
            version?: number;
            node_key?: string;
            scanned_at?: number;
            inspections?: Record<string, Inspection>;
        } | null;
        if (
            stored?.version !== 1
            || stored.node_key !== nodeKey
            || !Number.isFinite(stored.scanned_at)
            || !stored.inspections
            || Object.keys(stored.inspections).sort().join('|') !== nodeKey
            || !Object.values(stored.inspections).every(isInspection)
        ) return {nodeKey, inspections: {}};
        return {
            nodeKey,
            scannedAt: stored.scanned_at,
            inspections: stored.inspections,
        };
    } catch {
        return {nodeKey, inspections: {}};
    }
};

const cachePerformanceModeScan = (scan: Required<PerformanceModeScan>) => {
    try {
        window.localStorage.setItem(PERFORMANCE_MODE_SCAN_KEY, JSON.stringify({
            version: 1,
            node_key: scan.nodeKey,
            scanned_at: scan.scannedAt,
            inspections: scan.inspections,
        }));
    } catch {
        // The current scan remains available even when browser storage is unavailable.
    }
};

const modeLabel = (mode: string, zh: boolean): string => ({
    automatic: local(zh, '自动', 'Automatic'),
    balanced: local(zh, '平衡', 'Balanced'),
    custom: local(zh, '自定义', 'Custom'),
    high_performance: local(zh, '高性能', 'High performance'),
    high_power: local(zh, '高功率', 'High Power'),
    highest_sustained_profile: local(zh, '最高持续性能档', 'Highest sustained profile'),
    low_power: local(zh, '低功耗', 'Low Power'),
    performance: local(zh, '性能优先', 'Performance'),
    supported_performance_mode: local(zh, '受支持的性能模式', 'Supported performance mode'),
    ultimate_performance: local(zh, '卓越性能', 'Ultimate performance'),
    unknown: local(zh, '未知', 'Unknown'),
}[mode] || mode);

const checkLabel = (check: ComputePerformanceModeCheck, zh: boolean): string => ({
    inspection_available: local(zh, '检查命令可用', 'Inspection available'),
    jetson_power_profile: local(zh, 'Jetson 功耗档位', 'Jetson power profile'),
    linux_boost: local(zh, '处理器加速', 'CPU boost'),
    linux_governor: local(zh, '处理器调频策略', 'CPU governor'),
    linux_max_frequency: local(zh, '最高频率限制', 'Maximum frequency limit'),
    macos_energy_mode: local(zh, '能源模式', 'Energy mode'),
    windows_power_scheme: local(zh, '电源计划', 'Power scheme'),
    windows_processor_maximum: local(zh, '处理器最高状态', 'Maximum processor state'),
})[check.code];

const errorLabel = (error: Inspection['error'], zh: boolean): string => ({
    offline: local(zh, '机器离线，无法检查', 'Machine offline'),
    unsupported: local(zh, '节点版本暂不支持', 'Node version unsupported'),
    failed: local(zh, '检查失败，请重试', 'Inspection failed; retry'),
})[error || 'failed'];

const errorAction = (error: Inspection['error'], zh: boolean): string => ({
    offline: local(zh, '检查网络和节点服务', 'Check network and node service'),
    unsupported: local(zh, '升级节点服务', 'Upgrade the node service'),
    failed: local(zh, '重新检查或查看节点日志', 'Retry or inspect node logs'),
})[error || 'failed'];

const optimizationAvailabilityLabel = (count: number, zh: boolean): string =>
    count
        ? local(zh, `可选 ${count} 台`, `${count} available`)
        : local(zh, '不可用', 'Unavailable');

const actionError = (reason: unknown, zh: boolean): string => {
    const raw = reason instanceof Error ? reason.message : String(reason);
    if (raw.includes('target_changed')) return local(
        zh,
        '机器状态已变化，已停止本次优化，请重新检查。',
        'Machine state changed. Check again before optimizing.',
    );
    if (raw.includes('authorization_')) return local(
        zh,
        '本次授权无效，请重新发起优化。',
        'This approval is no longer valid. Start optimization again.',
    );
    if (raw.includes('capability_unavailable')) return local(
        zh,
        '节点版本暂不支持一键优化。',
        'The node version does not support one-click optimization.',
    );
    return local(zh, '优化失败，请查看节点状态后重试。', 'Optimization failed. Check node state and retry.');
};

const nodeIp = (node: ComputeClusterNode, lanAssets: ComputeLanAsset[], zh: boolean): string => {
    const reported = node.network.lan_address
        || node.network.addresses.find(address => !address.includes(':'))
        || node.network.addresses[0];
    if (reported) return reported;
    const nodeName = node.name.trim().toLowerCase();
    const discovered = Array.from(new Set(lanAssets
        .filter(asset => asset.device_kind === 'edge_compute'
            && [asset.display_name, asset.hostname].some(name =>
                name?.trim().toLowerCase() === nodeName))
        .map(asset => asset.address)));
    return discovered.join(' / ') || local(zh, '未识别', 'Not identified');
};

const inspectNode = async (
    node: ComputeClusterNode,
    signal?: AbortSignal,
): Promise<readonly [string, Inspection]> => {
    if (!node.online) return [node.node_id, {error: 'offline'}];
    if (!node.capabilities.includes('runtime.performance.mode.read.v1')) {
        return [node.node_id, {error: 'unsupported'}];
    }
    try {
        const result = await ComputeClusterService.performanceMode(node.node_id, signal);
        if (result.schema_version !== 'performance.mode-result.v1') {
            throw new Error('performance_mode_invalid');
        }
        return [node.node_id, {result}];
    } catch {
        return [node.node_id, {error: 'failed'}];
    }
};

const PerformanceModeRow: React.FC<{
    node: ComputeClusterNode;
    inspection?: Inspection;
    lanAssets: ComputeLanAsset[];
    zh: boolean;
}> = ({node, inspection, lanAssets, zh}) => {
    const result = inspection?.result;
    const normal = Boolean(result?.compliant);
    const tone = normal ? 'healthy' : inspection?.error === 'offline' ? 'offline' : 'warning';
    const failedChecks = result?.checks.filter(check => !check.passed).length || 0;
    const evidenceSummary = failedChecks
        ? local(zh, `${failedChecks} 项未通过`, `${failedChecks} failed`)
        : local(zh, '全部通过', 'All checks passed');
    return <tr>
        <td data-label={local(zh, '机器', 'Machine')}>{node.name}</td>
        <td data-label={local(zh, 'IP 地址', 'IP address')}>{nodeIp(node, lanAssets, zh)}</td>
        <td data-label={local(zh, '设备', 'Device')}>
            {node.resources.hardware_model || node.resources.platform}
        </td>
        <td data-label={local(zh, '当前模式', 'Current mode')}>
            {result ? modeLabel(result.current_mode, zh) : '—'}
        </td>
        <td data-label={local(zh, '目标模式', 'Target mode')}>
            {result ? modeLabel(result.target_mode, zh) : '—'}
        </td>
        <td data-label={local(zh, '状态', 'Status')}>
            <span className={`ControlMachineState ${tone}`}>
                {normal ? local(zh, '正常', 'Normal') : local(zh, '故障', 'Fault')}
            </span>
        </td>
        <td data-label={local(zh, '证据', 'Evidence')}>
            {result ? <details>
                <summary>{evidenceSummary}</summary>
                <ul>{result.checks.map(check => <li key={check.code}>
                    <strong>{checkLabel(check, zh)}</strong>
                    <span>{modeLabel(check.observed, zh)} / {modeLabel(check.expected, zh)}</span>
                </li>)}</ul>
            </details> : errorLabel(inspection?.error, zh)}
        </td>
    </tr>;
};

// eslint-disable-next-line complexity
export const PerformanceModePanel: React.FC<IProps> = ({nodes, lanAssets = [], zh, visible}) => {
    const nodeKey = performanceModeNodeKey(nodes);
    const [scan, setScan] = useState<PerformanceModeScan>(() => cachedPerformanceModeScan(nodes));
    const [selectedNodes, setSelectedNodes] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(false);
    const [pending, setPending] = useState<PendingOptimization[]>();
    const [actionMessage, setActionMessage] = useState('');
    const activeScan = scan.nodeKey === nodeKey ? scan : {nodeKey, inspections: {}};
    const {inspections, scannedAt} = activeScan;
    const hasScanned = scannedAt !== undefined;

    const load = async (signal?: AbortSignal) => {
        if (!visible) return;
        setLoading(true);
        const entries = await Promise.all(nodes.map(node => inspectNode(node, signal)));
        if (!signal?.aborted) {
            const completedScan: Required<PerformanceModeScan> = {
                nodeKey,
                scannedAt: Date.now(),
                inspections: Object.fromEntries(entries),
            };
            setScan(completedScan);
            cachePerformanceModeScan(completedScan);
            setSelectedNodes({});
            setLoading(false);
        }
    };

    const normalCount = nodes.filter(node => inspections[node.node_id]?.result?.compliant).length;
    const optimizable = hasScanned ? nodes.filter(node => {
        const result = inspections[node.node_id]?.result;
        return node.online
            && node.capabilities.includes('control.performance.mode.manage.v1')
            && Boolean(result?.available && !result.compliant);
    }) : [];
    const selectedOptimizable = optimizable.filter(node => selectedNodes[node.node_id] !== false);
    const optimizableIds = new Set(optimizable.map(node => node.node_id));
    const faults = new Map<string, {
        label: string;
        detail: string;
        machines: string[];
        optimizable: number;
    }>();
    const addFault = (key: string, label: string, detail: string, node: ComputeClusterNode) => {
        const fault = faults.get(key) || {label, detail, machines: [], optimizable: 0};
        fault.machines.push(`${node.name} (${nodeIp(node, lanAssets, zh)})`);
        if (optimizableIds.has(node.node_id)) fault.optimizable += 1;
        faults.set(key, fault);
    };
    nodes.forEach(node => {
        const inspection = inspections[node.node_id];
        if (!inspection) return;
        if (inspection.error) {
            addFault(
                `error:${inspection.error}`,
                errorLabel(inspection.error, zh),
                errorAction(inspection.error, zh),
                node,
            );
            return;
        }
        inspection.result?.checks.filter(check => !check.passed).forEach(check => addFault(
            `check:${check.code}:${check.observed}:${check.expected}`,
            checkLabel(check, zh),
            `${modeLabel(check.observed, zh)} / ${modeLabel(check.expected, zh)}`,
            node,
        ));
    });
    const faultRows = Array.from(faults.values());

    const rejectPending = async () => {
        const authorizations = pending || [];
        setPending(undefined);
        await Promise.allSettled(authorizations.map(item =>
            ComputeClusterService.rejectPerformanceModeAuthorization(
                item.created.authorization.authorization_id,
            )));
    };

    // The exact server-prepared scope is checked in one place before the batch dialog opens.
    // eslint-disable-next-line complexity
    const prepareOptimization = async () => {
        if (loading || selectedOptimizable.length === 0) return;
        setLoading(true);
        setActionMessage('');
        const prepared: PendingOptimization[] = [];
        try {
            const identity = getApprovalIdentity();
            for (const node of selectedOptimizable) {
                const inspection = inspections[node.node_id]?.result;
                if (!inspection) throw new Error('performance_mode_missing');
                const requestId = uuidv4();
                const request: ComputePerformanceModeRequest = {
                    schema_version: 'agentos.capability-request.v1',
                    request_id: requestId,
                    idempotency_key: requestId,
                    tool: 'agentos.performance.mode_apply',
                    node_id: node.node_id,
                    arguments: {
                        expected_current_mode: inspection.current_mode,
                        target_mode: inspection.target_mode,
                    },
                };
                // Each prepared authorization is retained so earlier scopes can be rejected if a later node fails.
                // eslint-disable-next-line no-await-in-loop
                const created = await ComputeClusterService.createPerformanceModeAuthorization(
                    node.node_id,
                    {request, user: identity.user, ttl_seconds: 120},
                );
                const authorization = created.authorization;
                if (
                    created.response.state !== 'authorization_required'
                    || created.response.request_id !== request.request_id
                    || created.response.node_id !== request.node_id
                    || created.response.authorization?.authorization_id !== authorization.authorization_id
                    || authorization.state !== 'pending'
                    || authorization.operation !== request.tool
                    || authorization.target_installation_id !== node.installation_id
                    || authorization.target.kind !== 'performance_mode'
                    || authorization.target.request_id !== request.request_id
                    || authorization.target.idempotency_key !== request.idempotency_key
                    || canonicalAuthorizationJson(authorization.parameters)
                        !== canonicalAuthorizationJson(request.arguments)
                    || authorization.user_id !== identity.user.user_id
                    || authorization.user_public_key !== identity.user.user_public_key
                    || !created.evidence
                    || created.evidence.compliant
                    || created.evidence.current_mode !== request.arguments.expected_current_mode
                    || created.evidence.target_mode !== request.arguments.target_mode
                ) throw new Error('performance_mode_authorization_mismatch');
                prepared.push({node, created});
            }
            setPending(prepared);
        } catch (reason) {
            await Promise.allSettled(prepared.map(item =>
                ComputeClusterService.rejectPerformanceModeAuthorization(
                    item.created.authorization.authorization_id,
                )));
            setActionMessage(actionError(reason, zh));
        } finally {
            setLoading(false);
        }
    };

    const approveOptimization = async () => {
        if (!pending?.length || loading) return;
        setLoading(true);
        let succeeded = 0;
        const failures: string[] = [];
        for (const item of pending) {
            const authorization = item.created.authorization;
            try {
                // Sequential approval keeps the per-node result visible and bounded to one signed action at a time.
                // eslint-disable-next-line no-await-in-loop
                const signature = await signAuthorization(
                    authorization,
                    getApprovalIdentity(),
                );
                // eslint-disable-next-line no-await-in-loop
                const decided = await ComputeClusterService.approvePerformanceModeAuthorization(
                    authorization.authorization_id,
                    signature,
                );
                const result = decided.response.result;
                if (
                    decided.authorization.authorization_id !== authorization.authorization_id
                    || decided.response.state !== 'succeeded'
                    || decided.response.request_id !== authorization.target.request_id
                    || decided.response.node_id !== authorization.target_installation_id
                    || !result?.changed
                    || result.before.current_mode !== authorization.parameters.expected_current_mode
                    || result.after.target_mode !== authorization.parameters.target_mode
                    || !result.after.compliant
                ) throw new Error('performance_mode_result_mismatch');
                succeeded += 1;
            } catch {
                failures.push(item.node.name);
            }
        }
        setPending(undefined);
        setActionMessage(failures.length
            ? local(
                zh,
                `已优化 ${succeeded} 台，失败 ${failures.length} 台：${failures.join('、')}`,
                `Optimized ${succeeded}; failed ${failures.length}: ${failures.join(', ')}`,
            )
            : local(zh, `已优化 ${succeeded} 台机器。`, `Optimized ${succeeded} machines.`));
        await load();
        setLoading(false);
    };

    return <section className='ControlPerformanceMode' aria-label={local(zh, '性能模式检查', 'Performance mode inspection')}>
        <header className='ControlPerformanceModeHeader'>
            <div>
                <h1>{local(zh, '性能模式', 'Performance mode')}</h1>
                <p>{local(zh,
                    '检查全部机器是否达到目标性能配置，并对支持的未达标机器一键优化。',
                    'Inspect all machines and optimize supported non-compliant machines.',
                )}</p>
            </div>
            <div className='ControlPerformanceModeActions'>
                <button type='button' onClick={() => void load()} disabled={loading || nodes.length === 0}>
                    {loading
                        ? local(zh, '扫描中…', 'Scanning…')
                        : hasScanned
                            ? local(zh, '重新扫描', 'Scan again')
                            : local(zh, '开始扫描', 'Start scan')}
                </button>
                <button
                    type='button'
                    className='primary'
                    onClick={() => void prepareOptimization()}
                    disabled={loading || selectedOptimizable.length === 0}
                >
                    {local(
                        zh,
                        `优化已选（${selectedOptimizable.length}）`,
                        `Optimize selected (${selectedOptimizable.length})`,
                    )}
                </button>
            </div>
        </header>
        {!hasScanned ? <div className='ControlMonitorUnavailable'>
            <strong>{nodes.length
                ? local(zh, '尚未扫描', 'Not scanned yet')
                : local(zh, '计算群中暂无机器', 'No machines in the compute cluster')}</strong>
            {nodes.length > 0 && <span>{local(
                zh,
                '点击“开始扫描”检查全部机器的性能模式。',
                'Select Start scan to inspect performance mode on all machines.',
            )}</span>}
        </div> : <>
            <div className='ControlPerformanceModeSummary' role='status'>
            <strong>{normalCount} / {nodes.length} {local(zh, '正常', 'normal')}</strong>
            <span>{local(zh,
                `当前支持一键优化 ${optimizable.length} 台，已选 ${selectedOptimizable.length} 台；不可用节点不会被修改。`,
                `${optimizable.length} support optimization; ${selectedOptimizable.length} selected. Unavailable nodes are not changed.`,
            )}</span>
            <span>
                {local(zh, '上次扫描', 'Last scanned')}{' '}
                <time dateTime={new Date(scannedAt).toISOString()}>
                    {new Date(scannedAt).toLocaleString(zh ? 'zh-CN' : 'en-US', {hour12: false})}
                </time>
            </span>
            </div>
            {actionMessage && <div className='ControlPerformanceModeResult' role='status'>
                {actionMessage}
            </div>}
            <section className='ControlPerformanceOptimization'>
            <h2>{local(zh, '一键优化范围', 'One-click optimization scope')}</h2>
            <p>{local(
                zh,
                '仅列出节点明确支持的一键优化项；勾选后再执行。',
                'Only explicitly supported actions are listed. Select machines before running.',
            )}</p>
            <table aria-label={local(zh, '一键优化范围', 'One-click optimization scope')}>
                <thead><tr>
                    <th>{local(zh, '选择', 'Select')}</th>
                    <th>{local(zh, '可优化问题', 'Optimizable issue')}</th>
                    <th>{local(zh, '机器 / IP', 'Machine / IP')}</th>
                    <th>{local(zh, '调整', 'Change')}</th>
                </tr></thead>
                <tbody>{optimizable.length ? optimizable.map(node => {
                    const result = inspections[node.node_id]?.result;
                    const problems = result?.checks
                        .filter(check => !check.passed)
                        .map(check => checkLabel(check, zh))
                        .join('、');
                    return <tr key={node.node_id}>
                        <td data-label={local(zh, '选择', 'Select')}>
                            <input
                                type='checkbox'
                                aria-label={local(zh, `选择 ${node.name}`, `Select ${node.name}`)}
                                checked={selectedNodes[node.node_id] !== false}
                                disabled={loading}
                                onChange={event => setSelectedNodes(current => ({
                                    ...current,
                                    [node.node_id]: event.target.checked,
                                }))}
                            />
                        </td>
                        <td data-label={local(zh, '可优化问题', 'Optimizable issue')}>
                            {problems || local(zh, '性能模式', 'Performance mode')}
                        </td>
                        <td data-label={local(zh, '机器 / IP', 'Machine / IP')}>
                            {node.name} ({nodeIp(node, lanAssets, zh)})
                        </td>
                        <td data-label={local(zh, '调整', 'Change')}>
                            {result
                                ? `${modeLabel(result.current_mode, zh)} → ${modeLabel(result.target_mode, zh)}`
                                : '—'}
                        </td>
                    </tr>;
                }) : <tr>
                    <td colSpan={4}>{local(
                        zh,
                        '当前没有支持一键优化的机器。',
                        'No machines currently support one-click optimization.',
                    )}</td>
                </tr>}</tbody>
            </table>
            </section>
            <section className='ControlPerformanceFaults'>
            <h2>{local(zh, '故障汇总', 'Fault summary')}</h2>
            <table aria-label={local(zh, '故障汇总', 'Fault summary')}>
                <thead><tr>
                    <th>{local(zh, '故障问题', 'Fault')}</th>
                    <th>{local(zh, '数量', 'Count')}</th>
                    <th>{local(zh, '涉及机器 / IP', 'Machines / IP')}</th>
                    <th>{local(zh, '现状 / 处理', 'State / action')}</th>
                    <th>{local(zh, '一键优化', 'One-click optimization')}</th>
                </tr></thead>
                <tbody>{faultRows.length ? faultRows.map(fault => <tr key={`${fault.label}:${fault.detail}`}>
                    <td data-label={local(zh, '故障问题', 'Fault')}>{fault.label}</td>
                    <td data-label={local(zh, '数量', 'Count')}>{fault.machines.length}</td>
                    <td data-label={local(zh, '涉及机器 / IP', 'Machines / IP')}>{fault.machines.join('、')}</td>
                    <td data-label={local(zh, '现状 / 处理', 'State / action')}>{fault.detail}</td>
                    <td data-label={local(zh, '一键优化', 'One-click optimization')}>
                        {optimizationAvailabilityLabel(fault.optimizable, zh)}
                    </td>
                </tr>) : <tr>
                    <td colSpan={5}>{local(zh, '暂无故障', 'No faults')}</td>
                </tr>}</tbody>
            </table>
            </section>
            <table className='ControlPerformanceModeDetail' aria-label={local(zh, '机器检查明细', 'Machine inspection details')}>
                <thead><tr>
                    <th>{zh ? '机器' : 'Machine'}</th>
                    <th>{zh ? 'IP 地址' : 'IP address'}</th>
                    <th>{zh ? '设备' : 'Device'}</th>
                    <th>{zh ? '当前模式' : 'Current mode'}</th>
                    <th>{zh ? '目标模式' : 'Target mode'}</th>
                    <th>{zh ? '状态' : 'Status'}</th>
                    <th>{zh ? '证据' : 'Evidence'}</th>
                </tr></thead>
                <tbody>{nodes.map(node => <PerformanceModeRow
                    key={node.node_id}
                    node={node}
                    inspection={inspections[node.node_id]}
                    lanAssets={lanAssets}
                    zh={zh}
                />)}</tbody>
            </table>
        </>}
        <Dialog
            open={Boolean(pending?.length && visible)}
            onClose={() => void rejectPending()}
            aria-labelledby='performance-mode-authorization-title'
        >
            <DialogTitle id='performance-mode-authorization-title'>
                {local(zh, '确认一键优化', 'Confirm one-click optimization')}
            </DialogTitle>
            <DialogContent>
                <p>{local(
                    zh,
                    '将逐台切换到扫描确认的目标性能配置，执行后自动重新检查。',
                    'Each machine will switch to its scanned target configuration and be checked again.',
                )}</p>
                <ul className='ControlPerformanceModeTargets'>{pending?.map(item => <li key={item.node.node_id}>
                    <strong>{item.node.name}</strong>
                    <span>{modeLabel(item.created.authorization.parameters.expected_current_mode, zh)}
                        {' → '}
                        {modeLabel(item.created.authorization.parameters.target_mode, zh)}</span>
                </li>)}</ul>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => void rejectPending()} disabled={loading}>
                    {local(zh, '取消', 'Cancel')}
                </Button>
                <Button
                    variant='contained'
                    autoFocus
                    onClick={() => void approveOptimization()}
                    disabled={loading}
                >
                    {loading
                        ? local(zh, '正在优化…', 'Optimizing…')
                        : local(zh, '授权并优化', 'Approve and optimize')}
                </Button>
            </DialogActions>
        </Dialog>
    </section>;
};
