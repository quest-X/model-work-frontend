import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Button, Dialog, DialogActions, DialogContent, DialogTitle} from '@mui/material';
import {saveAs} from 'file-saver';
import {v4 as uuidv4} from 'uuid';
import {
    ComputeClusterNode, ComputeClusterRequestError, ComputeClusterService, ConfigBackupHistory, ConfigBackupSnapshot,
    ConfigRestoreAuthorization,
    ConfigRestorePreview, ConfigRestoreReceipt, ConfigRestoreRequest, isComputeAccessDenied,
} from '../../services/ComputeClusterService';
import {
    APPROVAL_IDENTITY_CHANGED, authorizationChallenge, canonicalAuthorizationJson, signAuthorization,
} from '../../services/ApprovalIdentityService';

const digest = /^[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const fileLimit = 16 * 1024;
const fieldLabels = {
    name: ['设备名称', 'Device name'],
    agent_host: ['Agent 回环地址', 'Agent loopback address'],
    agent_port: ['Agent 端口', 'Agent port'],
    tailscale_auto_start: ['Tailscale 自动启动', 'Tailscale auto-start'],
} as const;
const backupKinds = {
    manual: ['手动备份', 'Manual backup'],
    imported: ['已导入', 'Imported'],
    before_restore: ['恢复前快照', 'Before restore'],
} as const;
const restoreStates = {
    applied: ['配置已写入', 'Configuration saved'],
    target_observed: ['已核对磁盘为目标配置', 'Target configuration observed on disk'],
    previous_observed: ['已核对磁盘仍为原配置', 'Previous configuration observed on disk'],
    uncertain: ['结果待核对', 'Result unconfirmed'],
} as const;

const matches = (scope: ConfigRestoreRequest, auth: ConfigRestoreAuthorization, installationId: string) =>
    auth.operation === 'config.restore.apply' && auth.target_installation_id === installationId
    && auth.target.kind === 'config_backup' && auth.target.backup_id === scope.backup_id
    && auth.target.request_id === scope.request_id && auth.parameters.expected_digest === scope.expected_digest
    && auth.parameters.target_digest === scope.target_digest;

const sameChallenge = (left: ConfigRestoreAuthorization, right: ConfigRestoreAuthorization) =>
    canonicalAuthorizationJson(authorizationChallenge(left)) === canonicalAuthorizationJson(authorizationChallenge(right));

const matchesReceipt = (row: ConfigRestoreReceipt, scope: ConfigRestoreRequest, installationId: string) =>
    row.installation_id === installationId && row.request_id === scope.request_id && row.backup_id === scope.backup_id
    && row.expected_digest === scope.expected_digest && row.target_digest === scope.target_digest;

const confirmsRestore = (result: {authorization: ConfigRestoreAuthorization; receipt: ConfigRestoreReceipt},
    pending: ConfigRestoreAuthorization, scope: ConfigRestoreRequest) =>
    result.authorization.state === 'succeeded' && sameChallenge(result.authorization, pending)
    && result.receipt.state === 'applied' && !result.receipt.recovered
    && matchesReceipt(result.receipt, scope, pending.target_installation_id);

const exactObject = (value: unknown, keys: string[]): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));

const backupSettings = (value: unknown) =>
    exactObject(value, Object.keys(fieldLabels))
    && typeof value.name === 'string' && value.name.length > 0 && Array.from(value.name).length <= 128
    && (value.agent_host === '127.0.0.1' || value.agent_host === '::1')
    && typeof value.agent_port === 'number' && Number.isInteger(value.agent_port)
    && value.agent_port >= 1 && value.agent_port <= 65535
    && typeof value.tailscale_auto_start === 'boolean';

