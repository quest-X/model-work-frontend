import React, {FormEvent, useLayoutEffect, useRef, useState} from 'react';
import {Button, Dialog, DialogActions, DialogContent, DialogTitle} from '@mui/material';
import {v4 as uuidv4} from 'uuid';
import {ModelDeliveryPanel} from './ModelDeliveryPanel';
import {
    ComputeClusterNode, ComputeClusterService, ModelVersionAuthorization, ModelVersionChange, ModelVersionHistory, ModelVersionReceipt,
    isComputeAccessDenied,
} from '../../services/ComputeClusterService';
import {
    APPROVAL_IDENTITY_CHANGED, authorizationChallenge, canonicalAuthorizationJson, signAuthorization,
} from '../../services/ApprovalIdentityService';

const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const sameChallenge = (first: ModelVersionAuthorization, second: ModelVersionAuthorization) =>
    canonicalAuthorizationJson(authorizationChallenge(first)) === canonicalAuthorizationJson(authorizationChallenge(second));

const matches = (auth: ModelVersionAuthorization, request: ModelVersionChange, installationId: string): boolean =>
    auth.state === 'pending' && auth.target_installation_id === installationId && auth.operation === 'model.version.change'
    && auth.target.kind === 'model_version' && auth.target.model_id === request.model_id
    && auth.target.license_id === request.license_id && auth.target.request_id === request.request_id
    && auth.parameters.expected_license_id === request.expected_license_id && auth.parameters.rollback === request.rollback
    && digestPattern.test(auth.parameters.model_sha256) && digestPattern.test(auth.parameters.package_sha256);

const matchesReceipt = (receipt: ModelVersionReceipt, auth: ModelVersionAuthorization): boolean =>
    receipt.installation_id === auth.target_installation_id && receipt.model_id === auth.target.model_id
    && receipt.license_id === auth.target.license_id && receipt.request_id === auth.target.request_id
    && receipt.previous_license_id === auth.parameters.expected_license_id
    && receipt.operation === (auth.parameters.rollback ? 'rollback' : 'activate')
    && receipt.model_sha256 === auth.parameters.model_sha256
    && receipt.package_sha256 === auth.parameters.package_sha256;

