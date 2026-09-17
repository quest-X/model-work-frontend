import React from 'react';
import {render, screen, waitFor} from '@testing-library/react';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputePerformanceMode,
} from '../../../services/ComputeClusterService';
import {PerformanceModePanel} from '../PerformanceModePanel';

const node = (name: string, online = true): ComputeClusterNode => ({
    node_id: `00000000-0000-4000-8000-${name === 'AIPACK-13' ? '000000000013' : '000000000014'}`,
    installation_id: `00000000-0000-4000-8000-${name === 'AIPACK-13' ? '000000000013' : '000000000014'}`,
    name,
    agent_version: '1.1.0',
    capabilities: ['runtime.performance.mode.read.v1'],
    network: {provider: 'tailscale', installed: true, online, addresses: []},
    network_dependencies: [],
    resources: {
        captured_at: 1,
        platform: 'linux',
        architecture: 'aarch64',
        hardware_model: 'Jetson AGX Orin Developer Kit',
        cpu_logical: 8,
        load_average_1m: null,
        memory_total_bytes: 1,
        memory_available_bytes: 1,
        disk_total_bytes: 1,
        disk_free_bytes: 1,
        gpus: [],
    },
    device_inventory: {state: 'ready', devices: []},
    enrolled_at: 1,
    last_seen_at: 1,
    enabled: true,
    online,
    heartbeat_age_seconds: 1,
});

const result = (compliant: boolean): ComputePerformanceMode => ({
    schema_version: 'performance.mode-result.v1',
    captured_at: 1,
    platform: 'jetson',
    available: true,
    compliant,
    current_mode: compliant ? 'MODE_40W' : 'MODE_30W',
    target_mode: 'MODE_40W',
    checks: [{
        code: 'jetson_power_profile',
        passed: compliant,
        observed: compliant ? 'MODE_40W' : 'MODE_30W',
        expected: 'MODE_40W',
    }],
});

describe('PerformanceModePanel', () => {
    afterEach(() => jest.restoreAllMocks());

    it('checks supported online machines and folds all other states into fault', async () => {
        const supported = node('AIPACK-13');
        const offline = node('AIPACK-14', false);
        jest.spyOn(ComputeClusterService, 'performanceMode').mockResolvedValue(result(true));

        render(<PerformanceModePanel nodes={[supported, offline]} zh visible/>);

        expect(await screen.findByText('1 / 2 正常')).toBeInTheDocument();
        expect(screen.getByText('机器离线，无法检查')).toBeInTheDocument();
        expect(screen.getAllByText('故障')).toHaveLength(1);
        await waitFor(() => expect(ComputeClusterService.performanceMode).toHaveBeenCalledTimes(1));
        expect(ComputeClusterService.performanceMode).toHaveBeenCalledWith(
            supported.node_id, expect.any(AbortSignal),
        );
    });
});
