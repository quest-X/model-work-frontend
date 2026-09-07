import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeTask,
    ComputeStorageAuthorization,
    ComputeStorageResponse,
    ComputeStorageResult,
} from '../../../services/ComputeClusterService';
import * as ApprovalIdentity from '../../../services/ApprovalIdentityService';
import {StorageAnalysisPanel, storageFullPath} from '../StorageAnalysisPanel';

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
    capabilities: ['task.storage.scan.v1'],
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

const authorization = (id: string): ComputeStorageAuthorization => ({
    version: 1,
    purpose: 'model-work-node.user-authorization.v1',
    authorization_id: authorizationId,
    ...user,
    target_installation_id: nodeId,
    operation: 'agentos.storage.scan',
    target: {
        kind: 'storage_roots',
        roots: [{kind: 'path', path: 'C:\\Data'}],
        request_id: id,
        idempotency_key: id,
    },
    parameters: {min_file_bytes: 50 * 1024 * 1024, max_results: 200},
    nonce: 'a'.repeat(64),
    issued_at: Date.now() / 1000,
    expires_at: Date.now() / 1000 + 120,
    state: 'pending',
    error_code: null,
    node_name: node.name,
});

const result: ComputeStorageResult = {
    schema_version: 'storage.scan-result.v1',
    summary: {
        file_count: 2, large_file_count: 1, directory_count: 1, total_bytes: 60 * 1024 * 1024,
        inaccessible_count: 0, skipped_link_count: 0, warning_count: 0, elapsed_ms: 9,
    },
    largest_files: [{root_index: 0, relative_path: 'models/model.onnx', size: 60 * 1024 * 1024, modified_at: 1}],
    largest_directories: [{root_index: 0, relative_path: 'dataset', size: 60 * 1024 * 1024, classification: 'dataset_candidate'}],
    categories: [
        {category: 'model_weight', file_count: 1, total_bytes: 60 * 1024 * 1024},
        {category: 'image', file_count: 0, total_bytes: 0},
        {category: 'video', file_count: 0, total_bytes: 0},
        {category: 'archive', file_count: 0, total_bytes: 0},
        {category: 'log', file_count: 0, total_bytes: 0},
        {category: 'other', file_count: 1, total_bytes: 0},
    ],
    truncated: false,
    warnings: [],
};

const response = (id: string, state: ComputeStorageResponse['state']): ComputeStorageResponse => ({
    schema_version: 'agentos.capability-response.v1',
    request_id: id,
    tool: 'agentos.storage.scan',
    node_id: nodeId,
    state,
    task_id: state === 'authorization_required' ? null : authorizationId,
    progress: state === 'queued' ? {phase: 'walking', roots_completed: 0, roots_total: 1, files_scanned: 0, bytes_scanned: 0} : null,
    result: state === 'succeeded' ? result : null,
    authorization: state === 'authorization_required' ? {
        authorization_id: authorizationId,
        operation: 'agentos.storage.scan',
        target_summary: 'C:\\Data',
        parameters_summary: '50 MiB; 200 results',
        expires_at: Date.now() / 1000 + 120,
    } : null,
    error: null,
});