// Query, approval and receipt share the same selected device and operation scope.
// eslint-disable-next-line complexity
export const ModelVersionsPanel = ({node, zh}: {node: ComputeClusterNode; zh: boolean}) => {
    const [model, setModel] = useState('');
    const [license, setLicense] = useState('');
    const [history, setHistory] = useState<ModelVersionHistory>();
    const [pending, setPending] = useState<ModelVersionAuthorization>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const action = useRef<AbortController>();
    const readable = node.capabilities.includes('runtime.model.versions.v1');
    const manageable = node.capabilities.includes('control.model.version.change.v1');
    const online = node.online || node.network.ssh_available === true;

    useLayoutEffect(() => {
        const reset = () => {
            action.current?.abort();
            action.current = undefined;
            setHistory(undefined);
            setPending(undefined);
            setNotice('');
            setError('');
            setBusy(false);
        };
        reset();
        window.addEventListener(APPROVAL_IDENTITY_CHANGED, reset);
        return () => {
            action.current?.abort();
            action.current = undefined;
            window.removeEventListener(APPROVAL_IDENTITY_CHANGED, reset);
        };
    }, [manageable, node.node_id, online, readable]);

    const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
        if (action.current) return;
        const controller = new AbortController();
        action.current = controller;
        setBusy(true);
        setError('');
        try {
            await operation(controller.signal);
        } catch (reason) {
            if (controller.signal.aborted) return;
            const detail = reason instanceof Error ? reason.message : String(reason);
            if (detail.includes('model_version_current_changed')) setHistory(undefined);
            const denied = isComputeAccessDenied(reason) || /authorization_scope_denied|authorization_user_revoked/.test(detail);
            setError(denied
                ? (zh ? '当前账号或授权身份无权操作。' : 'Your account or approval identity lacks permission.')
                : detail);
        } finally {
            if (action.current === controller) {
                action.current = undefined;
                setBusy(false);
            }
        }
    };

    const read = async (modelId: string, signal: AbortSignal) => {
        const data = await ComputeClusterService.modelVersionHistory(node.node_id, modelId, signal);
        if (data.installation_id !== node.installation_id || data.model_id !== modelId) throw new Error('model_version_response_invalid');
        if (!signal.aborted) setHistory(data);
        return data;
    };

    const query = (event: FormEvent) => {
        event.preventDefault();
        const modelId = model.trim();
        if (!readable || !online || !modelPattern.test(modelId) || action.current || pending) return;
        setHistory(undefined);
        setNotice('');
        void run(async signal => { await read(modelId, signal); });
    };

    const prepare = (licenseId: string, rollback: boolean) => {
        if (!history || !manageable || !online || action.current || pending || !uuidPattern.test(licenseId)
            || licenseId === history.active_license_id) return;
        const request = {
            model_id: history.model_id, license_id: licenseId, expected_license_id: history.active_license_id,
            request_id: uuidv4(), rollback,
        };
        setNotice('');
        void run(async signal => {
            const created = await ComputeClusterService.createModelVersionAuthorization(node.node_id, request, signal);
            if (!matches(created, request, node.installation_id)) throw new Error('model_version_authorization_scope_mismatch');
            if (!signal.aborted) setPending(created);
        });
    };

    const decide = (approve: boolean) => {
        if (!pending || action.current || !manageable || !online) return;
        void run(async signal => {
            try {
                if (approve) {
                    const signature = await signAuthorization(pending);
                    if (signal.aborted) return;
                    setHistory(undefined);
                    const result = await ComputeClusterService.approveModelVersion(node.node_id, pending.authorization_id, signature, signal);
                    const {receipt, authorization} = result;
                    if (authorization.state !== 'succeeded' || !sameChallenge(authorization, pending)
                        || !matchesReceipt(receipt, pending)) throw new Error('model_version_response_invalid');
                    if (signal.aborted) return;
                    setNotice(zh ? '变更已记录。' : 'Change recorded.');
                    await read(pending.target.model_id, signal);
                } else {
                    const rejected = await ComputeClusterService.rejectModelVersion(node.node_id, pending.authorization_id, signal);
                    if (rejected.state !== 'rejected' || !sameChallenge(rejected, pending)) throw new Error('model_version_response_invalid');
                    if (!signal.aborted) setNotice(zh ? '已取消本次授权。' : 'Approval cancelled.');
                }
            } finally {
                if (!signal.aborted) setPending(undefined);
            }
        });
    };

    if (!readable || !online) return <p role='status'>{readable
        ? (zh ? '当前设备暂不可达。' : 'This device is not reachable.')
        : (zh ? '当前节点版本未提供远程模型版本接口。' : 'This node version does not provide remote model version management.')}</p>;

    return <section className='ControlManagerModelVersions' aria-label={zh ? '模型版本' : 'Model versions'}>
        <h3>{zh ? '当前设备的模型版本' : 'Model versions on this device'}</h3>
        <form onSubmit={query}>
            <label>{zh ? '模型标识' : 'Model ID'}
                <input value={model} disabled={busy || Boolean(pending)} maxLength={128} onChange={event => {
                    setModel(event.target.value);
                    setHistory(undefined);
                    setNotice('');
                    setError('');
                }}/>
            </label>
            <button type='submit' disabled={busy || Boolean(pending) || !modelPattern.test(model.trim())}>
                {zh ? '查看版本记录' : 'View version history'}
            </button>
        </form>
        {busy && <p role='status'>{zh ? '正在处理…' : 'Working…'}</p>}
        {error && <p role='alert'>{error}</p>}
        {notice && <p role='status'>{notice}</p>}
        {history && <>
            <p>{zh ? '当前选用的许可' : 'Selected license'} <code>{history.active_license_id || (zh ? '暂无' : 'None')}</code></p>
            {manageable && <form onSubmit={event => { event.preventDefault(); prepare(license.trim(), false); }}>
                <label>{zh ? '已安装的许可编号' : 'Installed license ID'}
                    <input value={license} disabled={busy || Boolean(pending)} maxLength={36} onChange={event => setLicense(event.target.value)}/>
                </label>
                <button type='submit' disabled={busy || Boolean(pending) || !uuidPattern.test(license.trim())
                    || license.trim() === history.active_license_id}>{zh ? '启用已安装版本' : 'Activate installed version'}</button>
            </form>}
            {history.history.length ? <ul>{history.history.map(item => <li key={item.request_id}>
                <div><code>{item.license_id}</code><small>{new Date(item.changed_at * 1000).toLocaleString(zh ? 'zh-CN' : 'en-US')}</small></div>
                <span>{({update: zh ? '更新' : 'Updated', activate: zh ? '启用' : 'Activated', rollback: zh ? '回退' : 'Rolled back'})[item.operation]}</span>
                {manageable && item.license_id !== history.active_license_id && <button type='button'
                    disabled={busy || Boolean(pending)} onClick={() => prepare(item.license_id, true)}>{zh ? '回退到此版本' : 'Roll back to this version'}</button>}
            </li>)}</ul> : <p>{zh ? '暂无版本记录。' : 'No version history.'}</p>}
            {node.capabilities.includes('control.model.delivery.v1') && <ModelDeliveryPanel
                key={history.model_id} node={node} history={history} zh={zh} disabled={busy || Boolean(pending)}
                refreshHistory={signal => read(history.model_id, signal)}
            />}
            {history.has_more && <small>{zh ? '这里显示最近 20 条记录。' : 'Showing the latest 20 records.'}</small>}
        </>}
        <Dialog open={Boolean(pending)} onClose={() => decide(false)} disableEscapeKeyDown={busy}
            aria-labelledby='device-model-approval-title' PaperProps={{sx: {backgroundColor: '#242424', color: '#eee'}}}>
            <DialogTitle id='device-model-approval-title'>{pending?.parameters.rollback
                ? (zh ? '确认模型回退' : 'Confirm model rollback') : (zh ? '确认启用模型版本' : 'Confirm model activation')}</DialogTitle>
            {pending && <DialogContent>
                <p>{node.name} · {pending.target.model_id}</p>
                <p>{pending.parameters.expected_license_id || '—'} → {pending.target.license_id}</p>
                <p>SHA-256 <code>{pending.parameters.package_sha256}</code></p>
            </DialogContent>}
            <DialogActions>
                <Button autoFocus onClick={() => decide(false)} disabled={busy}>{zh ? '取消' : 'Cancel'}</Button>
                <Button variant='contained' onClick={() => decide(true)} disabled={busy}>{zh ? '签名并执行' : 'Sign and apply'}</Button>
            </DialogActions>
        </Dialog>
    </section>;
};
