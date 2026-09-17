import React, {useEffect, useState} from 'react';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputePerformanceMode,
    ComputePerformanceModeCheck,
} from '../../services/ComputeClusterService';

interface IProps {
    nodes: ComputeClusterNode[];
    zh: boolean;
    visible: boolean;
}

type Inspection = {
    result?: ComputePerformanceMode;
    error?: 'offline' | 'unsupported' | 'failed';
};

const local = (zh: boolean, chinese: string, english: string): string =>
    zh ? chinese : english;

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
    zh: boolean;
}> = ({node, inspection, zh}) => {
    const result = inspection?.result;
    const normal = Boolean(result?.compliant);
    const failedChecks = result?.checks.filter(check => !check.passed).length || 0;
    const evidenceSummary = failedChecks
        ? local(zh, `${failedChecks} 项未通过`, `${failedChecks} failed`)
        : local(zh, '全部通过', 'All checks passed');
    return <tr>
        <td data-label={local(zh, '机器', 'Machine')}>{node.name}</td>
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
            <span className={`ControlMachineState ${normal ? 'healthy' : 'offline'}`}>
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

export const PerformanceModePanel: React.FC<IProps> = ({nodes, zh, visible}) => {
    const [inspections, setInspections] = useState<Record<string, Inspection>>({});
    const [loading, setLoading] = useState(false);

    const load = async (signal?: AbortSignal) => {
        if (!visible) return;
        setLoading(true);
        const entries = await Promise.all(nodes.map(node => inspectNode(node, signal)));
        if (!signal?.aborted) {
            setInspections(Object.fromEntries(entries));
            setLoading(false);
        }
    };

    const nodeKey = nodes.map(node =>
        `${node.node_id}:${node.online}:${node.capabilities.join(',')}`
    ).join('|');

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [visible, nodeKey]);

    const normalCount = nodes.filter(node => inspections[node.node_id]?.result?.compliant).length;

    return <section className='ControlPerformanceMode' aria-label={local(zh, '性能模式检查', 'Performance mode inspection')}>
        <header className='ControlPerformanceModeHeader'>
            <div>
                <h1>{local(zh, '性能模式', 'Performance mode')}</h1>
                <p>{local(zh,
                    '只读检查全部机器是否达到对应设备的目标性能配置。',
                    'Read-only inspection of each machine against its target performance configuration.',
                )}</p>
            </div>
            <button type='button' onClick={() => void load()} disabled={loading}>
                {loading ? local(zh, '检查中…', 'Checking…') : local(zh, '重新检查', 'Check again')}
            </button>
        </header>
        <div className='ControlPerformanceModeSummary' role='status'>
            <strong>{normalCount} / {nodes.length} {local(zh, '正常', 'normal')}</strong>
            <span>{local(zh,
                '未达标、离线、检查失败或版本不支持均显示为故障。',
                'Non-compliant, offline, failed, and unsupported machines are shown as faults.',
            )}</span>
        </div>
        {nodes.length === 0 ? <div className='ControlMonitorUnavailable'>
            <strong>{local(zh, '计算群中暂无机器', 'No machines in the compute cluster')}</strong>
        </div> : <table>
            <thead><tr>
                <th>{zh ? '机器' : 'Machine'}</th>
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
                zh={zh}
            />)}</tbody>
        </table>}
    </section>;
};
