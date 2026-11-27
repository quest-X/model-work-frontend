import React, {useLayoutEffect, useRef, useState} from 'react';
import {Button, Dialog, DialogActions, DialogContent, DialogTitle} from '@mui/material';
import {v4 as uuidv4} from 'uuid';
import {
    ComputeClusterNode, ComputeClusterService, ModelDeliveryAuthorization, ModelDeliveryLicense, ModelDeliveryProgress,
    ModelVersionHistory, ModelVersionReceipt, isComputeAccessDenied,
} from '../../services/ComputeClusterService';
import {
    APPROVAL_IDENTITY_CHANGED, authorizationChallenge, canonicalAuthorizationJson, currentApprovalUser, signAuthorization,
} from '../../services/ApprovalIdentityService';
import {sha256Bytes} from '../../utils/Sha256';

const MAX_PACKAGE_BYTES = 512 * 1024 * 1024 + 16 * 1024 + 30;
const MAX_CHUNK_BYTES = 768 * 1024;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const encodeChunk = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    let text = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(text);
};

const readLicense = async (file: File, installationId: string, modelId: string): Promise<ModelDeliveryLicense> => {
    if (file.size > 16 * 1024) throw new Error('model_document_size_invalid');
    const document = JSON.parse(await file.text());
    if (
        !document || document.purpose !== 'model-work-node.model-license.v1' || document.version !== 1
        || document.installation_id !== installationId || document.model_id !== modelId
        || !uuidPattern.test(document.license_id) || !digestPattern.test(document.model_sha256)
        || !digestPattern.test(document.package_sha256)
    ) throw new Error('model_delivery_license_scope_mismatch');
    return document;
};

const validProgress = (progress: ModelDeliveryProgress, node: ComputeClusterNode, modelId: string, requestId: string) =>
    progress.installation_id === node.installation_id && progress.model_id === modelId && progress.request_id === requestId
    && uuidPattern.test(progress.license_id) && Number.isInteger(progress.package_size)
    && progress.package_size > 14 && progress.package_size <= MAX_PACKAGE_BYTES
    && Number.isInteger(progress.received_bytes) && progress.received_bytes >= 0
    && progress.received_bytes <= progress.package_size && Number.isFinite(progress.expires_at);

const sameChallenge = (first: ModelDeliveryAuthorization, second: ModelDeliveryAuthorization) =>
    canonicalAuthorizationJson(authorizationChallenge(first)) === canonicalAuthorizationJson(authorizationChallenge(second));

const matchesApproval = (
    auth: ModelDeliveryAuthorization, progress: ModelDeliveryProgress, expected: string | null,
) => auth.state === 'pending' && auth.operation === 'model.delivery.commit'
    && auth.target_installation_id === progress.installation_id && auth.target.kind === 'model_delivery'
    && auth.target.request_id === progress.request_id && auth.target.model_id === progress.model_id
    && auth.target.license_id === progress.license_id && auth.parameters.expected_license_id === expected
    && auth.parameters.package_size === progress.package_size
    && [auth.parameters.model_sha256, auth.parameters.package_sha256, auth.parameters.license_sha256]
        .every(digest => digestPattern.test(digest));

const matchesReceipt = (receipt: ModelVersionReceipt, auth: ModelDeliveryAuthorization) =>
    receipt.operation === 'update' && receipt.installation_id === auth.target_installation_id
    && receipt.request_id === auth.target.request_id && receipt.model_id === auth.target.model_id
    && receipt.license_id === auth.target.license_id && receipt.previous_license_id === auth.parameters.expected_license_id
    && receipt.model_sha256 === auth.parameters.model_sha256 && receipt.package_sha256 === auth.parameters.package_sha256;

interface Props {
    node: ComputeClusterNode;
    history: ModelVersionHistory;
    zh: boolean;
    disabled: boolean;
    refreshHistory: (signal: AbortSignal) => Promise<ModelVersionHistory>;
}

type Activity = 'upload' | 'read' | 'approval' | 'install';

