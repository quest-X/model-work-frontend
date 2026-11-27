import React from 'react';
import {TextEncoder as NodeTextEncoder} from 'util';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {
    ComputeClusterNode, ComputeClusterService, ModelDeliveryAuthorization, ModelDeliveryProgress, ModelVersionHistory,
} from '../../../services/ComputeClusterService';
import * as ApprovalIdentity from '../../../services/ApprovalIdentityService';
import {sha256Bytes} from '../../../utils/Sha256';
import {ModelDeliveryPanel} from '../ModelDeliveryPanel';

jest.mock('../../../services/ApprovalIdentityService', () => ({
    ...jest.requireActual('../../../services/ApprovalIdentityService'),
    currentApprovalUser: jest.fn(),
    signAuthorization: jest.fn(),
}));

beforeAll(() => {
    if (!globalThis.TextEncoder) Object.defineProperty(globalThis, 'TextEncoder', {value: NodeTextEncoder, configurable: true});
});

const nodeId = '00000000-0000-4000-8000-000000000011';
const before = '00000000-0000-4000-8000-000000000055';
const after = '00000000-0000-4000-8000-000000000056';
const approvalId = '00000000-0000-4000-8000-000000000077';
const user = {
    user_id: '00000000-0000-4000-8000-000000000088',
    user_name: 'Fixture', user_public_key: `${'A'.repeat(43)}=`,
};
const node = {node_id: nodeId, installation_id: nodeId, name: '样例设备'} as ComputeClusterNode;
const modelId = 'example';
const history: ModelVersionHistory = {
    installation_id: nodeId, model_id: modelId, active_license_id: before, history: [], has_more: false,
};
const permit = {
    version: 1, purpose: 'model-work-node.model-license.v1',
    installation_id: nodeId, license_id: after, model_id: modelId,
    model_sha256: 'a'.repeat(64), package_sha256: 'b'.repeat(64),
};
const chunkSize = 768 * 1024;
const size = chunkSize + 20;

const selectFiles = () => {
    const permitFile = new File(['fixture'], 'license.json');
    Object.defineProperty(permitFile, 'text', {value: async () => JSON.stringify(permit)});
    const packageFile = new File([new Uint8Array(size)], 'model.enc');
    Object.defineProperty(packageFile, 'slice', {
        value: (start: number, end: number) => ({arrayBuffer: async () => new ArrayBuffer(end - start)}),
    });
    fireEvent.change(screen.getByLabelText('签名许可文件'), {target: {files: [permitFile]}});
    fireEvent.change(screen.getByLabelText('加密模型包'), {target: {files: [packageFile]}});
};

afterEach(() => {
    jest.restoreAllMocks();
    sessionStorage.clear();
});

it('resumes from the node offset after a lost acknowledgement and requires a separate signed installation', async () => {
    jest.mocked(ApprovalIdentity.currentApprovalUser).mockReturnValue(user);
    jest.mocked(ApprovalIdentity.signAuthorization).mockResolvedValue('fixture-signature');
    let requestId = '';
    let received = 0;
    const progress = (): ModelDeliveryProgress => ({
        installation_id: nodeId, request_id: requestId, model_id: modelId, license_id: after,
        received_bytes: received, package_size: size, expires_at: 4_000_000_000,
    });
    const open = jest.spyOn(ComputeClusterService, 'openModelDelivery').mockImplementation(async (_, request) => {
        requestId = request.request_id;
        return progress();
    });
    const send = jest.spyOn(ComputeClusterService, 'sendModelDeliveryChunk')
        .mockImplementationOnce(async (_, id, offset) => {
            expect(id).toBe(requestId);
            expect(offset).toBe(0);
            received = chunkSize;
            throw new Error('response lost after write');
        }).mockImplementationOnce(async (_, id, offset, data) => {
            expect(id).toBe(requestId);
            expect(offset).toBe(chunkSize);
            expect(atob(data)).toHaveLength(20);
            received = size;
            return progress();
        });
    const prepare = jest.spyOn(ComputeClusterService, 'createModelDeliveryAuthorization');
    const approve = jest.spyOn(ComputeClusterService, 'approveModelDelivery');
    const refresh = jest.fn().mockResolvedValue({...history, active_license_id: after});

    const first = render(<ModelDeliveryPanel node={node} history={history} zh disabled={false} refreshHistory={refresh}/>);
    selectFiles();
    fireEvent.click(screen.getByRole('button', {name: '开始上传'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('response lost after write');
    const originalId = requestId;
    first.unmount();

    render(<ModelDeliveryPanel node={node} history={history} zh disabled={false} refreshHistory={refresh}/>);
    expect(screen.getByText(originalId)).toBeInTheDocument();
    expect(screen.getByRole('button', {name: '继续上传'})).toBeDisabled();
    selectFiles();
    fireEvent.click(screen.getByRole('button', {name: '继续上传'}));
    const authorize = await screen.findByRole('button', {name: '准备安装授权'});
    expect(screen.getByLabelText('加密模型包')).toBeDisabled();
    expect(screen.getByLabelText('签名许可文件')).toBeDisabled();
    expect(open).toHaveBeenLastCalledWith(nodeId, {
        request_id: originalId, model_id: modelId, expected_license_id: before, package_size: size,
    }, permit, expect.any(AbortSignal));
    expect(send).toHaveBeenCalledTimes(2);
    expect(prepare).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();

    const ticket: ModelDeliveryAuthorization = {
        version: 1, purpose: 'model-work-node.user-authorization.v1', ...user,
        operation: 'model.delivery.commit', target_installation_id: nodeId,
        authorization_id: approvalId, nonce: 'c'.repeat(64), issued_at: 1, expires_at: 121,
        state: 'pending', error_code: null,
        target: {kind: 'model_delivery', request_id: originalId, model_id: modelId, license_id: after},
        parameters: {
            expected_license_id: before, package_size: size, model_sha256: permit.model_sha256,
            package_sha256: permit.package_sha256,
            license_sha256: await sha256Bytes(new TextEncoder().encode(ApprovalIdentity.canonicalAuthorizationJson(permit))),
        },
    };
    prepare.mockResolvedValue(ticket);
    approve.mockResolvedValue({
        authorization: {...ticket, state: 'succeeded'},
        receipt: {
            installation_id: nodeId, request_id: originalId, model_id: modelId, license_id: after,
            previous_license_id: before, model_sha256: permit.model_sha256, package_sha256: permit.package_sha256,
            operation: 'update', current: true, replayed: false, changed_at: 2, expires_at: 4_000_000_000,
        },
    });
    fireEvent.click(authorize);
    const dialog = await screen.findByRole('dialog', {name: '确认模型包安装'});
    expect(dialog).toHaveTextContent(`${before} → ${after}`);
    expect(dialog).toHaveTextContent(permit.package_sha256);
    fireEvent.click(within(dialog).getByRole('button', {name: '签名并安装'}));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith(expect.any(AbortSignal)));
    expect(approve).toHaveBeenCalledWith(nodeId, originalId, approvalId, 'fixture-signature', expect.any(AbortSignal));
    expect(screen.getByText('模型包安装已记录。')).toBeInTheDocument();
    expect(screen.getByLabelText('加密模型包')).toBeEnabled();
    expect(screen.getByLabelText('签名许可文件')).toBeEnabled();
    expect(await screen.findByRole('button', {name: '开始上传'})).toBeDisabled();
    expect(sessionStorage.length).toBe(0);
});
