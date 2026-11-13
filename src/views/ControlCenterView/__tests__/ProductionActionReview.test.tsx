import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {ComputeClusterService, ProductionOperationProposal} from '../../../services/ComputeClusterService';
import {APPROVAL_IDENTITY_CHANGED, getApprovalIdentity, signAuthorization} from '../../../services/ApprovalIdentityService';
import {ProductionActionReview} from '../ProductionActionReview';

jest.mock('../../../services/ApprovalIdentityService', () => ({
    ...jest.requireActual('../../../services/ApprovalIdentityService'),
    getApprovalIdentity: jest.fn(), signAuthorization: jest.fn(),
}));

const id = '00000000-0000-4000-8000-000000000001';
const node = '00000000-0000-4000-8000-000000000011';
const user = {user_id: id, user_name: 'Test reviewer', user_public_key: `${'A'.repeat(43)}=`};
const initial = (): ProductionOperationProposal => ({
    schema_version: 'production.action-proposal.v1', proposal_id: id, node_id: node,
    operation: 'storage_scan', state: 'awaiting_review', target: {request: {arguments: {roots: [{path: '/test-only'}]}}},
    authorization: null,
});
const prepared = (): ProductionOperationProposal => ({
    ...initial(), state: 'prepared', authorization: {
        version: 1, purpose: 'model-work-node.user-authorization.v1', authorization_id: id,
        ...user, target_installation_id: node, operation: 'agentos.storage.scan',
        target: {kind: 'storage_roots', roots: [{path: '/test-only'}]}, parameters: {max_results: 20},
        nonce: 'a'.repeat(64), issued_at: Date.now() / 1000, expires_at: Date.now() / 1000 + 120,
    },
});

beforeEach(() => {
    jest.restoreAllMocks();
    window.history.replaceState(null, '', `/?ops_proposal=${id}`);
    (getApprovalIdentity as jest.Mock).mockReturnValue({user});
    (signAuthorization as jest.Mock).mockReset().mockResolvedValue('test-signature');
    jest.spyOn(ComputeClusterService, 'operationProposal').mockResolvedValue(initial());
    jest.spyOn(ComputeClusterService, 'prepareOperationProposal').mockResolvedValue(prepared());
    jest.spyOn(ComputeClusterService, 'approveOperationProposal').mockResolvedValue({...prepared(), state: 'submitted'});
    jest.spyOn(ComputeClusterService, 'rejectOperationProposal').mockResolvedValue({...initial(), state: 'rejected'});
});

test('opening the concrete request cannot approve it; signing needs the final user action', async () => {
    render(<ProductionActionReview nodes={[{node_id: node, name: 'Test node'}]} zh/>);
    await screen.findByText('Test node');
    expect(ComputeClusterService.prepareOperationProposal).not.toHaveBeenCalled();
    expect(signAuthorization).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: '读取实际目标并准备授权'}));
    const approve = await screen.findByRole('button', {name: '同意并执行'});
    expect(signAuthorization).not.toHaveBeenCalled();
    fireEvent.click(approve);
    await waitFor(() => expect(ComputeClusterService.approveOperationProposal).toHaveBeenCalledWith(id, 'default-project', 'test-signature'));
    expect((signAuthorization as jest.Mock).mock.calls[0][0].target_installation_id).toBe(node);
});

test('a changed authorization target is rejected before the user can sign', async () => {
    const invalid = prepared();
    if (!invalid.authorization) throw new Error('test authorization missing');
    invalid.authorization = {...invalid.authorization, target_installation_id: id};
    jest.spyOn(ComputeClusterService, 'operationProposal').mockResolvedValue(invalid);
    render(<ProductionActionReview nodes={[]} zh/>);
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', {name: '同意并执行'})).toBeNull();
    expect(signAuthorization).not.toHaveBeenCalled();
});

test('changing the approval identity stops an in-flight signature from being submitted', async () => {
    jest.spyOn(ComputeClusterService, 'operationProposal').mockResolvedValue(prepared());
    let finish: (value: string) => void = () => undefined;
    (signAuthorization as jest.Mock).mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    render(<ProductionActionReview nodes={[]} zh/>);
    fireEvent.click(await screen.findByRole('button', {name: '同意并执行'}));
    await waitFor(() => expect(signAuthorization).toHaveBeenCalled());
    await act(async () => {
        window.dispatchEvent(new Event(APPROVAL_IDENTITY_CHANGED));
        finish('old-identity-signature');
    });
    expect(ComputeClusterService.approveOperationProposal).not.toHaveBeenCalled();
});

test('closing the review preserves the pending request and does not reject or execute it', async () => {
    render(<ProductionActionReview nodes={[]} zh/>);
    await screen.findByRole('button', {name: '读取实际目标并准备授权'});
    fireEvent.click(screen.getByRole('button', {name: '关闭审查'}));
    expect(window.location.search).toBe('');
    expect(ComputeClusterService.rejectOperationProposal).not.toHaveBeenCalled();
    expect(ComputeClusterService.approveOperationProposal).not.toHaveBeenCalled();
});