// One device-scoped transfer, with separate staging and approval lifecycles.
// eslint-disable-next-line complexity
export const ModelDeliveryPanel = ({node, history, zh, disabled, refreshHistory}: Props) => {
    const modelId = history.model_id;
    const [packageFile, setPackage] = useState<File>();
    const [licenseFile, setLicense] = useState<File>();
    const [requestId, setRequestId] = useState('');
    const [recoveryId, setRecoveryId] = useState('');
    const [progress, setProgress] = useState<ModelDeliveryProgress>();
    const [pending, setPending] = useState<ModelDeliveryAuthorization>();
    const [activity, setActivity] = useState<Activity>();
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [pickerEpoch, setPickerEpoch] = useState(0);
    const action = useRef<AbortController>();
    const permit = useRef<ModelDeliveryLicense>();
    const storageKey = useRef('');

    useLayoutEffect(() => {
        const reset = () => {
            action.current?.abort();
            action.current = undefined;
            permit.current = undefined;
            const user = currentApprovalUser();
            storageKey.current = user ? `opensight:model-delivery:v1:${user.user_id}:${node.installation_id}:${modelId}` : '';
            let saved = '';
            try { saved = storageKey.current ? sessionStorage.getItem(storageKey.current) || '' : ''; } catch { /* optional recovery */ }
            setRequestId(uuidPattern.test(saved) ? saved : '');
            setRecoveryId('');
            setPackage(undefined);
            setLicense(undefined);
            setPickerEpoch(current => current + 1);
            setProgress(undefined);
            setPending(undefined);
            setActivity(undefined);
            setNotice('');
            setError('');
        };
        reset();
        window.addEventListener(APPROVAL_IDENTITY_CHANGED, reset);
        return () => {
            action.current?.abort();
            action.current = undefined;
            window.removeEventListener(APPROVAL_IDENTITY_CHANGED, reset);
        };
    }, [modelId, node.installation_id]);

    const remember = (id: string) => {
        setRequestId(id);
        try {
            if (storageKey.current && id) sessionStorage.setItem(storageKey.current, id);
            else if (storageKey.current) sessionStorage.removeItem(storageKey.current);
        } catch { /* transfer ID remains available in the panel */ }
    };

    const clearFiles = () => {
        setPackage(undefined);
        setLicense(undefined);
        setPickerEpoch(current => current + 1);
    };

    const clear = () => {
        remember('');
        setProgress(undefined);
        permit.current = undefined;
        clearFiles();
    };

    const run = async (kind: Activity, operation: (signal: AbortSignal) => Promise<void>) => {
        if (action.current || disabled) return;
        const controller = new AbortController();
        action.current = controller;
        setActivity(kind);
        setError('');
        setNotice('');
        try {
            await operation(controller.signal);
        } catch (reason) {
            if (controller.signal.aborted) return;
            const detail = reason instanceof Error ? reason.message : String(reason);
            const denied = isComputeAccessDenied(reason) || /authorization_scope_denied|authorization_user_revoked/.test(detail);
            setError(denied ? (zh ? '当前账号或授权身份无权操作。' : 'Your account or approval identity lacks permission.') : detail);
        } finally {
            if (action.current === controller) {
                action.current = undefined;
                setActivity(undefined);
            }
        }
    };

    const upload = () => {
        if (!packageFile || !licenseFile || pending) return;
        void run('upload', async signal => {
            if (packageFile.size <= 14 || packageFile.size > MAX_PACKAGE_BYTES) throw new Error('model_delivery_size_invalid');
            const license = await readLicense(licenseFile, node.installation_id, modelId);
            if (signal.aborted) return;
            const id = requestId || uuidv4();
            remember(id);
            const verify = (value: ModelDeliveryProgress, minimum: number) => {
                if (!validProgress(value, node, modelId, id) || value.license_id !== license.license_id
                    || value.package_size !== packageFile.size || value.received_bytes < minimum) {
                    throw new Error('model_delivery_response_invalid');
                }
            };
            const open = await ComputeClusterService.openModelDelivery(node.node_id, {
                request_id: id, model_id: modelId, expected_license_id: history.active_license_id, package_size: packageFile.size,
            }, license, signal).catch(reason => {
                if (!signal.aborted && !requestId && reason instanceof Error && reason.message === 'model_delivery_already_open') {
                    remember('');
                    throw new Error(zh
                        ? '此设备已有暂存，请用原传输编号接续。'
                        : 'This device already has a staged package. Recover it using its transfer ID.');
                }
                throw reason;
            });
            let current = open;
            verify(current, 0);
            if (!signal.aborted) permit.current = license;
            while (!signal.aborted && current.received_bytes < packageFile.size) {
                setProgress(current);
                const offset = current.received_bytes;
                const end = Math.min(offset + MAX_CHUNK_BYTES, packageFile.size);
                const data = encodeChunk(await packageFile.slice(offset, end).arrayBuffer());
                if (signal.aborted) return;
                current = await ComputeClusterService.sendModelDeliveryChunk(node.node_id, id, offset, data, signal);
                verify(current, end);
            }
            if (!signal.aborted) {
                setProgress(current);
                if (current.received_bytes === current.package_size) clearFiles();
            }
        });
    };

    const inspect = (id: string) => void run('read', async signal => {
        const data = await ComputeClusterService.modelDeliveryProgress(node.node_id, id, signal);
        if (!validProgress(data, node, modelId, id)) throw new Error('model_delivery_response_invalid');
        if (!signal.aborted) {
            if (data.received_bytes === data.package_size) clearFiles();
            remember(id);
            setProgress(data);
        }
    });

    const reconcile = () => void run('read', async signal => {
        const current = await refreshHistory(signal);
        if (signal.aborted) return;
        const receipt = current.history.find(row => row.request_id === requestId && row.operation === 'update');
        if (!receipt) {
            setNotice(zh ? '最近记录中没有这次安装。可继续查询暂存进度。' : 'No installation appears in recent history. Check staged progress to continue.');
            return;
        }
        clear();
        setNotice(zh ? '已在节点历史中核对到这次安装。' : 'Installation verified in node history.');
    });

    const cancel = () => void run('read', async signal => {
        try {
            const result = await ComputeClusterService.cancelModelDelivery(node.node_id, requestId, signal);
            if (!result.cancelled || result.installation_id !== node.installation_id || result.request_id !== requestId) {
                throw new Error('model_delivery_response_invalid');
            }
        } catch (reason) {
            if (!(reason instanceof Error) || reason.message !== 'model_delivery_not_found') throw reason;
        }
        if (!signal.aborted) {
            clear();
            setNotice(zh ? '暂存已清除。' : 'Staged delivery cleared.');
        }
    });

    const prepare = () => {
        if (!progress || progress.received_bytes !== progress.package_size || pending) return;
        void run('approval', async signal => {
            const approval = await ComputeClusterService.createModelDeliveryAuthorization(node.node_id, progress.request_id, signal);
            if (!matchesApproval(approval, progress, history.active_license_id)) throw new Error('model_delivery_scope_invalid');
            const license = permit.current;
            if (license) {
                const hash = await sha256Bytes(new TextEncoder().encode(canonicalAuthorizationJson(license)));
                if (hash !== approval.parameters.license_sha256 || license.model_sha256 !== approval.parameters.model_sha256
                    || license.package_sha256 !== approval.parameters.package_sha256) throw new Error('model_delivery_scope_invalid');
            }
            if (!signal.aborted) setPending(approval);
        });
    };

    const decide = (approve: boolean) => {
        if (!pending) return;
        const id = pending.target.request_id;
        void run('install', async signal => {
            try {
                if (!approve) {
                    const rejected = await ComputeClusterService.rejectModelDelivery(node.node_id, id, pending.authorization_id, signal);
                    if (rejected.state !== 'rejected' || !sameChallenge(rejected, pending)) throw new Error('model_delivery_response_invalid');
                    if (!signal.aborted) setNotice(zh ? '已取消安装授权，暂存仍可使用。' : 'Approval cancelled. The staged package is available.');
                    return;
                }
                const signature = await signAuthorization(pending);
                if (signal.aborted) return;
                const result = await ComputeClusterService.approveModelDelivery(node.node_id, id, pending.authorization_id, signature, signal);
                if (result.authorization.state !== 'succeeded' || !sameChallenge(result.authorization, pending)
                    || !matchesReceipt(result.receipt, pending)) throw new Error('model_delivery_response_invalid');
                if (signal.aborted) return;
                clear();
                setNotice(zh ? '模型包安装已记录。' : 'Model package installation recorded.');
                await refreshHistory(signal);
            } finally {
                if (!signal.aborted) setPending(undefined);
            }
        });
    };

    const locked = disabled || Boolean(activity) || Boolean(pending);
    const complete = Boolean(progress && progress.received_bytes === progress.package_size);
    const pickersLocked = locked || complete;
    return <section className='ControlManagerModelDelivery' aria-label={zh ? '安装新模型包' : 'Install a new model package'}>
        <h4>{zh ? '安装新模型包' : 'Install a new model package'}</h4>
        <p>{zh ? '选择发给当前设备的加密包和签名许可。传完后需另行签名安装。'
            : 'Select the encrypted package and signed license for this device. Installation requires a separate signature.'}</p>
        <div className='ControlModelDeliveryFiles'>
            <label>{zh ? '加密模型包' : 'Encrypted model package'}
                <input key={`package-${pickerEpoch}`} type='file' accept='.enc' disabled={pickersLocked}
                    onChange={event => setPackage(event.target.files?.[0])}/>
            </label>
            <label>{zh ? '签名许可文件' : 'Signed license file'}
                <input key={`license-${pickerEpoch}`} type='file' accept='.json,application/json' disabled={pickersLocked}
                    onChange={event => setLicense(event.target.files?.[0])}/>
            </label>
        </div>
        {complete && <p>{zh ? '已传完此模型包。要更换文件，请先清除暂存。'
            : 'This package has finished uploading. Clear the staged package to choose different files.'}</p>}
        <div className='ControlModelDeliveryActions'>
            <button type='button' onClick={upload} disabled={locked || !packageFile || !licenseFile || complete}>
                {requestId ? (zh ? '继续上传' : 'Resume upload') : (zh ? '开始上传' : 'Start upload')}
            </button>
            {activity === 'upload' && <button type='button' onClick={() => {
                action.current?.abort();
                action.current = undefined;
                setActivity(undefined);
                setNotice(zh ? '上传已暂停。继续时会查询节点偏移。' : 'Upload paused. Resuming will check the node offset.');
            }}>{zh ? '暂停上传' : 'Pause upload'}</button>}
            {requestId && <>
                <button type='button' onClick={() => inspect(requestId)} disabled={locked}>{zh ? '查询传输进度' : 'Check transfer progress'}</button>
                <button type='button' onClick={reconcile} disabled={locked}>{zh ? '核对安装记录' : 'Verify installation record'}</button>
                <button type='button' onClick={cancel} disabled={locked}>{zh ? '清除暂存' : 'Clear staged package'}</button>
            </>}
            {complete && <button type='button' onClick={prepare} disabled={locked}>{zh ? '准备安装授权' : 'Prepare installation approval'}</button>}
        </div>
        {!requestId && <details>
            <summary>{zh ? '接续已有传输' : 'Recover an existing transfer'}</summary>
            <form onSubmit={event => { event.preventDefault(); if (uuidPattern.test(recoveryId.trim())) inspect(recoveryId.trim()); }}>
                <label>{zh ? '已有传输编号' : 'Existing transfer ID'}
                    <input value={recoveryId} maxLength={36} disabled={locked} onChange={event => setRecoveryId(event.target.value)}/>
                </label>
                <button type='submit' disabled={locked || !uuidPattern.test(recoveryId.trim())}>{zh ? '接续传输' : 'Recover transfer'}</button>
            </form>
        </details>}
        {requestId && <p>{zh ? '传输编号' : 'Transfer ID'} <code>{requestId}</code></p>}
        {progress && <div className='ControlModelDeliveryProgress'>
            <progress value={progress.received_bytes} max={progress.package_size} aria-label={zh ? '上传进度' : 'Upload progress'}/>
            <span>{progress.received_bytes.toLocaleString()} / {progress.package_size.toLocaleString()} B</span>
        </div>}
        {error && <p role='alert'>{error}</p>}
        {notice && <p role='status'>{notice}</p>}
        <Dialog open={Boolean(pending)} onClose={() => decide(false)} disableEscapeKeyDown={Boolean(activity)}
            aria-labelledby='device-model-delivery-title' PaperProps={{sx: {backgroundColor: '#242424', color: '#eee'}}}>
            <DialogTitle id='device-model-delivery-title'>{zh ? '确认模型包安装' : 'Confirm model package installation'}</DialogTitle>
            {pending && <DialogContent>
                <p>{node.name} · {pending.target.model_id}</p>
                <p>{pending.parameters.expected_license_id || '—'} → {pending.target.license_id}</p>
                <p>{pending.parameters.package_size.toLocaleString()} B</p>
                <p>SHA-256 <code>{pending.parameters.package_sha256}</code></p>
            </DialogContent>}
            <DialogActions>
                <Button autoFocus disabled={Boolean(activity)} onClick={() => decide(false)}>{zh ? '取消' : 'Cancel'}</Button>
                <Button variant='contained' disabled={Boolean(activity)} onClick={() => decide(true)}>{zh ? '签名并安装' : 'Sign and install'}</Button>
            </DialogActions>
        </Dialog>
    </section>;
};
