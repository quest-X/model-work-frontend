import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {ComputeClusterNode, ComputeClusterService, ComputeFilesystemTarget} from '../../../services/ComputeClusterService';
import * as ApprovalIdentity from '../../../services/ApprovalIdentityService';
import {ComputeFilePanel, remoteChildPath} from '../ComputeFilePanel';

jest.mock('../../../services/ApprovalIdentityService', () => ({
    canonicalAuthorizationJson: (value: unknown) => JSON.stringify(value),
    getApprovalIdentity: jest.fn(),
    signAuthorization: jest.fn(),
}));

const user = {
    user_id: '00000000-0000-4000-8000-000000000099',
    user_name: 'OpenSight Console User',
    user_public_key: `${'A'.repeat(43)}=`,
};

const node: ComputeClusterNode = {
    node_id: 'node-1',
    installation_id: '00000000-0000-4000-8000-000000000011',
    name: 'baoxin-156-windows',
    agent_version: '1.0.3',
    capabilities: ['filesystem.list.v1'],
    network: {provider: 'tailscale', installed: true, online: true, ssh_available: true, addresses: []},
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

describe('ComputeFilePanel', () => {
    it('rejects path separators in remote entry names', () => {
        expect(() => remoteChildPath('C:\\Users', 'Public/Desktop', true)).toThrow('Invalid directory name');
        expect(() => remoteChildPath('/home', 'user/name', false)).toThrow('Invalid directory name');
    });

    beforeEach(() => {
        (ApprovalIdentity.getApprovalIdentity as jest.Mock).mockReturnValue({privateKey: {}, user});
        (ApprovalIdentity.signAuthorization as jest.Mock).mockResolvedValue('signed');
    });

    afterEach(() => jest.restoreAllMocks());

    it('opens the default node at its desktop and returns through cached history', async () => {
        const longName = `${'very-long-'.repeat(30)}report.txt`;
        let target: ComputeFilesystemTarget = {
            kind: 'path', path: 'C:\\Users\\Public\\Desktop',
            source: {kind: 'known_folder', id: 'public_desktop'},
        };
        const create = jest.spyOn(ComputeClusterService, 'createFilesystemAuthorization')
            .mockImplementation(async (_nodeId, request) => {
                target = request.target.kind === 'known_folder'
                    ? {kind: 'path', path: 'C:\\Users\\Public\\Desktop', source: request.target}
                    : {kind: 'path', path: request.target.path};
                return {
                    version: 1,
                    purpose: 'model-work-node.user-authorization.v1',
                    authorization_id: `authorization-${target.path}`,
                    ...user,
                    target_installation_id: node.installation_id,
                    operation: 'filesystem.list',
                    target,
                    parameters: {limit: 500},
                    nonce: 'a'.repeat(64),
                    issued_at: Date.now() / 1000,
                    expires_at: Date.now() / 1000 + 120,
                    state: 'pending',
                    error_code: null,
                    node_name: node.name,
                };
            });
        jest.spyOn(ComputeClusterService, 'approveFilesystemAuthorization')
            .mockImplementation(async authorizationId => ({
                authorization: {
                    version: 1,
                    purpose: 'model-work-node.user-authorization.v1',
                    authorization_id: authorizationId,
                    ...user,
                    target_installation_id: node.installation_id,
                    operation: 'filesystem.list',
                    target,
                    parameters: {limit: 500},
                    nonce: 'a'.repeat(64),
                    issued_at: Date.now() / 1000,
                    expires_at: Date.now() / 1000 + 120,
                    state: 'succeeded',
                    error_code: null,
                },
                result: {
                    schema_version: 'filesystem.list-result.v1',
                    target,
                    entries: target.path.endsWith('Desktop') ? [
                        {name: 'Models', type: 'directory', size: 0, modified_at: 1},
                        {name: longName, type: 'file', size: 7, modified_at: 1},
                    ] : [],
                    total: target.path.endsWith('Desktop') ? 2 : 0,
                    truncated: false,
                },
            }));

        render(<ComputeFilePanel nodes={[node]} zh/>);
        await waitFor(() => expect(screen.getByRole('combobox', {name: '目标节点'})).toHaveValue(node.node_id));
        expect(await screen.findByRole('button', {name: /Models/})).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByText(/report\.txt/)).toBeInTheDocument();
        expect(screen.getByTitle(longName)).toBeInTheDocument();
        expect(screen.queryByText('file contents')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: /Models/}));
        await waitFor(() => expect(create).toHaveBeenLastCalledWith(
            node.node_id,
            expect.objectContaining({target: {kind: 'path', path: 'C:\\Users\\Public\\Desktop\\Models'}}),
        ));
        expect(await screen.findByText('此目录为空。')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '返回上一级已浏览目录'}));
        expect(screen.getByText(/report\.txt/)).toBeInTheDocument();
        expect(create).toHaveBeenCalledTimes(2);
    });

    it('allows retry after a failed transparent read', async () => {
        jest.spyOn(ComputeClusterService, 'createFilesystemAuthorization').mockResolvedValue({
            version: 1,
            purpose: 'model-work-node.user-authorization.v1',
            authorization_id: 'authorization-failed',
            ...user,
            target_installation_id: node.installation_id,
            operation: 'filesystem.list',
            target: {kind: 'path', path: 'C:\\Users\\Public\\Desktop'},
            parameters: {limit: 500},
            nonce: 'a'.repeat(64),
            issued_at: Date.now() / 1000,
            expires_at: Date.now() / 1000 + 120,
            state: 'pending',
            error_code: null,
            node_name: node.name,
        });
        jest.spyOn(ComputeClusterService, 'approveFilesystemAuthorization')
            .mockRejectedValue(new Error('authorization_not_pending: authorization is already failed'));

        render(<ComputeFilePanel nodes={[node]} zh/>);

        expect(await screen.findByRole('alert')).toHaveTextContent('本次读取已失效，请重试。');
        expect(screen.getByRole('button', {name: '桌面'})).toBeEnabled();

        fireEvent.click(screen.getByRole('button', {name: '桌面'}));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(await screen.findByRole('alert')).toHaveTextContent('本次读取已失效，请重试。');
        await waitFor(() => expect(ComputeClusterService.createFilesystemAuthorization).toHaveBeenCalledTimes(2));
    });
});