const backupDocument = (value: unknown): value is ConfigBackupSnapshot =>
    exactObject(value, ['schema_version', 'installation_id', 'backup_id', 'role', 'created_at', 'settings', 'configuration_sha256'])
    && value.schema_version === 'model-work-node.config-backup.v1'
    && typeof value.backup_id === 'string' && uuid.test(value.backup_id)
    && typeof value.configuration_sha256 === 'string' && digest.test(value.configuration_sha256)
    && Number.isSafeInteger(value.created_at) && backupSettings(value.settings);

const restoreRejectedBeforeWrite = (reason: unknown) =>
    (reason instanceof ComputeClusterRequestError && [401, 403].includes(reason.status))
    || String(reason).includes('config_restore_state_changed');

const configError = (reason: unknown, zh: boolean): string => {
    const detail = reason instanceof Error ? reason.message : String(reason);
    if (isComputeAccessDenied(reason) || /authorization_scope_denied|authorization_user_revoked/.test(detail)) {
        return zh ? '当前账号或签名身份无权操作。' : 'Your account or approval identity lacks permission.';
    }
    if (detail.includes('config_restore_state_changed')) {
        return zh ? '配置已变化，请重新查看差异。' : 'Configuration changed. Request a new preview.';
    }
    if (detail.includes('config_backup_scope_mismatch')) {
        return zh ? '此备份属于其他安装实例。' : 'This backup belongs to another installation.';
    }
    return detail;
};

const ConfigChanges = ({preview, zh}: {preview: ConfigRestorePreview; zh: boolean}) => {
    const format = (value: string | number | boolean) => typeof value !== 'boolean' ? String(value)
        : value ? (zh ? '开启' : 'On') : (zh ? '关闭' : 'Off');
    return <dl className='ControlConfigChanges'>
        {preview.changes.map(change => <div key={change.field}>
            <dt>{fieldLabels[change.field][zh ? 0 : 1]}</dt>
            <dd>{format(change.before)} → {format(change.after)}</dd>
        </div>)}
    </dl>;
};