describe('StorageAnalysisPanel', () => {
    beforeEach(() => {
        (ApprovalIdentity.getApprovalIdentity as jest.Mock).mockReturnValue({privateKey: {}, user});
        (ApprovalIdentity.signAuthorization as jest.Mock).mockResolvedValue('signed');
    });

    afterEach(() => jest.restoreAllMocks());

    it('keeps joined result paths inside their scan root', () => {
        expect(storageFullPath('C:\\Data', 'models/model.onnx')).toBe('C:\\Data\\models\\model.onnx');
        expect(() => storageFullPath('C:\\Data', '../secret.txt')).toThrow('Invalid storage result path');
    });

    it('authorizes one exact scan and renders deterministic result views', async () => {
        const create = jest.spyOn(ComputeClusterService, 'createStorageAuthorization')
            .mockImplementation(async input => ({
                authorization: authorization(input.request.request_id),
                response: response(input.request.request_id, 'authorization_required'),
            }));
        jest.spyOn(ComputeClusterService, 'approveStorageAuthorization').mockResolvedValue({
            authorization: {...authorization(requestId), state: 'approved'},
            response: response(requestId, 'queued'),
        });
        jest.spyOn(ComputeClusterService, 'storageStatus').mockResolvedValue(response(requestId, 'succeeded'));

        render(<StorageAnalysisPanel node={node} zh visible/>);
        fireEvent.change(screen.getByRole('textbox', {name: '扫描目录'}), {target: {value: 'C:\\Data'}});
        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));

        expect(await screen.findByRole('dialog', {name: '确认只读存储扫描'})).toHaveTextContent('C:\\Data');
        expect(create).toHaveBeenCalledWith({
            request: {
                schema_version: 'agentos.capability-request.v1',
                request_id: requestId,
                idempotency_key: requestId,
                tool: 'agentos.storage.scan',
                node_id: nodeId,
                arguments: {roots: [{kind: 'path', path: 'C:\\Data'}], min_file_bytes: 50 * 1024 * 1024, max_results: 200},
            },
            user,
            ttl_seconds: 120,
        });
        fireEvent.click(screen.getByRole('button', {name: '授权并扫描'}));

        expect(await screen.findByText('model.onnx')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('扫描完成');
        await waitFor(() => expect(ComputeClusterService.storageStatus).toHaveBeenCalledWith(
            nodeId, authorizationId, expect.any(AbortSignal),
        ));
        expect(screen.queryByRole('button', {name: /删除/})).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', {name: '最大目录'}));
        expect(screen.getByText('数据集候选')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', {name: '类型分布'}));
        expect(screen.getByText('模型权重')).toBeInTheDocument();
    });

    it('sends cancellation through the existing task lifecycle', async () => {
        jest.spyOn(ComputeClusterService, 'createStorageAuthorization').mockResolvedValue({
            authorization: authorization(requestId),
            response: response(requestId, 'authorization_required'),
        });
        jest.spyOn(ComputeClusterService, 'approveStorageAuthorization').mockResolvedValue({
            authorization: {...authorization(requestId), state: 'approved'},
            response: response(requestId, 'queued'),
        });
        jest.spyOn(ComputeClusterService, 'storageStatus').mockImplementation(() => new Promise(() => undefined));
        const cancel = jest.spyOn(ComputeClusterService, 'controlTask')
            .mockImplementation(async task => ({...task} as ComputeTask));

        render(<StorageAnalysisPanel node={node} zh visible/>);
        fireEvent.change(screen.getByRole('textbox', {name: '扫描目录'}), {target: {value: 'C:\\Data'}});
        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));
        fireEvent.click(await screen.findByRole('button', {name: '授权并扫描'}));
        fireEvent.click(await screen.findByRole('button', {name: '取消扫描'}));

        expect(cancel).toHaveBeenCalledWith({node_id: nodeId, task_id: authorizationId}, 'cancel');
        expect(screen.getByRole('button', {name: '正在取消…'})).toBeDisabled();
    });

    it('pauses the old node poll and resumes it without accepting a late response', async () => {
        let resolveFirstPoll!: (value: ComputeStorageResponse) => void;
        const firstPoll = new Promise<ComputeStorageResponse>(resolve => {
            resolveFirstPoll = resolve;
        });
        const otherNode: ComputeClusterNode = {
            ...node,
            node_id: '00000000-0000-4000-8000-000000000012',
            installation_id: '00000000-0000-4000-8000-000000000012',
            name: 'other-node',
        };
        jest.spyOn(ComputeClusterService, 'createStorageAuthorization').mockResolvedValue({
            authorization: authorization(requestId),
            response: response(requestId, 'authorization_required'),
        });
        jest.spyOn(ComputeClusterService, 'approveStorageAuthorization').mockResolvedValue({
            authorization: {...authorization(requestId), state: 'approved'},
            response: response(requestId, 'queued'),
        });
        const status = jest.spyOn(ComputeClusterService, 'storageStatus')
            .mockImplementationOnce(() => firstPoll)
            .mockResolvedValueOnce(response(requestId, 'succeeded'));
        const panels = (selectedNodeId: string) => <>
            <div hidden={selectedNodeId !== node.node_id}>
                <StorageAnalysisPanel node={node} zh visible={selectedNodeId === node.node_id}/>
            </div>
            <div hidden={selectedNodeId !== otherNode.node_id}>
                <StorageAnalysisPanel node={otherNode} zh visible={selectedNodeId === otherNode.node_id}/>
            </div>
        </>;

        const {rerender} = render(panels(node.node_id));
        fireEvent.change(screen.getByRole('textbox', {name: '扫描目录'}), {target: {value: 'C:\\Data'}});
        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));
        fireEvent.click(await screen.findByRole('button', {name: '授权并扫描'}));
        await waitFor(() => expect(status).toHaveBeenCalledTimes(1));
        const firstSignal = status.mock.calls[0][2];

        rerender(panels(otherNode.node_id));
        expect(firstSignal?.aborted).toBe(true);
        rerender(panels(node.node_id));

        expect(await screen.findByText('model.onnx')).toBeInTheDocument();
        expect(status).toHaveBeenCalledTimes(2);
        expect(status.mock.calls.every(([calledNodeId]) => calledNodeId === node.node_id)).toBe(true);

        await act(async () => {
            resolveFirstPoll(response(requestId, 'queued'));
            await firstPoll;
        });
        expect(screen.queryByText('正在遍历目录')).not.toBeInTheDocument();
    });
});
