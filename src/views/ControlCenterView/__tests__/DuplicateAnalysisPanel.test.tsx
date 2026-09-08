import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeDuplicateAuthorization,
    ComputeDuplicateResponse,
    ComputeDuplicateResult,
} from '../../../services/ComputeClusterService';
import * as ApprovalIdentity from '../../../services/ApprovalIdentityService';
import {DuplicateAnalysisPanel} from '../DuplicateAnalysisPanel';

jest.mock('uuid', () => ({v4: () => '00000000-0000-4000-8000-000000000033'}));
jest.mock('../../../services/ApprovalIdentityService', () => ({
    canonicalAuthorizationJson: (value: unknown) => JSON.stringify(value),
    getApprovalIdentity: jest.fn(),
    signAuthorization: jest.fn(),
}));

const nodeId = '00000000-0000-4000-8000-000000000011';
const authorizationId = '00000000-0000-4000-8000-000000000022';
const requestId = '00000000-0000-4000-8000-000000000033';
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
    capabilities: ['task.duplicate.scan.v1'],
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

const authorization = (state: ComputeDuplicateAuthorization['state']): ComputeDuplicateAuthorization => ({
    version: 1,
    purpose: 'model-work-node.user-authorization.v1',
    authorization_id: authorizationId,
    ...user,
    target_installation_id: nodeId,
    operation: 'agentos.duplicate.scan',
    target: {
        kind: 'duplicate_roots', roots: [{kind: 'path', path: 'C:\\Data'}],
        request_id: requestId, idempotency_key: requestId,
    },
    parameters: {min_file_bytes: 1024 * 1024, max_groups: 200},
    nonce: 'a'.repeat(64),
    issued_at: 1,
    expires_at: 121,
    state,
    error_code: null,
    node_name: node.name,
});

const result: ComputeDuplicateResult = {
    schema_version: 'duplicate.scan-result.v1',
    summary: {
        file_count: 3, candidate_file_count: 3, duplicate_file_count: 2, group_count: 1,
        total_bytes: 30, reclaimable_bytes: 10, bytes_hashed: 40, inaccessible_count: 0,
        skipped_link_count: 0, skipped_hardlink_count: 1, changed_count: 0,
        warning_count: 0, elapsed_ms: 2,
    },
    groups: [{
        sha256: 'a'.repeat(64), size: 10, file_count: 2, reclaimable_bytes: 10,
        files: [
            {root_index: 0, relative_path: 'a.bin', modified_at: 1},
            {root_index: 0, relative_path: 'b.bin', modified_at: 1},
        ],
        truncated: false,
    }],
    truncated: false,
    warnings: [],
};

const response = (state: ComputeDuplicateResponse['state']): ComputeDuplicateResponse => ({
    schema_version: 'agentos.capability-response.v1',
    request_id: requestId,
    tool: 'agentos.duplicate.scan',
    node_id: nodeId,
    state,
    task_id: state === 'authorization_required' ? null : authorizationId,
    progress: null,
    result: state === 'succeeded' ? result : null,
    authorization: state === 'authorization_required' ? {
        authorization_id: authorizationId,
        operation: 'agentos.duplicate.scan',
        target_summary: 'C:\\Data',
        parameters_summary: '1 MiB; 200 groups',
        expires_at: 121,
    } : null,
    error: null,
});

describe('DuplicateAnalysisPanel', () => {
    afterEach(() => jest.restoreAllMocks());

    it('authorizes an exact read-only scan and reports confirmed groups', async () => {
        (ApprovalIdentity.getApprovalIdentity as jest.Mock).mockReturnValue({privateKey: {}, user});
        (ApprovalIdentity.signAuthorization as jest.Mock).mockResolvedValue('signed');
        const create = jest.spyOn(ComputeClusterService, 'createDuplicateAuthorization').mockResolvedValue({
            authorization: authorization('pending'), response: response('authorization_required'),
        });
        jest.spyOn(ComputeClusterService, 'approveDuplicateAuthorization').mockResolvedValue({
            authorization: authorization('approved'), response: response('queued'),
        });
        jest.spyOn(ComputeClusterService, 'duplicateStatus').mockResolvedValue(response('succeeded'));

        render(<DuplicateAnalysisPanel node={node} zh visible/>);
        fireEvent.change(screen.getByRole('textbox', {name: '重复文件扫描目录'}), {target: {value: 'C:\\Data'}});
        fireEvent.click(screen.getByRole('button', {name: '查找重复文件'}));

        expect(await screen.findByRole('dialog', {name: '确认只读重复文件扫描'})).toHaveTextContent('C:\\Data');
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            request: expect.objectContaining({
                tool: 'agentos.duplicate.scan',
                arguments: {roots: [{kind: 'path', path: 'C:\\Data'}], min_file_bytes: 1024 * 1024, max_groups: 200},
            }),
        }));
        fireEvent.click(screen.getByRole('button', {name: '授权并扫描'}));

        expect(await screen.findByText('a.bin')).toBeInTheDocument();
        expect(screen.getAllByText('10 B')).toHaveLength(3);
        expect(screen.queryByRole('button', {name: /删除/})).not.toBeInTheDocument();
        await waitFor(() => expect(ComputeClusterService.duplicateStatus).toHaveBeenCalled());
    });

    it('closes a failed authorization so it cannot be submitted again', async () => {
        (ApprovalIdentity.getApprovalIdentity as jest.Mock).mockReturnValue({privateKey: {}, user});
        (ApprovalIdentity.signAuthorization as jest.Mock).mockResolvedValue('signed');
        jest.spyOn(ComputeClusterService, 'createDuplicateAuthorization').mockResolvedValue({
            authorization: authorization('pending'), response: response('authorization_required'),
        });
        jest.spyOn(ComputeClusterService, 'approveDuplicateAuthorization')
            .mockRejectedValue(new Error('authorization_scope_denied'));

        render(<DuplicateAnalysisPanel node={node} zh visible/>);
        fireEvent.change(screen.getByRole('textbox', {name: '重复文件扫描目录'}), {target: {value: 'C:\\Data'}});
        fireEvent.click(screen.getByRole('button', {name: '查找重复文件'}));
        fireEvent.click(await screen.findByRole('button', {name: '授权并扫描'}));

        expect(await screen.findByRole('alert')).toHaveTextContent('本次授权无效，请重新开始扫描。');
        expect(screen.queryByRole('dialog', {name: '确认只读重复文件扫描'})).not.toBeInTheDocument();
    });
});
