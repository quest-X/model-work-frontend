import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {
    ComputeLanAsset,
    ComputeClusterNode,
    ComputeClusterService,
    ComputePerformanceMode,
    ComputePerformanceModeAuthorization,
    ComputePerformanceModeAuthorizationResult,
} from '../../../services/ComputeClusterService';
import * as ApprovalIdentity from '../../../services/ApprovalIdentityService';
import {PerformanceModePanel} from '../PerformanceModePanel';

jest.mock('uuid', () => ({v4: () => '00000000-0000-4000-8000-000000000033'}));
jest.mock('../../../services/ApprovalIdentityService', () => ({
    canonicalAuthorizationJson: (value: unknown) => JSON.stringify(value),
    getApprovalIdentity: jest.fn(),
    signAuthorization: jest.fn(),
}));

const authorizationId = '00000000-0000-4000-8000-000000000022';
const requestId = '00000000-0000-4000-8000-000000000033';
const user = {
    user_id: '00000000-0000-4000-8000-000000000099',
    user_name: 'OpenSight Console User',
    user_public_key: `${'A'.repeat(43)}=`,
};

const node = (name: string, online = true): ComputeClusterNode => ({
    node_id: `00000000-0000-4000-8000-${name === 'AIPACK-13' ? '000000000013' : '000000000014'}`,
    installation_id: `00000000-0000-4000-8000-${name === 'AIPACK-13' ? '000000000013' : '000000000014'}`,
    name,
    agent_version: '1.1.0',
    capabilities: ['runtime.performance.mode.read.v1'],
    network: {
        provider: 'tailscale',
        installed: true,
        online,
        addresses: [],
    },
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

const asset = (name: string, address: string): ComputeLanAsset => ({
    asset_id: name,
    node_id: 'main',
    node_name: 'main',
    cidr: '10.168.10.0/24',
    address,
    hostname: '',
    mac: '',
    device_kind: 'edge_compute',
    display_name: name,
    ports: [],
    online: true,
    first_seen_at: 1,
    last_seen_at: 1,
    last_changed_at: 1,
    change_type: 'unchanged',
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

const authorization = (
    targetNode: ComputeClusterNode,
    state: ComputePerformanceModeAuthorization['state'],
): ComputePerformanceModeAuthorization => ({
    version: 1,
    purpose: 'model-work-node.user-authorization.v1',
    authorization_id: authorizationId,
    ...user,
    target_installation_id: targetNode.installation_id,
    operation: 'agentos.performance.mode_apply',
    target: {
        kind: 'performance_mode',
        request_id: requestId,
        idempotency_key: requestId,
    },
    parameters: {
        expected_current_mode: 'MODE_30W',
        target_mode: 'MODE_40W',
    },
    nonce: 'c'.repeat(64),
    issued_at: 1,
    expires_at: 121,
    state,
    error_code: null,
    node_name: targetNode.name,
});

const challenge = (
    targetNode: ComputeClusterNode,
): ComputePerformanceModeAuthorizationResult => ({
    authorization: authorization(targetNode, 'pending'),
    evidence: result(false),
    response: {
        schema_version: 'agentos.capability-response.v1',
        request_id: requestId,
        tool: 'agentos.performance.mode_apply',
        node_id: targetNode.node_id,
        state: 'authorization_required',
        task_id: null,
        progress: null,
        result: null,
        authorization: {
            authorization_id: authorizationId,
            operation: 'agentos.performance.mode_apply',
            target_summary: targetNode.name,
            parameters_summary: 'MODE_30W -> MODE_40W',
            expires_at: 121,
        },
        error: null,
    },
});

describe('PerformanceModePanel', () => {
    beforeEach(() => window.localStorage.clear());
    afterEach(() => jest.restoreAllMocks());

    it('checks supported online machines and folds all other states into fault', async () => {
        const supported = node('AIPACK-13');
        const offline = node('AIPACK-14', false);
        jest.spyOn(ComputeClusterService, 'performanceMode').mockResolvedValue(result(false));

        const props = {
            nodes: [supported, offline],
            lanAssets: [
                asset('AIPACK-13', '10.168.10.10'),
                asset('AIPACK-14', '10.168.10.11'),
            ],
            zh: true,
            visible: true,
        };
        const {rerender, unmount} = render(<PerformanceModePanel
            {...props}
        />);

        expect(screen.getByText('尚未扫描')).toBeInTheDocument();
        expect(screen.queryByRole('table', {name: '机器检查明细'})).not.toBeInTheDocument();
        expect(ComputeClusterService.performanceMode).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));

        await waitFor(() => expect(
            within(screen.getByRole('table', {name: '故障汇总'}))
                .getByText('Jetson 功耗档位'),
        ).toBeInTheDocument());
        expect(screen.getByText('0 / 2 正常')).toBeInTheDocument();
        const faults = screen.getByRole('table', {name: '故障汇总'});
        expect(within(faults).getByText('Jetson 功耗档位')).toBeInTheDocument();
        expect(within(faults).getByText('机器离线，无法检查')).toBeInTheDocument();
        expect(within(faults).getByText('AIPACK-13 (10.168.10.10)')).toBeInTheDocument();
        expect(within(faults).getByText('AIPACK-14 (10.168.10.11)')).toBeInTheDocument();
        const jetsonFault = within(faults).getByText('Jetson 功耗档位').closest('tr');
        expect(jetsonFault).not.toBeNull();
        expect(within(jetsonFault as HTMLTableRowElement).getByText('不可用')).toBeInTheDocument();
        expect(screen.getByRole('table', {name: '一键优化范围'}))
            .toHaveTextContent('当前没有支持一键优化的机器。');
        const details = screen.getByRole('table', {name: '机器检查明细'});
        expect(within(details).getByText('10.168.10.10')).toBeInTheDocument();
        expect(within(details).getByText('10.168.10.11')).toBeInTheDocument();
        const supportedRow = within(details).getByText('AIPACK-13').closest('tr');
        const offlineRow = within(details).getByText('AIPACK-14').closest('tr');
        expect(within(supportedRow as HTMLTableRowElement).getByText('故障')).toHaveClass('warning');
        expect(within(offlineRow as HTMLTableRowElement).getByText('故障')).toHaveClass('offline');
        await waitFor(() => expect(ComputeClusterService.performanceMode).toHaveBeenCalledTimes(1));
        expect(ComputeClusterService.performanceMode).toHaveBeenCalledWith(
            supported.node_id, undefined,
        );

        rerender(<PerformanceModePanel nodes={[supported, {...offline, online: true}]} zh visible/>);
        expect(screen.getByRole('button', {name: '重新扫描'})).toBeInTheDocument();
        expect(ComputeClusterService.performanceMode).toHaveBeenCalledTimes(1);

        unmount();
        render(<PerformanceModePanel {...props}/>);
        expect(screen.getByRole('button', {name: '重新扫描'})).toBeInTheDocument();
        expect(screen.getByText('上次扫描')).toBeInTheDocument();
        expect(screen.getByText('0 / 2 正常')).toBeInTheDocument();
        expect(ComputeClusterService.performanceMode).toHaveBeenCalledTimes(1);
    });

    it('prepares one exact approval, optimizes, and checks again', async () => {
        const supported = node('AIPACK-13');
        supported.capabilities.push('control.performance.mode.manage.v1');
        (ApprovalIdentity.getApprovalIdentity as jest.Mock)
            .mockReturnValue({privateKey: {}, user});
        (ApprovalIdentity.signAuthorization as jest.Mock).mockResolvedValue('signed');
        const inspect = jest.spyOn(ComputeClusterService, 'performanceMode')
            .mockResolvedValueOnce(result(false))
            .mockResolvedValueOnce(result(true));
        const create = jest.spyOn(
            ComputeClusterService,
            'createPerformanceModeAuthorization',
        ).mockResolvedValue(challenge(supported));
        jest.spyOn(
            ComputeClusterService,
            'approvePerformanceModeAuthorization',
        ).mockResolvedValue({
            authorization: authorization(supported, 'succeeded'),
            response: {
                schema_version: 'agentos.capability-response.v1',
                request_id: requestId,
                tool: 'agentos.performance.mode_apply',
                node_id: supported.node_id,
                state: 'succeeded',
                task_id: null,
                progress: null,
                result: {
                    schema_version: 'performance.mode-apply-result.v1',
                    before: result(false),
                    after: result(true),
                    changed: true,
                },
                authorization: null,
                error: null,
            },
        });

        render(<PerformanceModePanel nodes={[supported]} zh visible/>);
        expect(inspect).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));
        const selection = await screen.findByRole('checkbox', {name: '选择 AIPACK-13'});
        expect(selection).toBeChecked();
        const scope = screen.getByRole('table', {name: '一键优化范围'});
        expect(within(scope).getByText('Jetson 功耗档位')).toBeInTheDocument();
        expect(within(scope).getByText('AIPACK-13 (未识别)')).toBeInTheDocument();
        expect(within(scope).getByText('MODE_30W → MODE_40W')).toBeInTheDocument();
        const faults = screen.getByRole('table', {name: '故障汇总'});
        expect(within(faults).getByText('可选 1 台')).toBeInTheDocument();

        fireEvent.click(selection);
        expect(screen.getByRole('button', {name: '优化已选（0）'})).toBeDisabled();
        fireEvent.click(selection);
        fireEvent.click(screen.getByRole('button', {name: '优化已选（1）'}));
        expect(await screen.findByRole('dialog', {name: '确认一键优化'}))
            .toHaveTextContent('AIPACK-13');
        fireEvent.click(screen.getByRole('button', {name: '授权并优化'}));

        expect(await screen.findByText('已优化 1 台机器。')).toBeInTheDocument();
        await waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
        expect(create.mock.calls[0][1].request.arguments).toEqual({
            expected_current_mode: 'MODE_30W',
            target_mode: 'MODE_40W',
        });
        await waitFor(() => expect(
            screen.queryByRole('dialog', {name: '确认一键优化'}),
        ).not.toBeInTheDocument());
        expect(screen.getByRole('button', {name: '优化已选（0）'})).toBeDisabled();
        expect(screen.getByRole('button', {name: '重新扫描'})).toBeInTheDocument();
    });
});
