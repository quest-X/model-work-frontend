import React from 'react';
import {act, render, screen, waitFor} from '@testing-library/react';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputePerformanceDiagnosis,
    ComputePerformanceMetric,
} from '../../../services/ComputeClusterService';
import {PerformanceDiagnosisPanel} from '../PerformanceDiagnosisPanel';

const node: ComputeClusterNode = {
    node_id: '00000000-0000-4000-8000-000000000011',
    installation_id: '00000000-0000-4000-8000-000000000011',
    name: 'baoxin-156-windows',
    agent_version: '1.1.0',
    capabilities: ['runtime.performance.diagnose.v1'],
    network: {provider: 'tailscale', installed: true, online: true, addresses: []},
    network_dependencies: [],
    resources: {
        captured_at: 1, platform: 'Windows', architecture: 'AMD64', cpu_logical: 16,
        load_average_1m: null, memory_total_bytes: 1, memory_available_bytes: 1,
        disk_total_bytes: 1, disk_free_bytes: 1, gpus: [],
    },
    device_inventory: {state: 'ready', devices: []},
    enrolled_at: 1,
    last_seen_at: 1,
    enabled: true,
    online: true,
    heartbeat_age_seconds: 1,
};

const rules: [ComputePerformanceMetric, 'percent' | 'celsius', number][] = [
    ['cpu_percent', 'percent', 90],
    ['memory_used_percent', 'percent', 90],
    ['disk_used_percent', 'percent', 90],
    ['gpu_memory_used_percent', 'percent', 90],
    ['gpu_temperature_celsius', 'celsius', 85],
];

// eslint-disable-next-line complexity
const diagnosis = (sustained = false): ComputePerformanceDiagnosis => ({
    schema_version: 'performance.diagnosis-result.v1',
    window_seconds: 300,
    observed_seconds: sustained ? 240 : 0,
    sample_count: sustained ? 3 : 1,
    coverage_sufficient: sustained,
    // eslint-disable-next-line complexity
    evidence: rules.map(([metric, unit, threshold], index) => {
        const missingGpu = !sustained && metric.startsWith('gpu_');
        return {
            metric,
            unit,
            sample_count: missingGpu ? 0 : sustained ? 3 : 1,
            minimum: missingGpu ? null : sustained && index === 0 ? 95 : 10,
            maximum: missingGpu ? null : sustained && index === 0 ? 99 : 10,
            average: missingGpu ? null : sustained && index === 0 ? 97 : 10,
            threshold,
            comparison: 'gte',
            violating_samples: sustained && index === 0 ? 3 : 0,
            sufficient: sustained,
            sustained: sustained && index === 0,
        };
    }),
    findings: sustained ? [{
        code: 'sustained_high_cpu',
        severity: 'warning',
        metric: 'cpu_percent',
        evidence_index: 0,
    }] : [],
});

describe('PerformanceDiagnosisPanel', () => {
    afterEach(() => jest.restoreAllMocks());

    it('withholds conclusions when the evidence window is insufficient', async () => {
        jest.spyOn(ComputeClusterService, 'performanceDiagnosis')
            .mockResolvedValue(diagnosis());

        render(<PerformanceDiagnosisPanel node={node} zh visible/>);

        expect(await screen.findByText('证据窗口不足，不生成结论')).toBeInTheDocument();
        expect(screen.getAllByRole('row')).toHaveLength(6);
        expect(screen.getAllByText('节点未上报 GPU 数据')).toHaveLength(2);
        expect(screen.queryByRole('button', {name: /优化/})).not.toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', {name: '刷新'})).toBeEnabled());
    });

    it('shows cached evidence while refreshing on reopen', async () => {
        const refreshed = diagnosis(true);
        let resolveRefresh: (value: ComputePerformanceDiagnosis) => void = () => undefined;
        const refresh = new Promise<ComputePerformanceDiagnosis>(resolve => {
            resolveRefresh = resolve;
        });
        const load = jest.spyOn(ComputeClusterService, 'performanceDiagnosis')
            .mockResolvedValueOnce(diagnosis())
            .mockReturnValueOnce(refresh);
        const view = render(<PerformanceDiagnosisPanel node={node} zh visible/>);

        expect(await screen.findByText('证据窗口不足，不生成结论')).toBeInTheDocument();
        view.rerender(<></>);
        view.rerender(<PerformanceDiagnosisPanel node={node} zh visible/>);

        expect(screen.getByText('证据窗口不足，不生成结论')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '诊断中…'})).toBeDisabled();
        await act(async () => {
            resolveRefresh(refreshed);
            await refresh;
        });
        expect(await screen.findByText('处理器持续高负载')).toBeInTheDocument();
        expect(load).toHaveBeenCalledTimes(2);
        await waitFor(() => expect(screen.getByRole('button', {name: '刷新'})).toBeEnabled());
    });

    it('shows only findings backed by sustained fixed-rule evidence', async () => {
        jest.spyOn(ComputeClusterService, 'performanceDiagnosis')
            .mockResolvedValue(diagnosis(true));

        render(<PerformanceDiagnosisPanel node={node} zh visible/>);

        expect(await screen.findByText('处理器持续高负载')).toBeInTheDocument();
        expect(screen.getByText('持续超阈值')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', {name: '刷新'})).toBeEnabled());
        expect(ComputeClusterService.performanceDiagnosis).toHaveBeenCalledWith(
            node.node_id, 300, expect.any(AbortSignal),
        );
    });
});
