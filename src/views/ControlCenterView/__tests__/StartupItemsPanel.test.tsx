import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {
    ComputeClusterNode,
    ComputeClusterRequestError,
    ComputeClusterService,
    ComputeStartupAuthorization,
    ComputeStartupAuthorizationResult,
    ComputeStartupItem,
} from '../../../services/ComputeClusterService';
import * as ApprovalIdentity from '../../../services/ApprovalIdentityService';
import {StartupItemsPanel} from '../StartupItemsPanel';

jest.mock('uuid', () => ({v4: () => '00000000-0000-4000-8000-000000000033'}));
jest.mock('../../../services/ApprovalIdentityService', () => ({
    ...jest.requireActual('../../../services/ApprovalIdentityService'),
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

    it('distinguishes a denied list from a successful empty list after retry', async () => {
        jest.spyOn(ComputeClusterService, 'startupItems')
            .mockRejectedValueOnce(new ComputeClusterRequestError(403, 'Forbidden'))
            .mockResolvedValueOnce({
                schema_version: 'startup.list-result.v1', platform: 'windows', available: true, items: [],
            });

        render(<StartupItemsPanel node={node} zh visible readOnly/>);
        expect(screen.getByRole('status')).toHaveTextContent('正在读取启动项');
        expect(await screen.findByRole('alert')).toHaveTextContent('当前账号无权读取启动项');
        expect(screen.queryByText('当前没有启动项')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '重试'}));
        expect(await screen.findByText('当前没有启动项')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('requires a fresh exact authorization for disable and restore', async () => {
        (ApprovalIdentity.getApprovalIdentity as jest.Mock).mockReturnValue({privateKey: {}, user});
        (ApprovalIdentity.signAuthorization as jest.Mock).mockResolvedValue('signed');
        jest.spyOn(ComputeClusterService, 'startupItems').mockResolvedValue({
            schema_version: 'startup.list-result.v1', platform: 'windows', available: true,
            items: [item, protectedItem],
        });
        const restore = challenge(true);
        const restoreId = '00000000-0000-4000-8000-000000000023';
        restore.authorization.authorization_id = restoreId;
        if (restore.response.authorization) restore.response.authorization.authorization_id = restoreId;
        const create = jest.spyOn(ComputeClusterService, 'createStartupAuthorization')
            .mockResolvedValueOnce(challenge(false))
            .mockResolvedValueOnce(restore);
        const applied = (prepared: ComputeStartupAuthorizationResult): ComputeStartupAuthorizationResult => ({
            authorization: {...prepared.authorization, state: 'succeeded'},
            response: {
                schema_version: 'agentos.capability-response.v1', request_id: requestId,
                tool: 'agentos.startup.set_enabled', node_id: nodeId, state: 'succeeded',
                task_id: null, progress: null,
                result: {
                    schema_version: 'startup.set-enabled-result.v1',
                    item: {...item, enabled: prepared.authorization.parameters.enabled},
                    previous_enabled: prepared.authorization.parameters.expected_enabled, changed: true,
                },
                authorization: null, error: null,
            },
        });
        const apply = jest.spyOn(ComputeClusterService, 'approveStartupAuthorization')
            .mockResolvedValueOnce(applied(challenge(false)))
            .mockResolvedValueOnce(applied(restore));

        render(<StartupItemsPanel node={node} zh visible/>);
        expect(await screen.findByRole('button', {name: '受保护'})).toBeDisabled();
        fireEvent.click(await screen.findByRole('button', {name: '禁用'}));
        const confirm = await screen.findByRole('dialog', {name: '确认禁用启动项'});
        expect(confirm).toHaveTextContent('baoxin-156-windows · ExampleUpdater · 当前用户');
        expect(confirm).toHaveTextContent('已启用 → 已禁用');
        fireEvent.click(within(confirm).getByRole('button', {name: '授权并执行'}));
        expect(await screen.findByText('已禁用')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole('dialog', {name: '确认禁用启动项'})).not.toBeInTheDocument());
        const receipts = screen.getByRole('region', {name: '此面板的启动项操作记录'});
        expect(receipts).toHaveTextContent('已确认执行');
        expect(receipts).toHaveTextContent(authorizationId);

        fireEvent.click(screen.getByRole('button', {name: '恢复'}));
        const restoreDialog = await screen.findByRole('dialog', {name: '确认恢复启动项'});
        expect(restoreDialog).toHaveTextContent('已禁用 → 已启用');
        fireEvent.click(within(restoreDialog).getByRole('button', {name: '授权并执行'}));
        expect(await screen.findByText('已启用')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole('dialog', {name: '确认恢复启动项'})).not.toBeInTheDocument());
        expect(apply).toHaveBeenNthCalledWith(1, authorizationId, 'signed');
        expect(apply).toHaveBeenNthCalledWith(2, restoreId, 'signed');
        expect(create).toHaveBeenCalledTimes(2);
        expect(create.mock.calls[0][1].request.arguments).toEqual({
            item_id: item.item_id, enabled: false, expected_enabled: true,
        });
        expect(create.mock.calls[1][1].request.arguments).toEqual({
            item_id: item.item_id, enabled: true, expected_enabled: false,
        });
    });

    it('closes a terminal failed authorization before retry', async () => {
        (ApprovalIdentity.getApprovalIdentity as jest.Mock).mockReturnValue({privateKey: {}, user});
        (ApprovalIdentity.signAuthorization as jest.Mock).mockResolvedValue('signed');
        jest.spyOn(ComputeClusterService, 'startupItems').mockResolvedValue({
            schema_version: 'startup.list-result.v1', platform: 'windows', available: true, items: [item],
        });
        jest.spyOn(ComputeClusterService, 'createStartupAuthorization').mockResolvedValue(challenge(false));
        jest.spyOn(ComputeClusterService, 'approveStartupAuthorization')
            .mockRejectedValue(new Error('operation_failed'));

        render(<StartupItemsPanel node={node} zh visible/>);
        fireEvent.click(await screen.findByRole('button', {name: '禁用'}));
        fireEvent.click(await screen.findByRole('button', {name: '授权并执行'}));

        expect(await screen.findByText('启动项操作失败，请刷新后重试。')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole('dialog', {name: '确认禁用启动项'})).not.toBeInTheDocument());
        expect(screen.getByRole('button', {name: '禁用'})).toBeDisabled();
        expect(screen.getByRole('region', {name: '此面板的启动项操作记录'})).toHaveTextContent('结果待核对');

        fireEvent.click(screen.getByRole('button', {name: '刷新'}));
        expect(await screen.findByRole('button', {name: '禁用'})).toBeEnabled();
    });

    it('cancels the exact pending approval and shows its receipt without signing', async () => {
        jest.mocked(ApprovalIdentity.signAuthorization).mockClear();
        jest.mocked(ApprovalIdentity.getApprovalIdentity).mockReturnValue({privateKey: {} as CryptoKey, user});
        jest.spyOn(ComputeClusterService, 'startupItems').mockResolvedValue({
            schema_version: 'startup.list-result.v1', platform: 'windows', available: true, items: [item],
        });
        jest.spyOn(ComputeClusterService, 'createStartupAuthorization').mockResolvedValue(challenge(false));
        const reject = jest.spyOn(ComputeClusterService, 'rejectStartupAuthorization')
            .mockResolvedValue({...authorization(false, 'rejected'), state: 'rejected'});
        const apply = jest.spyOn(ComputeClusterService, 'approveStartupAuthorization');

        render(<StartupItemsPanel node={node} zh visible/>);
        fireEvent.click(await screen.findByRole('button', {name: '禁用'}));
        fireEvent.click(await screen.findByRole('button', {name: '取消'}));
        expect(await screen.findByText('已取消授权')).toBeInTheDocument();
        expect(reject).toHaveBeenCalledWith(authorizationId);
        expect(ApprovalIdentity.signAuthorization).not.toHaveBeenCalled();
        expect(apply).not.toHaveBeenCalled();
    });

    it('drops an approval when the signing identity changes before submission', async () => {
        jest.mocked(ApprovalIdentity.getApprovalIdentity).mockReturnValue({privateKey: {} as CryptoKey, user});
        let completeSignature: (value: string) => void = () => undefined;
        jest.mocked(ApprovalIdentity.signAuthorization).mockReturnValueOnce(new Promise(resolve => {
            completeSignature = resolve;
        }));
        jest.spyOn(ComputeClusterService, 'startupItems').mockResolvedValue({
            schema_version: 'startup.list-result.v1', platform: 'windows', available: true, items: [item],
        });
        jest.spyOn(ComputeClusterService, 'createStartupAuthorization').mockResolvedValue(challenge(false));
        const apply = jest.spyOn(ComputeClusterService, 'approveStartupAuthorization');

        render(<StartupItemsPanel node={node} zh visible/>);
        fireEvent.click(await screen.findByRole('button', {name: '禁用'}));
        fireEvent.click(await screen.findByRole('button', {name: '授权并执行'}));
        await act(async () => {
            window.dispatchEvent(new Event(ApprovalIdentity.APPROVAL_IDENTITY_CHANGED));
            completeSignature('old-signature');
        });

        expect(apply).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog', {name: '确认禁用启动项'})).not.toBeInTheDocument();
    });

});
