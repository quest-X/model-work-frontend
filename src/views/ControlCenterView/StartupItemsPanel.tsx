import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Button, Dialog, DialogActions, DialogContent, DialogTitle} from '@mui/material';
import {v4 as uuidv4} from 'uuid';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeStartupAuthorizationResult,
    ComputeStartupItem,
    ComputeStartupList,
    ComputeStartupRequest,
} from '../../services/ComputeClusterService';
import {canonicalAuthorizationJson, getApprovalIdentity, signAuthorization} from '../../services/ApprovalIdentityService';

interface IProps {
    node: ComputeClusterNode | null;
    zh: boolean;
    visible: boolean;
}

const friendlyError = (reason: unknown, zh: boolean): string => {
    const raw = reason instanceof Error ? reason.message : String(reason);
    if (raw.includes('target_changed')) return zh ? '启动项状态已变化，请刷新后重试。' : 'The startup item changed. Refresh and try again.';
    if (raw.includes('permission_denied') || raw.includes('protected')) return zh ? '该启动项受保护，不能修改。' : 'This startup item is protected.';
    if (raw.includes('authorization_')) return zh ? '本次授权无效，请重新操作。' : 'This approval is no longer valid. Try again.';
    if (raw.includes('capability_unavailable')) return zh ? '当前节点不支持启动项管理。' : 'This node does not support startup management.';
    return zh ? '启动项操作失败，请刷新后重试。' : 'Startup item operation failed. Refresh and try again.';
};

