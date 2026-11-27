import React from 'react';
import {render, screen} from '@testing-library/react';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeStartupItem,
    ComputeStartupList,
} from '../../../services/ComputeClusterService';
import {StartupItemsPanel} from '../StartupItemsPanel';

jest.mock('uuid', () => ({v4: () => '00000000-0000-4000-8000-000000000033'}));
jest.mock('../../../services/ApprovalIdentityService', () => ({
    canonicalAuthorizationJson: (value: unknown) => JSON.stringify(value),
    getApprovalIdentity: jest.fn(),
    signAuthorization: jest.fn(),
}));

const nodeId = '00000000-0000-4000-8000-000000000011';
const item: ComputeStartupItem = {
    item_id: 'a'.repeat(64), name: 'ExampleUpdater', source: 'user', enabled: true, protected: false,
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

describe('StartupItemsPanel', () => {
    afterEach(() => jest.restoreAllMocks());

    it('loads the latest items on reopen without showing an old list', async () => {
        let resolveRefresh: (value: ComputeStartupList) => void = () => undefined;
        const refresh = new Promise<ComputeStartupList>(resolve => {
            resolveRefresh = resolve;
        });
        const load = jest.spyOn(ComputeClusterService, 'startupItems')
            .mockResolvedValueOnce({
                schema_version: 'startup.list-result.v1', platform: 'windows', available: true,
                items: [item],
            })
            .mockReturnValueOnce(refresh);
        const view = render(<StartupItemsPanel node={node} zh visible/>);

        expect(await screen.findByText('已启用')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '刷新'})).toBeInTheDocument();
        expect(screen.getByRole('searchbox', {name: '搜索启动应用'})).toBeInTheDocument();

        view.rerender(<></>);
        view.rerender(<StartupItemsPanel node={node} zh visible/>);

        expect(screen.queryByText('已启用')).not.toBeInTheDocument();
        resolveRefresh({
            schema_version: 'startup.list-result.v1', platform: 'windows', available: true,
            items: [{...item, enabled: false}],
        });
        expect(await screen.findByText('已禁用')).toBeInTheDocument();
        expect(load).toHaveBeenCalledTimes(2);
        expect(load).toHaveBeenLastCalledWith(nodeId, expect.any(AbortSignal));
        expect(screen.getByRole('button', {name: '刷新'})).toBeInTheDocument();
    });
});
