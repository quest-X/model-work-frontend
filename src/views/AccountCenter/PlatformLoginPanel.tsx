import React, {useState} from 'react';
import {saveAs} from 'file-saver';
import {ComputeClusterService} from '../../services/ComputeClusterService';
import {accountCsrfToken} from '../../services/AccountService';

const manage = async <T,>(action: string, body: object = {}): Promise<T> => {
    const response = await fetch('/core_service/account/platform-login/manage', {
        method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json', 'X-CSRF-Token': accountCsrfToken()},
        body: JSON.stringify({action, body}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.detail?.message || `HTTP ${response.status}`);
    return result;
};
const readFile = async (file: File): Promise<object> => {
    if (file.size > 16384) throw new Error('File exceeds 16 KB');
    return JSON.parse(await file.text());
};
const download = (name: string, document: object) => saveAs(
    new Blob([JSON.stringify(document, null, 2)], {type: 'application/json'}), name,
);
type Activity = {
    grants: Array<{grant_id: string; label: string; expires_at: number; revoked_at: number | null}>;
    imports: Array<{node_id: string}>;
};

// Bilingual labels and pairing controls share state; the JSX branches are presentation only.
// eslint-disable-next-line complexity
export const PlatformLoginPanel: React.FC<{zh: boolean}> = ({zh}) => {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [request, setRequest] = useState<object | null>(null);
    const [label, setLabel] = useState('Mac Master');
    const [days, setDays] = useState(30);
    const [nodes, setNodes] = useState<Array<{node_id: string; name: string}>>([]);
    const [nodeId, setNodeId] = useState('');
    const [activity, setActivity] = useState<Activity>({grants: [], imports: []});
    const load = async () => {
        const [records, machines] = await Promise.all([manage<Activity>('list'), ComputeClusterService.nodes()]);
        setActivity(records);
        setNodes(machines.filter(node => node.role === 'main' && node.capabilities.includes('platform.host.v1')));
    };
    const run = async (action: () => Promise<void>) => {
        setBusy(true); setMessage('');
        try { await action(); }
        catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); }
    };
    const readInput = (event: React.ChangeEvent<HTMLInputElement>, accept: (file: File) => Promise<void>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void run(() => accept(file));
    };
    return <div className='AccountPlatformLogin'>
        <h4>{zh ? '平台免密登录' : 'Trusted platform login'}</h4>
        <button type='button' disabled={busy} aria-expanded={open} onClick={() => {
            setOpen(!open);
            if (!open) void run(load);
        }}>{zh ? '管理授权文件' : 'Manage authorization files'}</button>
        {open && <>
            <p>{zh ? '首次绑定：Mac 导出申请 → 远端导入申请并导出授权 → Mac 导入授权。私钥保留本机。'
                : 'Pair once: export a Mac request, authorize it on the remote platform, then import the grant on the Mac. Private keys stay local.'}</p>
            <button type='button' disabled={busy} onClick={() => void run(async () => {
                download('opensight-master-request.json', await manage<object>('request'));
            })}>{zh ? '本机：导出接入申请' : 'This Master: export pairing request'}</button>
            <h4>{zh ? '远端：签发给这台 Master' : 'Remote: authorize this Master'}</h4>
            <label>{zh ? '接入申请文件' : 'Pairing request file'}<input type='file' accept='.json' disabled={busy}
                onChange={event => readInput(event, async file => { setRequest(await readFile(file)); })}/></label>
            <label>{zh ? '设备名称' : 'Device name'}<input value={label} maxLength={128} disabled={busy}
                onChange={event => setLabel(event.target.value)}/></label>
            <label>{zh ? '有效天数（1–365）' : 'Days (1–365)'}<input type='number' min={1} max={365}
                value={days} disabled={busy} onChange={event => setDays(Number(event.target.value))}/></label>
            <p>{zh ? '签发后，此 Master 可在有效期内以当前账户免密登录。设备操作仍遵守原有审批；可随时撤销。'
                : 'This Master can sign in as your current account until expiry or revocation. Existing device approval requirements remain.'}</p>
            <button type='button' disabled={busy || !request || !label.trim() || !Number.isInteger(days) || days < 1 || days > 365}
                onClick={() => void run(async () => {
                    download('opensight-platform-grant.json', await manage<object>('export', {request, label, days}));
                    setRequest(null); await load();
                })}>{zh ? '授权并导出文件' : 'Authorize and export grant'}</button>
            <h4>{zh ? 'Mac Master：导入远端授权' : 'Mac Master: import remote grant'}</h4>
            <label>{zh ? '远程平台' : 'Remote platform'}<select value={nodeId} disabled={busy} onChange={event => setNodeId(event.target.value)}>
                <option value=''>{zh ? '选择平台' : 'Select platform'}</option>
                {nodes.map(node => <option key={node.node_id} value={node.node_id}>{node.name}</option>)}
            </select></label>
            <label>{zh ? '远端导出的授权文件' : 'Grant exported by the remote platform'}<input type='file' accept='.json'
                disabled={busy || !nodeId} onChange={event => readInput(event, async file => {
                    await manage('import', {node_id: nodeId, document: await readFile(file)});
                    await load(); setMessage(zh ? '已导入，请重新打开远程平台。' : 'Imported. Reopen the remote platform.');
                })}/></label>
            {activity.imports.map(item => <p key={item.node_id}>
                {nodes.find(node => node.node_id === item.node_id)?.name || item.node_id}{' '}
                <button type='button' disabled={busy} onClick={() => void run(async () => {
                    await manage('forget', {node_id: item.node_id}); await load();
                })}>{zh ? '移除本机授权文件' : 'Remove local grant'}</button>
            </p>)}
            <h4>{zh ? '本平台已签发授权' : 'Grants issued by this platform'}</h4>
            {activity.grants.map(grant => <p key={grant.grant_id}>
                {grant.label} · {new Date(grant.expires_at * 1000).toLocaleDateString(zh ? 'zh-CN' : 'en-US')}{' '}
                {grant.revoked_at ? (zh ? '已撤销' : 'Revoked') : <button type='button' disabled={busy} onClick={() => void run(async () => {
                    await manage('revoke', {grant_id: grant.grant_id}); await load();
                })}>{zh ? '撤销授权及关联会话' : 'Revoke grant and linked sessions'}</button>}
            </p>)}
            <p role='status'>{message}</p>
        </>}
    </div>;
};
