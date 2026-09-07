import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeStartupAuthorization,
    ComputeStartupAuthorizationResult,
    ComputeStartupItem,
} from '../../../services/ComputeClusterService';
import * as ApprovalIdentity from '../../../services/ApprovalIdentityService';
import {StartupItemsPanel} from '../StartupItemsPanel';

jest.mock('uuid', () => ({v4: () => '00000000-0000-4000-8000-000000000033'}));
jest.mock('../../../services/ApprovalIdentityService', () => ({
    canonicalAuthorizationJson: (value: unknown) => JSON.stringify(value),
    getApprovalIdentity: jest.fn(),
    signAuthorization: jest.fn(),
}));

const nodeId = '00000000-0000-4000-8000-000000000011';
const authorizationId = '00000000-0000-4000-8000-000000000022';
const requestId = '00000000-0000-4000-8000-000000000033';
const item: ComputeStartupItem = {
    item_id: 'a'.repeat(64), name: 'ExampleUpdater', source: 'user', enabled: true, protected: false,
};
const protectedItem: ComputeStartupItem = {
    item_id: 'b'.repeat(64), name: 'OpenSight Node', source: 'machine', enabled: true, protected: true,
};
const user = {
    user_id: '00000000-0000-4000-8000-000000000099',
    user_name: 'OpenSight Console User',
    user_public_key: `${'A'.repeat(43)}=`,
};
const node: ComputeClusterNode = {
    node_id: nodeId,
    installation_id: nodeId,
    name: 'baoxin-156-windows',
    agent_version: '1.1.0',
    capabilities: ['runtime.startup.read.v1', 'control.startup.manage.v1'],
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

const authorization = (enabled: boolean, state: ComputeStartupAuthorization['state']): ComputeStartupAuthorization => ({
    version: 1,
    purpose: 'model-work-node.user-authorization.v1',
    authorization_id: authorizationId,
    ...user,
    target_installation_id: nodeId,
    operation: 'agentos.startup.set_enabled',
    target: {kind: 'startup_item', item_id: item.item_id, request_id: requestId, idempotency_key: requestId},
    parameters: {enabled, expected_enabled: !enabled},
    nonce: 'c'.repeat(64),
    issued_at: 1,
    expires_at: 121,
    state,
    error_code: null,
    node_name: node.name,
});

const challenge = (enabled: boolean): ComputeStartupAuthorizationResult => ({
    authorization: authorization(enabled, 'pending'),
    item: {...item, enabled: !enabled},
    response: {
        schema_version: 'agentos.capability-response.v1', request_id: requestId,
        tool: 'agentos.startup.set_enabled', node_id: nodeId,
        state: 'authorization_required', task_id: null, progress: null, result: null,
        authorization: {
            authorization_id: authorizationId, operation: 'agentos.startup.set_enabled',
            target_summary: item.name, parameters_summary: enabled ? 'enable' : 'disable', expires_at: 121,
        },
        error: null,
    },
});

describe('StartupItemsPanel', () => {
    afterEach(() => jest.restoreAllMocks());

    it('requires a fresh exact authorization for disable and restore', async () => {
        (ApprovalIdentity.getApprovalIdentity as jest.Mock).mockReturnValue({privateKey: {}, user});
        (ApprovalIdentity.signAuthorization as jest.Mock).mockResolvedValue('signed');
        jest.spyOn(ComputeClusterService, 'startupItems').mockResolvedValue({
            schema_version: 'startup.list-result.v1', platform: 'windows', available: true,
            items: [item, protectedItem],
        });
        const create = jest.spyOn(ComputeClusterService, 'createStartupAuthorization')
            .mockResolvedValueOnce(challenge(false))
            .mockResolvedValueOnce(challenge(true));
        jest.spyOn(ComputeClusterService, 'approveStartupAuthorization').mockResolvedValue({
            authorization: authorization(false, 'succeeded'),
            response: {
                schema_version: 'agentos.capability-response.v1', request_id: requestId,
                tool: 'agentos.startup.set_enabled', node_id: nodeId, state: 'succeeded',
                task_id: null, progress: null,
                result: {
                    schema_version: 'startup.set-enabled-result.v1',
                    item: {...item, enabled: false}, previous_enabled: true, changed: true,
                },
                authorization: null, error: null,
            },
        });

        render(<StartupItemsPanel node={node} zh visible/>);
        expect(await screen.findByRole('button', {name: '受保护'})).toBeDisabled();
        fireEvent.click(await screen.findByRole('button', {name: '禁用'}));
        fireEvent.click(await screen.findByRole('button', {name: '授权并执行'}));
        expect(await screen.findByText('已禁用')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole('dialog', {name: '确认禁用启动项'})).not.toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', {name: '恢复'}));
        await screen.findByRole('dialog', {name: '确认恢复启动项'});
        await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
        expect(create.mock.calls[0][1].request.arguments).toEqual({
            item_id: item.item_id, enabled: false, expected_enabled: true,
        });
        expect(create.mock.calls[1][1].request.arguments).toEqual({
            item_id: item.item_id, enabled: true, expected_enabled: false,
        });
    });
});