// The capability, authorization, and confirmation states belong in one bounded panel.
// eslint-disable-next-line complexity
export const StartupItemsPanel: React.FC<IProps> = ({node, zh, visible}) => {
    const [document, setDocument] = useState<ComputeStartupList>();
    const [query, setQuery] = useState('');
    const [pending, setPending] = useState<ComputeStartupAuthorizationResult>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const lastAction = useRef<HTMLButtonElement>(null);
    const readable = Boolean(node?.online && node.capabilities.includes('runtime.startup.read.v1'));
    const manageable = Boolean(node?.online && node.capabilities.includes('control.startup.manage.v1'));

    const load = async () => {
        if (!node || !visible || !readable) return;
        setLoading(true);
        setError('');
        try {
            const result = await ComputeClusterService.startupItems(node.node_id);
            if (result.schema_version !== 'startup.list-result.v1') throw new Error('startup_result_invalid');
            setDocument(result);
        } catch (reason) {
            setError(friendlyError(reason, zh));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, [node?.node_id, readable, visible]);

    const items = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase();
        return (document?.items || []).filter(item => !normalized || [
            item.name,
            item.item_id,
            item.source,
            item.enabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已禁用' : 'Disabled'),
        ].some(value => value.toLocaleLowerCase().includes(normalized)));
    }, [document, query, zh]);

    // Validate the complete server-prepared scope before asking for a signature.
    // eslint-disable-next-line complexity
    const prepare = async (item: ComputeStartupItem, button: HTMLButtonElement) => {
        if (!node || loading || item.protected || !manageable) return;
        lastAction.current = button;
        setLoading(true);
        setError('');
        try {
            const identity = getApprovalIdentity();
            const requestId = uuidv4();
            const request: ComputeStartupRequest = {
                schema_version: 'agentos.capability-request.v1',
                request_id: requestId,
                idempotency_key: requestId,
                tool: 'agentos.startup.set_enabled',
                node_id: node.node_id,
                arguments: {
                    item_id: item.item_id,
                    enabled: !item.enabled,
                    expected_enabled: item.enabled,
                },
            };
            const created = await ComputeClusterService.createStartupAuthorization(
                node.node_id,
                {request, user: identity.user, ttl_seconds: 120},
            );
            const authorization = created.authorization;
            if (
                created.response.state !== 'authorization_required'
                || created.response.request_id !== request.request_id
                || created.response.node_id !== request.node_id
                || created.response.authorization?.authorization_id !== authorization.authorization_id
                || authorization.state !== 'pending'
                || authorization.target_installation_id !== node.installation_id
                || authorization.target.kind !== 'startup_item'
                || authorization.target.item_id !== item.item_id
                || authorization.target.request_id !== request.request_id
                || authorization.target.idempotency_key !== request.idempotency_key
                || canonicalAuthorizationJson(authorization.parameters)
                    !== canonicalAuthorizationJson({
                        enabled: request.arguments.enabled,
                        expected_enabled: request.arguments.expected_enabled,
                    })
                || !created.item
                || created.item.item_id !== item.item_id
                || created.item.enabled !== item.enabled
                || created.item.protected
            ) throw new Error('startup_authorization_mismatch');
            setPending(created);
        } catch (reason) {
            setError(friendlyError(reason, zh));
        } finally {
            setLoading(false);
        }
    };

    const reject = async () => {
        const authorization = pending?.authorization;
        setPending(undefined);
        lastAction.current?.focus();
        if (!authorization) return;
        try {
            await ComputeClusterService.rejectStartupAuthorization(authorization.authorization_id);
        } catch (reason) {
            setError(friendlyError(reason, zh));
        }
    };

    const approve = async () => {
        const authorization = pending?.authorization;
        if (!authorization || loading) return;
        setLoading(true);
        setError('');
        try {
            const signature = await signAuthorization(authorization, getApprovalIdentity());
            const decided = await ComputeClusterService.approveStartupAuthorization(
                authorization.authorization_id, signature,
            );
            const result = decided.response.result;
            if (
                decided.authorization.authorization_id !== authorization.authorization_id
                || decided.response.state !== 'succeeded'
                || decided.response.request_id !== authorization.target.request_id
                || decided.response.node_id !== authorization.target_installation_id
                || !result
                || result.item.item_id !== authorization.target.item_id
                || result.previous_enabled !== authorization.parameters.expected_enabled
                || result.item.enabled !== authorization.parameters.enabled
                || result.item.protected
            ) throw new Error('startup_result_mismatch');
            setDocument(current => current ? {
                ...current,
                items: current.items.map(item => item.item_id === result.item.item_id ? result.item : item),
            } : current);
            setPending(undefined);
        } catch (reason) {
            setPending(undefined);
            setError(friendlyError(reason, zh));
            lastAction.current?.focus();
        } finally {
            setLoading(false);
        }
    };

    if (!node || !readable) return <div className='ControlMonitorUnavailable'>
        <strong>{!node ? (zh ? '请先选择节点' : 'Choose a node') : !node.online ? (zh ? '节点离线' : 'Node offline') : (zh ? '节点版本暂不支持启动项清单' : 'This node does not support startup items yet')}</strong>
    </div>;
    if (!document?.available) return <div className='ControlMonitorUnavailable'>
        <strong>{loading ? (zh ? '正在读取启动项…' : 'Loading startup items…') : error || (zh ? '当前平台暂不支持启动项管理' : 'Startup management is unavailable on this platform')}</strong>
    </div>;

    return <section className='ControlMonitorProcesses ControlMonitorInventory' aria-label={zh ? '启动应用清单' : 'Startup app list'}>
        <header className='ControlMonitorSearchHeader'>
            <h3>{zh ? '启动应用' : 'Startup apps'}</h3>
            <div className='ControlMonitorSearchTools'><input type='search' value={query} aria-label={zh ? '搜索启动应用' : 'Search startup apps'} placeholder={zh ? '搜索名称、标识、状态或范围' : 'Search name, identifier, status, or scope'} onChange={event => setQuery(event.target.value)}/><button type='button' onClick={() => void load()} disabled={loading}>{zh ? '刷新' : 'Refresh'}</button><span>{items.length}/{document.items.length}</span></div>
        </header>
        {error && <div className='ControlMonitorUnavailable'><strong>{error}</strong></div>}
        <table><thead><tr><th>{zh ? '名称' : 'Name'}</th><th>{zh ? '标识' : 'Identifier'}</th><th>{zh ? '范围' : 'Scope'}</th><th>{zh ? '状态' : 'Status'}</th><th>{zh ? '操作' : 'Action'}</th></tr></thead><tbody>{items.map(item => <tr key={item.item_id}>
            <td>{item.name}</td><td title={item.item_id}>{item.item_id.slice(0, 12)}…</td><td>{item.source === 'machine' ? (zh ? '整机' : 'Machine') : (zh ? '当前用户' : 'Current user')}</td><td>{item.enabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已禁用' : 'Disabled')}</td><td><button type='button' disabled={loading || item.protected || !manageable} onClick={event => void prepare(item, event.currentTarget)}>{item.protected ? (zh ? '受保护' : 'Protected') : item.enabled ? (zh ? '禁用' : 'Disable') : (zh ? '恢复' : 'Restore')}</button></td>
        </tr>)}</tbody></table>
        {!items.length && <div className='ControlMonitorUnavailable'><strong>{zh ? '没有匹配的启动项' : 'No matching startup items'}</strong></div>}

        <Dialog open={Boolean(pending && visible)} onClose={() => void reject()} aria-labelledby='startup-authorization-title'>
            <DialogTitle id='startup-authorization-title'>{pending?.authorization.parameters.enabled ? (zh ? '确认恢复启动项' : 'Confirm startup restore') : (zh ? '确认禁用启动项' : 'Confirm startup disable')}</DialogTitle>
            <DialogContent><p>{pending?.item?.name}</p><p>{zh ? '状态会在执行前再次核对；恢复操作也需要新的授权。' : 'State is checked again before execution; restoring also requires a new approval.'}</p></DialogContent>
            <DialogActions><Button onClick={() => void reject()} disabled={loading}>{zh ? '取消' : 'Cancel'}</Button><Button variant='contained' autoFocus onClick={() => void approve()} disabled={loading}>{loading ? (zh ? '正在执行…' : 'Applying…') : (zh ? '授权并执行' : 'Approve and apply')}</Button></DialogActions>
        </Dialog>
    </section>;
};
