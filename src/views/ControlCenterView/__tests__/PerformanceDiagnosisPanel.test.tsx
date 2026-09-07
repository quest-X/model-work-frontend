import React from 'react';
import {render, screen} from '@testing-library/react';
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

const diagnosis = (sustained = false): ComputePerformanceDiagnosis => ({
    schema_version: 'performance.diagnosis-result.v1',
    window_seconds: 300,
    observed_seconds: sustained ? 240 : 0,
    sample_count: sustained ? 3 : 1,
    coverage_sufficient: sustained,
    evidence: rules.map(([metric, unit, threshold], index) => ({
        metric,
        unit,
        sample_count: sustained ? 3 : 1,
        minimum: sustained && index === 0 ? 95 : 10,
        maximum: sustained && index === 0 ? 99 : 10,
        average: sustained && index === 0 ? 97 : 10,
        threshold,
        comparison: 'gte',
        violating_samples: sustained && index === 0 ? 3 : 0,
        sufficient: sustained,
        sustained: sustained && index === 0,
    })),
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
        expect(screen.queryByRole('button', {name: /优化/})).not.toBeInTheDocument();
    });

    it('shows only findings backed by sustained fixed-rule evidence', async () => {
        jest.spyOn(ComputeClusterService, 'performanceDiagnosis')
            .mockResolvedValue(diagnosis(true));

        render(<PerformanceDiagnosisPanel node={node} zh visible/>);

        expect(await screen.findByText('处理器持续高负载')).toBeInTheDocument();
        expect(screen.getByText('持续超阈值')).toBeInTheDocument();
        expect(ComputeClusterService.performanceDiagnosis).toHaveBeenCalledWith(
            node.node_id, 300, expect.any(AbortSignal),
        );
    });
});
