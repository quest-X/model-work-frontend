import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {saveAs} from 'file-saver';
import {
    ComputeClusterNode, ComputeClusterRequestError, ComputeClusterService, ConfigBackupHistory, ConfigBackupSnapshot,
    ConfigRestoreAuthorization,
    ConfigRestorePreview, ConfigRestoreReceipt, ConfigRestoreRequest,
} from '../../../services/ComputeClusterService';
import * as ApprovalIdentity from '../../../services/ApprovalIdentityService';
import {ConfigBackupPanel} from '../ConfigBackupPanel';

jest.mock('file-saver', () => ({saveAs: jest.fn()}));
jest.mock('../../../services/ApprovalIdentityService', () => ({
    ...jest.requireActual('../../../services/ApprovalIdentityService'),
    signAuthorization: jest.fn(),
}));

const nodeId = '00000000-0000-4000-8000-000000000011';
const backupId = '00000000-0000-4000-8000-000000000055';
const previousId = '00000000-0000-4000-8000-000000000056';
const approvalId = '00000000-0000-4000-8000-000000000077';
const other = '00000000-0000-4000-8000-000000000088';
const node = {node_id: nodeId, installation_id: nodeId, name: '样例设备', role: 'node', online: true,
    capabilities: ['runtime.config.backup.read.v1', 'control.config.backup.v1', 'control.config.restore.v1'],
} as ComputeClusterNode;
const before = 'a'.repeat(64);
const after = 'b'.repeat(64);
const backup: ConfigBackupSnapshot = {
    schema_version: 'model-work-node.config-backup.v1', installation_id: nodeId, role: 'node', created_at: 1,
    backup_id: backupId, configuration_sha256: after,
    settings: {name: '样例设备', agent_host: '127.0.0.1', agent_port: 7465, tailscale_auto_start: true},
};
const history: ConfigBackupHistory = {
    installation_id: nodeId, current_digest: before, backups: [{backup_id: backupId, kind: 'manual', recorded_at: 1}],
    restores: [], backups_have_more: false, restores_have_more: false,
};
const preview: ConfigRestorePreview = {
    installation_id: nodeId, backup_id: backupId, expected_digest: before, target_digest: after,
    changes: [{field: 'agent_port', before: 8123, after: 7465}], requires_restart: true,
};
const makeTicket = (request: ConfigRestoreRequest): ConfigRestoreAuthorization => ({
    version: 1, purpose: 'model-work-node.user-authorization.v1', authorization_id: approvalId, user_id: other,
    user_name: 'fixture operator', user_public_key: 'fixture', target_installation_id: nodeId,
    operation: 'config.restore.apply', target: {kind: 'config_backup', backup_id: request.backup_id, request_id: request.request_id},
    parameters: {expected_digest: request.expected_digest, target_digest: request.target_digest},
    nonce: 'c'.repeat(64), issued_at: 1, expires_at: 121, state: 'pending', error_code: null,
});
const prepare = async () => {
    fireEvent.click(await screen.findByRole('button', {name: '查看差异'}));
    fireEvent.click(await screen.findByRole('button', {name: '准备恢复授权'}));
    return screen.findByRole('dialog', {name: '确认恢复配置'});
};

const selectFile = (document: unknown) => {
    const file = new File(['fixture'], 'backup.json');
    Object.defineProperty(file, 'text', {value: async () => JSON.stringify(document)});
    fireEvent.change(screen.getByLabelText('备份文件'), {target: {files: [file]}});
};

afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
});

it('creates, exports and imports backups without forwarding invalid or wrong-device files', async () => {
    const load = jest.spyOn(ComputeClusterService, 'configBackupHistory').mockResolvedValue(history);
    const create = jest.spyOn(ComputeClusterService, 'createConfigBackup').mockResolvedValue(backup);
    const exportBackup = jest.spyOn(ComputeClusterService, 'exportConfigBackup').mockResolvedValue(backup);
    const importBackup = jest.spyOn(ComputeClusterService, 'importConfigBackup').mockResolvedValue(backup);
    render(<ConfigBackupPanel node={node} zh/>);

    fireEvent.click(await screen.findByRole('button', {name: '下载'}));
    expect(exportBackup).toHaveBeenCalledWith(nodeId, backupId, expect.any(AbortSignal));
    await waitFor(() => expect(screen.getByRole('button', {name: '导入备份'})).toBeEnabled());
    expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), `opensight-config-${backupId}.json`);

    selectFile({...backup, settings: {...backup.settings, token: 'fixture'}});
    expect(await screen.findByRole('alert')).toHaveTextContent('格式或字段无效');
    selectFile({...backup, installation_id: other});
    expect(await screen.findByRole('alert')).toHaveTextContent('其他安装实例');
    expect(importBackup).not.toHaveBeenCalled();

    selectFile(backup);
    expect(await screen.findByText('备份已导入。')).toBeInTheDocument();
    expect(importBackup).toHaveBeenCalledWith(nodeId, backup, expect.any(AbortSignal));
    fireEvent.click(screen.getByRole('button', {name: '创建备份'}));
    expect(await screen.findByText('备份已保存。')).toBeInTheDocument();
    expect(create).toHaveBeenCalledWith(nodeId, expect.any(AbortSignal));
    expect(load).toHaveBeenCalledTimes(3);
});