// Keep pending requests and their device-scoped UI together.
// eslint-disable-next-line complexity
const ConfigBackupWorkspace = ({node, zh}: {node: ComputeClusterNode; zh: boolean}) => {
    const nodeId = node.node_id;
    const installationId = node.installation_id;
    const canBackup = node.capabilities.includes('control.config.backup.v1');
    const canRestore = node.capabilities.includes('control.config.restore.v1');
    const lang = zh ? 0 : 1;
    const [history, setHistory] = useState<ConfigBackupHistory>();
    const [preview, setPreview] = useState<ConfigRestorePreview>();
    const [pending, setPending] = useState<ConfigRestoreAuthorization>();
    const [unconfirmed, setUnconfirmed] = useState<ConfigRestoreRequest>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const action = useRef<AbortController>();
    const fileInput = useRef<HTMLInputElement>(null);

    useLayoutEffect(() => {
        const abort = () => {
            action.current?.abort();
            action.current = undefined;
        };
        const reset = () => {
            abort();
            setHistory(undefined);
            setPreview(undefined);
            setPending(undefined);
            setUnconfirmed(undefined);
            setNotice('');
            setError('');
            setBusy(false);
            if (fileInput.current) fileInput.current.value = '';
        };
        window.addEventListener(APPROVAL_IDENTITY_CHANGED, reset);
        return () => {
            abort();
            window.removeEventListener(APPROVAL_IDENTITY_CHANGED, reset);
        };
    }, []);

    const run = useCallback(async (operation: (signal: AbortSignal) => Promise<void>) => {
        if (action.current) return;
        const controller = new AbortController();
        action.current = controller;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await operation(controller.signal);
        } catch (reason) {
            if (!controller.signal.aborted) {
                if (String(reason).includes('config_restore_state_changed')) setPreview(undefined);
                setError(configError(reason, zh));
            }
        } finally {
            if (action.current === controller) {
                action.current = undefined;
                setBusy(false);
            }
        }
    }, [zh]);

    const read = useCallback(async (signal: AbortSignal, scope?: ConfigRestoreRequest) => {
        const data = await ComputeClusterService.configBackupHistory(nodeId, signal);
        if (data.installation_id !== installationId || !digest.test(data.current_digest)
            || data.restores.some(row => row.installation_id !== installationId)) {
            throw new Error('config_backup_response_invalid');
        }
        if (signal.aborted) return;
        setHistory(data);
        const row = scope && data.restores.find(item => matchesReceipt(item, scope, installationId));
        if (row) {
            setUnconfirmed(undefined);
            setNotice(restoreStates[row.state][zh ? 0 : 1]);
        }
    }, [installationId, nodeId, zh]);

    useEffect(() => {
        void run(signal => read(signal));
    }, [read, run]);

    const checkSnapshot = (snapshot: unknown) => {
        if (!backupDocument(snapshot)) {
            throw new Error(zh ? '备份文件的格式或字段无效。' : 'The backup format or fields are invalid.');
        }
        if (snapshot.installation_id !== installationId || snapshot.role !== node.role) {
            throw new Error('config_backup_scope_mismatch');
        }
    };

    const saveSnapshot = (file?: File) => {
        setPreview(undefined);
        void run(async signal => {
            let snapshot: ConfigBackupSnapshot;
            if (file) {
                if (file.size > fileLimit) {
                    throw new Error(zh ? '备份文件不能超过 16 KiB。' : 'The backup file must be at most 16 KiB.');
                }
                let document: unknown;
                try {
                    document = JSON.parse(await file.text());
                } catch {
                    throw new Error(zh ? '备份文件不是有效的 JSON。' : 'The backup file is not valid JSON.');
                }
                if (signal.aborted) return;
                checkSnapshot(document);
                snapshot = await ComputeClusterService.importConfigBackup(nodeId, document, signal);
            } else {
                snapshot = await ComputeClusterService.createConfigBackup(nodeId, signal);
            }
            if (signal.aborted) return;
            checkSnapshot(snapshot);
            setNotice(file ? (zh ? '备份已导入。' : 'Backup imported.') : (zh ? '备份已保存。' : 'Backup saved.'));
            await read(signal);
        });
    };

    const download = (backupId: string) => void run(async signal => {
        const snapshot = await ComputeClusterService.exportConfigBackup(nodeId, backupId, signal);
        checkSnapshot(snapshot);
        if (snapshot.backup_id !== backupId) throw new Error('config_backup_scope_mismatch');
        if (!signal.aborted) {
            saveAs(new Blob([JSON.stringify(snapshot, null, 2) + '\n'], {type: 'application/json'}), `opensight-config-${backupId}.json`);
        }
    });

    const showPreview = (backupId: string) => {
        setPreview(undefined);
        void run(async signal => {
            const data = await ComputeClusterService.previewConfigRestore(nodeId, backupId, signal);
            if (data.installation_id !== installationId || data.backup_id !== backupId
                || !digest.test(data.expected_digest) || !digest.test(data.target_digest)
                || data.requires_restart !== Boolean(data.changes.length)
                || data.requires_restart !== (data.expected_digest !== data.target_digest)
                || data.changes.some(change => !Object.prototype.hasOwnProperty.call(fieldLabels, change.field))) {
                throw new Error('config_restore_response_invalid');
            }
            if (!signal.aborted) setPreview(data);
        });
    };

    const prepare = () => {
        if (!canRestore || !preview?.requires_restart || pending || unconfirmed) return;
        const scope = {
            backup_id: preview.backup_id, request_id: uuidv4(),
            expected_digest: preview.expected_digest, target_digest: preview.target_digest,
        };
        void run(async signal => {
            const auth = await ComputeClusterService.createConfigRestoreAuthorization(nodeId, scope, signal);
            if (auth.state !== 'pending' || !matches(scope, auth, installationId)) {
                throw new Error('config_restore_scope_mismatch');
            }
            if (!signal.aborted) setPending(auth);
        });
    };

    const decide = (approve: boolean) => {
        if (!pending || !canRestore) return;
        const {backup_id: backupId, request_id: requestId} = pending.target;
        const scope = {backup_id: backupId, request_id: requestId, ...pending.parameters};
        void run(async signal => {
            let submitted = false;
            try {
                if (!approve) {
                    const rejected = await ComputeClusterService.rejectConfigRestore(nodeId, backupId, pending.authorization_id, signal);
                    if (rejected.state !== 'rejected' || !sameChallenge(rejected, pending)) throw new Error('config_restore_scope_mismatch');
                    if (!signal.aborted) setNotice(zh ? '已取消恢复。' : 'Restore cancelled.');
                    return;
                }
                const signature = await signAuthorization(pending);
                if (signal.aborted) return;
                submitted = true;
                setUnconfirmed(scope);
                const result = await ComputeClusterService.approveConfigRestore(
                    nodeId, backupId, pending.authorization_id, signature, signal,
                );
                if (!confirmsRestore(result, pending, scope)) throw new Error('config_restore_response_invalid');
                if (signal.aborted) return;
                setUnconfirmed(undefined);
                setNotice(zh ? '配置已写入。重新加载节点服务后生效。' : 'Configuration saved. Reload the node service to apply it.');
                await read(signal);
            } catch (reason) {
                if (!signal.aborted && restoreRejectedBeforeWrite(reason)) {
                    setUnconfirmed(undefined);
                }
                throw reason;
            } finally {
                if (!signal.aborted) {
                    setPending(undefined);
                    if (submitted) setPreview(undefined);
                }
            }
        });
    };

    const time = (timestamp: number) => new Date(timestamp * 1000).toLocaleString(zh ? 'zh-CN' : 'en-US');
    const locked = busy || Boolean(pending);
    return <section className='ControlManagerConfigBackups' aria-label={zh ? '当前设备的配置备份' : 'Configuration backups on this device'}>
        <h3>{zh ? '配置备份与恢复' : 'Configuration backup and restore'}</h3>
        <p>{zh ? '备份用于同一设备安装。包含设备名称、Agent 回环地址和端口，以及 Tailscale 自动启动设置。'
            : 'Backups are for this installation. They include the device name, Agent loopback address and port, and Tailscale auto-start.'}</p>
        <div className='ControlConfigActions'>
            <button type='button' disabled={locked} onClick={() => void run(signal => read(signal, unconfirmed))}>
                {unconfirmed ? (zh ? '核对恢复记录' : 'Check restore record') : (zh ? '刷新记录' : 'Refresh history')}
            </button>
            {canBackup && <>
                <button type='button' disabled={locked} onClick={() => saveSnapshot()}>{zh ? '创建备份' : 'Create backup'}</button>
                <button type='button' disabled={locked} onClick={() => fileInput.current?.click()}>{zh ? '导入备份' : 'Import backup'}</button>
                <input ref={fileInput} type='file' accept='.json,application/json' hidden aria-label={zh ? '备份文件' : 'Backup file'}
                    onChange={event => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = '';
                        if (file && !locked) saveSnapshot(file);
                    }}/>
            </>}
        </div>
        {busy && <p role='status'>{zh ? '正在处理…' : 'Working…'}</p>}
        {error && <p role='alert'>{error}</p>}
        {notice && <p role='status'>{notice}</p>}
        {unconfirmed && !busy && <p role='status'>
            {zh ? '恢复结果待核对。请求编号' : 'Restore result unconfirmed. Request ID'} <code>{unconfirmed.request_id}</code>
        </p>}
        {history && <>
            <h4>{zh ? '备份记录' : 'Backups'}</h4>
            {history.backups.length ? <ul>{history.backups.map(row => <li key={row.backup_id}>
                <div><strong>{backupKinds[row.kind][lang]}</strong><small>{time(row.recorded_at)} · <code>{row.backup_id}</code></small></div>
                <button type='button' disabled={locked} onClick={() => download(row.backup_id)}>{zh ? '下载' : 'Download'}</button>
                <button type='button' disabled={locked || Boolean(unconfirmed)} onClick={() => showPreview(row.backup_id)}>
                    {zh ? '查看差异' : 'Preview differences'}
                </button>
            </li>)}</ul> : <p>{zh ? '暂无备份。' : 'No backups yet.'}</p>}
            <h4>{zh ? '恢复记录' : 'Restore history'}</h4>
            {history.restores.length ? <ul>{history.restores.map(row => <li key={row.request_id}>
                <div><strong>{restoreStates[row.state][lang]}</strong><small>{time(row.finished_at)} · <code>{row.request_id}</code></small></div>
                <button type='button' disabled={locked || Boolean(unconfirmed)} onClick={() => showPreview(row.previous_backup_id)}>
                    {zh ? '查看恢复前快照' : 'Preview pre-restore backup'}
                </button>
            </li>)}</ul> : <p>{zh ? '暂无恢复记录。' : 'No restore history yet.'}</p>}
            {(history.backups_have_more || history.restores_have_more) && <small>
                {zh ? '每类仅显示最近 20 条记录。' : 'Showing up to 20 recent records of each type.'}
            </small>}
        </>}
        {preview && <div className='ControlConfigPreview'>
            <h4>{zh ? '恢复差异预览' : 'Restore preview'}</h4>
            <small>{node.name} · <code>{preview.backup_id}</code></small>
            {preview.requires_restart ? <ConfigChanges preview={preview} zh={zh}/>
                : <p>{zh ? '当前配置与此备份一致。' : 'The current configuration matches this backup.'}</p>}
            {canRestore && preview.requires_restart && <button type='button' disabled={locked || Boolean(unconfirmed)} onClick={prepare}>
                {zh ? '准备恢复授权' : 'Prepare restore approval'}
            </button>}
        </div>}
        <Dialog open={Boolean(pending && preview)} onClose={() => decide(false)} disableEscapeKeyDown={busy}
            aria-labelledby='device-config-approval-title' PaperProps={{sx: {backgroundColor: '#242424', color: '#eee'}}}>
            <DialogTitle id='device-config-approval-title'>{zh ? '确认恢复配置' : 'Confirm configuration restore'}</DialogTitle>
            {pending && preview && <DialogContent>
                <p>{node.name} · <code>{preview.backup_id}</code></p>
                <ConfigChanges preview={preview} zh={zh}/>
                <p>{zh ? '目标配置摘要' : 'Target configuration digest'} <code style={{overflowWrap: 'anywhere'}}>{preview.target_digest}</code></p>
                <p>{zh ? '将自动保存恢复前快照。配置写入磁盘后，需重新加载节点服务。变更 Agent 地址或端口时，请核对重连路径。'
                    : 'A pre-restore backup is saved automatically. Reload the node service after saving. Check the reconnect path if the Agent address or port changes.'}</p>
            </DialogContent>}
            <DialogActions>
                <Button autoFocus onClick={() => decide(false)} disabled={busy}>{zh ? '取消' : 'Cancel'}</Button>
                <Button variant='contained' onClick={() => decide(true)} disabled={busy}>{zh ? '签名并恢复' : 'Sign and restore'}</Button>
            </DialogActions>
        </Dialog>
    </section>;
};

export const ConfigBackupPanel = ({node, zh}: {node: ComputeClusterNode; zh: boolean}) => {
    if (!node.capabilities.includes('runtime.config.backup.read.v1')) {
        return <p role='status'>{zh ? '当前节点版本未提供配置备份接口。' : 'This node version does not provide configuration backups.'}</p>;
    }
    if (!node.online && !node.network.ssh_available) {
        return <p role='status'>{zh ? '当前设备暂不可达。' : 'This device is not reachable.'}</p>;
    }
    return <ConfigBackupWorkspace key={`${node.node_id}:${node.installation_id}:${node.role}:${node.capabilities.includes('control.config.restore.v1')}`}
        node={node} zh={zh}/>;
};
