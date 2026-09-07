import React, {useEffect, useState} from 'react';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputePerformanceDiagnosis,
    ComputePerformanceEvidence,
    ComputePerformanceMetric,
} from '../../services/ComputeClusterService';

interface IProps {
    node: ComputeClusterNode | null;
    zh: boolean;
    visible: boolean;
}

const metricLabel = (metric: ComputePerformanceMetric, zh: boolean): string => ({
    cpu_percent: zh ? '处理器' : 'CPU',
    memory_used_percent: zh ? '内存' : 'Memory',
    disk_used_percent: zh ? '磁盘' : 'Disk',
    gpu_memory_used_percent: zh ? '显存' : 'GPU memory',
    gpu_temperature_celsius: zh ? 'GPU 温度' : 'GPU temperature',
})[metric];

const findingLabel = (code: ComputePerformanceDiagnosis['findings'][number]['code'], zh: boolean): string => ({
    sustained_high_cpu: zh ? '处理器持续高负载' : 'Sustained high CPU load',
    sustained_memory_pressure: zh ? '内存持续高占用' : 'Sustained memory pressure',
    sustained_disk_pressure: zh ? '磁盘空间持续紧张' : 'Sustained disk pressure',
    sustained_gpu_memory_pressure: zh ? '显存持续高占用' : 'Sustained GPU memory pressure',
    sustained_gpu_temperature: zh ? 'GPU 温度持续偏高' : 'Sustained high GPU temperature',
})[code];

const metricValue = (value: number | null, unit: ComputePerformanceEvidence['unit']): string =>
    value === null ? '—' : `${value.toFixed(1)}${unit === 'percent' ? '%' : '°C'}`;

// Loading, capability, and evidence states share one read-only panel boundary.
// eslint-disable-next-line complexity
export const PerformanceDiagnosisPanel: React.FC<IProps> = ({node, zh, visible}) => {
    const [document, setDocument] = useState<ComputePerformanceDiagnosis>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const available = Boolean(
        node?.online && node.capabilities.includes('runtime.performance.diagnose.v1'),
    );

    const load = async (signal?: AbortSignal) => {
        if (!node || !visible || !available) return;
        setLoading(true);
        setError('');
        try {
            const result = await ComputeClusterService.performanceDiagnosis(
                node.node_id, 300, signal,
            );
            if (signal?.aborted) return;
            if (
                result.schema_version !== 'performance.diagnosis-result.v1'
                || result.window_seconds !== 300
            ) throw new Error('performance_diagnosis_invalid');
            setDocument(result);
        } catch {
            if (!signal?.aborted) setError(
                zh ? '性能诊断暂不可用，请稍后刷新。' : 'Performance diagnosis is unavailable. Refresh later.',
            );
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    };

    useEffect(() => {
        setDocument(undefined);
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [node?.node_id, available, visible]);

    if (!node || !available) return <div className='ControlMonitorUnavailable'>
        <strong>{!node
            ? (zh ? '请先选择节点' : 'Choose a node')
            : !node.online
                ? (zh ? '节点离线' : 'Node offline')
                : (zh ? '节点版本暂不支持性能诊断' : 'This node does not support performance diagnosis yet')}</strong>
    </div>;
    if (!document) return <div className='ControlMonitorUnavailable'>
        <strong>{loading
            ? (zh ? '正在收集性能证据…' : 'Collecting performance evidence…')
            : error}</strong>
    </div>;

    return <section
        className='ControlMonitorProcesses ControlMonitorInventory ControlPerformanceDiagnosis'
        aria-label={zh ? '性能诊断证据' : 'Performance diagnosis evidence'}
    >
        <header className='ControlMonitorSearchHeader'>
            <div>
                <h3>{zh ? '固定规则诊断' : 'Fixed-rule diagnosis'}</h3>
                <p>{zh ? '只根据节点遥测生成证据，不执行优化操作。' : 'Telemetry evidence only; no optimization actions are run.'}</p>
            </div>
            <button type='button' onClick={() => void load()} disabled={loading}>
                {loading ? (zh ? '诊断中…' : 'Diagnosing…') : (zh ? '刷新' : 'Refresh')}
            </button>
        </header>
        {error && <p className='ControlMonitorHistoryError' role='status'>{error}</p>}
        <p>
            {zh
                ? `窗口 ${document.window_seconds} 秒 · 已观察 ${Math.round(document.observed_seconds)} 秒 · ${document.sample_count} 个样本`
                : `${document.window_seconds}s window · ${Math.round(document.observed_seconds)}s observed · ${document.sample_count} samples`}
        </p>
        {!document.coverage_sufficient && <div className='ControlPerformanceConclusion' role='status'>
            <strong>{zh ? '证据窗口不足，不生成结论' : 'Insufficient evidence window; no conclusion generated'}</strong>
        </div>}
        {document.coverage_sufficient && document.findings.length === 0 && <div className='ControlPerformanceConclusion'>
            <strong>{zh ? '固定规则未发现持续异常' : 'No sustained issue found by the fixed rules'}</strong>
        </div>}
        {document.findings.length > 0 && <ul className='ControlPerformanceFindings'>
            {document.findings.map(finding => <li key={finding.code}>
                {findingLabel(finding.code, zh)}
            </li>)}
        </ul>}
        <table>
            <thead><tr>
                <th>{zh ? '指标' : 'Metric'}</th>
                <th>{zh ? '样本' : 'Samples'}</th>
                <th>{zh ? '范围 / 均值' : 'Range / average'}</th>
                <th>{zh ? '阈值' : 'Threshold'}</th>
                <th>{zh ? '证据状态' : 'Evidence state'}</th>
            </tr></thead>
            <tbody>{document.evidence.map(item => <tr key={item.metric}>
                <td>{metricLabel(item.metric, zh)}</td>
                <td>{item.sample_count}</td>
                <td>{item.sample_count
                    ? `${metricValue(item.minimum, item.unit)}–${metricValue(item.maximum, item.unit)} / ${metricValue(item.average, item.unit)}`
                    : '—'}</td>
                <td>≥ {metricValue(item.threshold, item.unit)}</td>
                <td>{item.sustained
                    ? (zh ? '持续超阈值' : 'Sustained threshold breach')
                    : item.sufficient
                        ? (zh ? '未持续超阈值' : 'Not sustained')
                        : (zh ? '证据不足' : 'Insufficient')}</td>
            </tr>)}</tbody>
        </table>
    </section>;
};
