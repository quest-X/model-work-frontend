import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {saveAs} from 'file-saver';
import {PlatformLoginPanel} from '../PlatformLoginPanel';

jest.mock('file-saver', () => ({saveAs: jest.fn()}));
jest.mock('../../../services/AccountService', () => ({accountCsrfToken: () => 'csrf-test'}));
jest.mock('../../../services/ComputeClusterService', () => ({ComputeClusterService: {
    nodes: jest.fn(async () => [{node_id: 'node-1', name: 'baosight-01', role: 'main', capabilities: ['platform.host.v1']}]),
}}));
const calls: Array<{action: string; body: object}> = [];
beforeEach(() => {
    calls.length = 0;
    jest.clearAllMocks();
    global.fetch = jest.fn(async (_url, init) => {
        expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-test');
        const request = JSON.parse(init?.body as string); calls.push(request);
        return {ok: true, json: async () => request.action === 'list'
            ? {grants: [{grant_id: 'grant-1', label: 'Mac Master', expires_at: 2000000000, revoked_at: null}], imports: []}
            : {purpose: 'public-synthetic-file'}} as Response;
    });
});
const file = (data: object) => {
    const result = new File([JSON.stringify(data)], 'request.json', {type: 'application/json'});
    Object.defineProperty(result, 'text', {value: async () => JSON.stringify(data)});
    return result;
};
it('exports only after an explicit pairing action and imports to the selected platform', async () => {
    render(<PlatformLoginPanel zh/>);
    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('管理授权文件'));
    await screen.findByRole('option', {name: 'baosight-01'});
    expect(screen.getByLabelText('远端导出的授权文件')).toBeDisabled();
    fireEvent.click(screen.getByText('本机：导出接入申请'));
    await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('接入申请文件'), {target: {files: [file({public_key: 'public-test'})]}});
    await waitFor(() => expect(screen.getByText('授权并导出文件')).not.toBeDisabled());
    fireEvent.click(screen.getByText('授权并导出文件'));
    await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(2));
    expect(calls).toContainEqual({action: 'export', body: {request: {public_key: 'public-test'}, label: 'Mac Master', days: 30}});
    await waitFor(() => expect(screen.getByLabelText('远程平台')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('远程平台'), {target: {value: 'node-1'}});
    fireEvent.change(screen.getByLabelText('远端导出的授权文件'), {target: {files: [file({payload: 'grant-test'})]}});
    await screen.findByText('已导入，请重新打开远程平台。');
    expect(calls).toContainEqual({action: 'import', body: {node_id: 'node-1', document: {payload: 'grant-test'}}});
    fireEvent.click(screen.getByText('撤销授权及关联会话'));
    await waitFor(() => expect(calls).toContainEqual({action: 'revoke', body: {grant_id: 'grant-1'}}));
});