it('signs only after showing the exact device and differences, then reconciles a lost write acknowledgement', async () => {
    let request: ConfigRestoreRequest;
    let receipt: ConfigRestoreReceipt | undefined;
    jest.spyOn(ComputeClusterService, 'configBackupHistory').mockImplementation(async () => ({
        ...history, current_digest: receipt ? after : before, restores: receipt ? [receipt] : [],
    }));
    jest.spyOn(ComputeClusterService, 'previewConfigRestore').mockResolvedValue(preview);
    const create = jest.spyOn(ComputeClusterService, 'createConfigRestoreAuthorization').mockImplementation(async (_, value) => {
        request = value;
        return makeTicket(value);
    });
    const approve = jest.spyOn(ComputeClusterService, 'approveConfigRestore').mockImplementation(async () => {
        receipt = {...request, installation_id: nodeId, previous_backup_id: previousId, state: 'target_observed',
            recovered: true, created_at: 1, finished_at: 2};
        throw new Error('connection closed');
    });
    jest.mocked(ApprovalIdentity.signAuthorization).mockResolvedValue('signature');
    render(<ConfigBackupPanel node={node} zh/>);
    const dialog = await prepare();
    expect(dialog).toHaveTextContent('样例设备');
    expect(dialog).toHaveTextContent('8123 → 7465');
    expect(dialog).toHaveTextContent(after);
    expect(dialog).toHaveTextContent('重新加载节点服务');
    expect(create).toHaveBeenCalledWith(nodeId, expect.objectContaining({
        backup_id: backupId, expected_digest: before, target_digest: after,
    }), expect.any(AbortSignal));
    expect(approve).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', {name: '签名并恢复'}));
    expect(await screen.findByText(/恢复结果待核对/)).toHaveTextContent(receipt?.request_id ?? 'expected receipt');
    expect(approve).toHaveBeenCalledWith(nodeId, backupId, approvalId, 'signature', expect.any(AbortSignal));
    expect(await screen.findByRole('button', {name: '查看差异'})).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', {name: '核对恢复记录'}));
    expect(await screen.findByRole('button', {name: '查看恢复前快照'})).toBeEnabled();
    expect(screen.queryByText(/恢复结果待核对/)).not.toBeInTheDocument();
});

it('allows a fresh preview after the console rejects restore before dispatch', async () => {
    jest.spyOn(ComputeClusterService, 'configBackupHistory').mockResolvedValue(history);
    const readPreview = jest.spyOn(ComputeClusterService, 'previewConfigRestore').mockResolvedValue(preview);
    jest.spyOn(ComputeClusterService, 'createConfigRestoreAuthorization').mockImplementation(async (_, value) => makeTicket(value));
    jest.spyOn(ComputeClusterService, 'approveConfigRestore')
        .mockRejectedValue(new ComputeClusterRequestError(403, 'Forbidden'));
    jest.mocked(ApprovalIdentity.signAuthorization).mockResolvedValue('signature');
    render(<ConfigBackupPanel node={node} zh/>);

    fireEvent.click(within(await prepare()).getByRole('button', {name: '签名并恢复'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('当前账号或签名身份无权操作。');
    expect(screen.queryByRole('button', {name: '核对恢复记录'})).not.toBeInTheDocument();
    const retry = screen.getByRole('button', {name: '查看差异'});
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(await screen.findByRole('button', {name: '准备恢复授权'})).toBeEnabled();
    expect(readPreview).toHaveBeenCalledTimes(2);
});

it('discards approval when the signature identity changes before submission', async () => {
    jest.spyOn(ComputeClusterService, 'configBackupHistory').mockResolvedValue(history);
    jest.spyOn(ComputeClusterService, 'previewConfigRestore').mockResolvedValue(preview);
    jest.spyOn(ComputeClusterService, 'createConfigRestoreAuthorization').mockImplementation(async (_, value) => makeTicket(value));
    const approve = jest.spyOn(ComputeClusterService, 'approveConfigRestore');
    let finishSigning!: (signature: string) => void;
    jest.mocked(ApprovalIdentity.signAuthorization).mockImplementation(() => new Promise(resolve => {finishSigning = resolve;}));

    render(<ConfigBackupPanel node={node} zh/>);
    const dialog = await prepare();
    fireEvent.click(within(dialog).getByRole('button', {name: '签名并恢复'}));
    await act(async () => {
        window.dispatchEvent(new Event(ApprovalIdentity.APPROVAL_IDENTITY_CHANGED));
        finishSigning('old signature');
    });
    expect(approve).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', {name: '查看差异'})).not.toBeInTheDocument();
});
