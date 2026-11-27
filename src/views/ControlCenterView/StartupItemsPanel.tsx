import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Button, Dialog, DialogActions, DialogContent, DialogTitle} from '@mui/material';
import {v4 as uuidv4} from 'uuid';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeStartupAuthorization,
    ComputeStartupAuthorizationResult,
    ComputeStartupItem,
    ComputeStartupList,
    ComputeStartupRequest,
    isComputeAccessDenied,
} from '../../services/ComputeClusterService';
import {
    APPROVAL_IDENTITY_CHANGED, authorizationChallenge, canonicalAuthorizationJson, getApprovalIdentity, signAuthorization,
} from '../../services/ApprovalIdentityService';

interface IProps {
    node: ComputeClusterNode | null;
    zh: boolean;
    visible: boolean;
    readOnly?: boolean;
}

type Receipt = {
    id: string;
    name: string;
    enabled: boolean;
    at: number;
    outcome: 'succeeded' | 'rejected' | 'conflict' | 'unverified';
};

const itemScope = (item: ComputeStartupItem, zh: boolean): string =>
    item.source === 'machine' ? (zh ? '整机' : 'Machine') : (zh ? '当前用户' : 'Current user');
const itemState = (enabled: boolean, zh: boolean): string =>
    enabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已禁用' : 'Disabled');

const sameAuthorization = (actual: ComputeStartupAuthorization, expected: ComputeStartupAuthorization): boolean =>
    canonicalAuthorizationJson(authorizationChallenge(actual)) === canonicalAuthorizationJson(authorizationChallenge(expected));

const friendlyError = (reason: unknown, zh: boolean): string => {
    const raw = reason instanceof Error ? reason.message : String(reason);
    const localized = {
        target_changed: ['启动项状态已变化，请刷新后重试。', 'The startup item changed. Refresh and try again.'],
        protected: ['该启动项受保护，不能修改。', 'This startup item is protected.'],
        authorization_user_unknown: ['当前授权身份尚未登记到目标机器。', 'Your approval identity is not registered on this machine.'],
        waiting_for_network: ['未能确认节点执行结果，请刷新核对当前状态。', 'The result could not be verified. Refresh to check the current state.'],
        capability_unavailable: ['当前节点不支持启动项管理。', 'This node does not support startup management.'],
    };
    const match = Object.entries(localized).find(([code]) => raw.includes(code));
    if (match) return match[1][zh ? 0 : 1];
    if (isComputeAccessDenied(reason)) return zh
        ? '当前账号或授权身份无权变更启动项。' : 'Your account or approval identity cannot change startup items.';
    if (raw.includes('授权身份') || raw.includes('approval identity')) return raw;
    if (raw.includes('authorization_')) return zh ? '本次授权无效，请重新操作。' : 'This approval is no longer valid. Try again.';
    return zh ? '启动项操作失败，请刷新后重试。' : 'Startup item operation failed. Refresh and try again.';
};

// The capability, authorization, and confirmation states belong in one bounded panel.
// eslint-disable-next-line complexity
export const StartupItemsPanel: React.FC<IProps> = ({node, zh, visible, readOnly = false}) => {
    const [loaded, setLoaded] = useState<{nodeId: string; list: ComputeStartupList}>();
    const [readError, setReadError] = useState<{nodeId: string; denied: boolean}>();
    const [readAttempt, setReadAttempt] = useState(0);
    const nodeId = node?.node_id;
    const document = loaded?.nodeId === nodeId ? loaded?.list : undefined;
    const currentReadError = readError?.nodeId === nodeId ? readError : undefined;
    const [query, setQuery] = useState('');
    const [pending, setPending] = useState<ComputeStartupAuthorizationResult>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [needsRefresh, setNeedsRefresh] = useState(false);
    const action = useRef<symbol>();
    const lastAction = useRef<HTMLButtonElement>(null);
    const readable = Boolean(node?.online && node.capabilities.includes('runtime.startup.read.v1'));
    const manageable = !readOnly && Boolean(node?.online && node.capabilities.includes('control.startup.manage.v1'));

    useLayoutEffect(() => {
        setPending(undefined);
        setLoading(false);
        if (!manageable || !visible) return undefined;
        const resetIdentity = () => {
            action.current = undefined;
            setPending(undefined);
            setLoading(false);
            setReceipts([]);
            setReadAttempt(attempt => attempt + 1);
        };
        window.addEventListener(APPROVAL_IDENTITY_CHANGED, resetIdentity);
        return () => {
            action.current = undefined;
            window.removeEventListener(APPROVAL_IDENTITY_CHANGED, resetIdentity);
        };
    }, [manageable, nodeId, visible]);

    useEffect(() => {
        setReceipts([]);
    }, [nodeId]);

    useEffect(() => {
        setLoaded(undefined);
        setReadError(undefined);
        setError('');
        if (!nodeId || !visible || !readable) return undefined;
        const controller = new AbortController();
        void ComputeClusterService.startupItems(nodeId, controller.signal).then(result => {
            if (controller.signal.aborted) return;
            if (result.schema_version !== 'startup.list-result.v1') throw new Error('startup_result_invalid');
            setLoaded({nodeId, list: result});
            setNeedsRefresh(false);
        }).catch(reason => {
            if (!controller.signal.aborted) setReadError({nodeId, denied: isComputeAccessDenied(reason)});
        });
        return () => controller.abort();
    }, [manageable, nodeId, readable, readAttempt, visible]);

    const items = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase();
        return (document?.items || []).filter(item => !normalized || [
            item.name,
            item.item_id,
            item.source,
            itemState(item.enabled, zh),
        ].some(value => value.toLocaleLowerCase().includes(normalized)));
    }, [document, query, zh]);

    // Validate the complete server-prepared scope before asking for a signature.
    // eslint-disable-next-line complexity
    const prepare = async (item: ComputeStartupItem, button: HTMLButtonElement) => {
        if (!node || action.current || pending || needsRefresh || item.protected || !manageable || !visible) return;
        const operation = Symbol();
        action.current = operation;
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
            if (action.current !== operation) return;
            const authorization = created.authorization;
            if (
                authorization.operation !== request.tool
                || created.response.tool !== request.tool
                || created.response.schema_version !== 'agentos.capability-response.v1'
                || created.response.state !== 'authorization_required'
                || created.response.request_id !== request.request_id
                || created.response.node_id !== request.node_id
                || created.response.authorization?.authorization_id !== authorization.authorization_id
                || authorization.user_id !== identity.user.user_id
                || authorization.user_public_key !== identity.user.user_public_key
                || authorization.user_name !== identity.user.user_name
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
                || created.item.name !== item.name
                || created.item.source !== item.source
                || created.item.enabled !== item.enabled
                || created.item.protected
            ) throw new Error('startup_authorization_mismatch');
            setPending(created);
        } catch (reason) {
            if (action.current === operation) {
                setError(friendlyError(reason, zh));
                if (reason instanceof Error && reason.message.includes('target_changed')) setNeedsRefresh(true);
            }
        } finally {
            if (action.current === operation) {
                action.current = undefined;
                setLoading(false);
            }
        }
    };

    const recordReceipt = (request: ComputeStartupAuthorizationResult, outcome: Receipt['outcome']) => {
        setReceipts(current => [{
            id: request.authorization.authorization_id,
            name: request.item?.name || request.authorization.target.item_id,
            enabled: request.authorization.parameters.enabled,
            at: Date.now(),
            outcome,
        }, ...current.filter(row => row.id !== request.authorization.authorization_id)].slice(0, 10));
    };

    const reject = async () => {
        if (!pending || action.current || !manageable) return;
        const operation = Symbol();
        action.current = operation;
        setPending(undefined);
        setLoading(true);
        try {
            const rejected = await ComputeClusterService.rejectStartupAuthorization(pending.authorization.authorization_id);
            if (action.current !== operation) return;
            if (rejected.state !== 'rejected' || !sameAuthorization(rejected, pending.authorization)) {
                throw new Error('startup_result_mismatch');
            }
            recordReceipt(pending, 'rejected');
        } catch (reason) {
            if (action.current === operation) {
                recordReceipt(pending, 'unverified');
                setError(friendlyError(reason, zh));
            }
        } finally {
            if (action.current === operation) {
                action.current = undefined;
                setLoading(false);
                lastAction.current?.focus();
            }
        }
    };

    // Confirm the signed scope and the reported state before updating the displayed item.
    // eslint-disable-next-line complexity
    const approve = async () => {
        if (!pending || action.current || !node || !visible || !manageable) return;
        const authorization = pending.authorization;
        if (authorization.target_installation_id !== node.installation_id) return;
        const operation = Symbol();
        action.current = operation;
        let submitted = false;
        setLoading(true);
        setError('');
        try {
            const signature = await signAuthorization(authorization, getApprovalIdentity());
            if (action.current !== operation) return;
            submitted = true;
            const decided = await ComputeClusterService.approveStartupAuthorization(
                authorization.authorization_id, signature,
            );
            if (action.current !== operation) return;
            const result = decided.response.result;
            if (
                decided.authorization.state !== 'succeeded'
                || !sameAuthorization(decided.authorization, authorization)
                || decided.response.schema_version !== 'agentos.capability-response.v1'
                || decided.response.tool !== authorization.operation
                || decided.response.state !== 'succeeded'
                || decided.response.request_id !== authorization.target.request_id
                || decided.response.node_id !== authorization.target_installation_id
                || result?.schema_version !== 'startup.set-enabled-result.v1'
                || result.changed !== true
                || result.item.item_id !== authorization.target.item_id
                || result.item.source !== pending.item?.source
                || result.previous_enabled !== authorization.parameters.expected_enabled
                || result.item.enabled !== authorization.parameters.enabled
                || result.item.protected
            ) throw new Error('startup_result_mismatch');
            setLoaded(current => current && current.nodeId === nodeId ? {
                ...current,
                list: {
                    ...current.list,
                    items: current.list.items.map(item => item.item_id === result.item.item_id ? result.item : item),
                },
            } : current);
            recordReceipt(pending, 'succeeded');
        } catch (reason) {
            if (action.current === operation) {
                setError(friendlyError(reason, zh));
                if (submitted) {
                    setNeedsRefresh(true);
                    const changed = reason instanceof Error && reason.message.includes('target_changed');
                    recordReceipt(pending, changed ? 'conflict' : 'unverified');
                }
            }
        } finally {
            if (action.current === operation) {
                action.current = undefined;
                setLoading(false);
                setPending(undefined);
                lastAction.current?.focus();
            }
        }
    };

    if (!node || !readable) return <div className='ControlMonitorUnavailable'>
        <strong>{!node ? (zh ? '请先选择节点' : 'Choose a node') : !node.online ? (zh ? '节点离线' : 'Node offline') : (zh ? '节点版本暂不支持启动项清单' : 'This node does not support startup items yet')}</strong>
    </div>;
    if (currentReadError) return <div className='ControlMonitorUnavailable' role='alert'>
        <strong>{currentReadError.denied
            ? (zh ? '当前账号无权读取启动项。' : 'You do not have access to startup items.')
            : (zh ? '启动项清单读取失败。' : 'Could not read the startup app list.')}</strong>
        <div className='ControlMonitorSearchTools'>
            <button type='button' onClick={() => setReadAttempt(attempt => attempt + 1)}>{zh ? '重试' : 'Retry'}</button>
        </div>
    </div>;
    if (!document) return <div className='ControlMonitorUnavailable' role='status'>
        <strong>{zh ? '正在读取启动项…' : 'Loading startup items…'}</strong>
    </div>;
    if (!document.available) return <div className='ControlMonitorUnavailable'>
        <strong>{zh ? '当前平台暂不支持读取启动项' : 'Startup items are unavailable on this platform'}</strong>
    </div>;

    return <section className='ControlMonitorProcesses ControlMonitorInventory ControlStartupItems' aria-label={zh ? '启动应用清单' : 'Startup app list'}>
        <header className='ControlMonitorSearchHeader'>
            <h3>{zh ? '启动应用' : 'Startup apps'}</h3>
            <div className='ControlMonitorSearchTools'><input type='search' value={query} aria-label={zh ? '搜索启动应用' : 'Search startup apps'} placeholder={zh ? '搜索名称、标识、状态或范围' : 'Search name, identifier, status, or scope'} onChange={event => setQuery(event.target.value)}/><button type='button' onClick={() => setReadAttempt(attempt => attempt + 1)} disabled={loading}>{zh ? '刷新' : 'Refresh'}</button><span>{items.length}/{document.items.length}</span></div>
        </header>
        {error && <div className='ControlMonitorUnavailable' role='alert'><strong>{error}</strong>
            {needsRefresh && <span>{zh ? '请刷新清单，核对设备当前状态后再操作。' : 'Refresh the list and verify the current state before retrying.'}</span>}
        </div>}
        <div className='ControlStartupTableWrap' role='region' tabIndex={0}
            aria-label={zh ? '启动项表格' : 'Startup items table'}>
            <table><thead><tr><th>{zh ? '名称' : 'Name'}</th><th>{zh ? '标识' : 'Identifier'}</th><th>{zh ? '范围' : 'Scope'}</th><th>{zh ? '状态' : 'Status'}</th>{!readOnly && <th>{zh ? '操作' : 'Action'}</th>}</tr></thead><tbody>{items.map(item => <tr key={item.item_id}>
                <td>{item.name}</td><td title={item.item_id}>{item.item_id.slice(0, 12)}…</td><td>{itemScope(item, zh)}</td><td>{itemState(item.enabled, zh)}</td>{!readOnly && <td><button type='button' disabled={loading || Boolean(pending) || needsRefresh || item.protected || !manageable} onClick={event => void prepare(item, event.currentTarget)}>{item.protected ? (zh ? '受保护' : 'Protected') : item.enabled ? (zh ? '禁用' : 'Disable') : (zh ? '恢复' : 'Restore')}</button></td>}
            </tr>)}</tbody></table>
        </div>
        {!items.length && <div className='ControlMonitorUnavailable'><strong>{document.items.length
            ? (zh ? '没有匹配的启动项' : 'No matching startup items')
            : (zh ? '当前没有启动项' : 'No startup items')}</strong></div>}

        {!readOnly && receipts.length > 0 && <section className='ControlStartupReceipts' aria-label={zh ? '此面板的启动项操作记录' : 'Startup operations in this panel'}>
            <h4>{zh ? '此面板的启动项操作记录' : 'Startup operations in this panel'}</h4>
            <ul>{receipts.map(receipt => <li key={receipt.id}>
                <strong>{receipt.name} · {receipt.enabled ? (zh ? '恢复' : 'Restore') : (zh ? '禁用' : 'Disable')}</strong>
                <span>{({
                    succeeded: zh ? '已确认执行' : 'Applied',
                    rejected: zh ? '已取消授权' : 'Approval cancelled',
                    conflict: zh ? '目标状态已变化' : 'Target state changed',
                    unverified: zh ? '结果待核对' : 'Result unverified',
                })[receipt.outcome]}</span>
                <time dateTime={new Date(receipt.at).toISOString()}>{new Date(receipt.at).toLocaleString(zh ? 'zh-CN' : 'en-US')}</time>
                <code title={receipt.id}>{receipt.id}</code>
            </li>)}</ul>
        </section>}

        <Dialog open={Boolean(pending && pending.authorization.target_installation_id === node.installation_id && visible && manageable)}
            onClose={() => void reject()} disableEscapeKeyDown={loading} aria-labelledby='startup-authorization-title'
            PaperProps={{sx: {backgroundColor: '#242424', color: '#eee'}}}>
            <DialogTitle id='startup-authorization-title'>{pending?.authorization.parameters.enabled ? (zh ? '确认恢复启动项' : 'Confirm startup restore') : (zh ? '确认禁用启动项' : 'Confirm startup disable')}</DialogTitle>
            {pending?.item && <DialogContent>
                <p>{node.name} · {pending.item.name} · {itemScope(pending.item, zh)}</p>
                <p>{itemState(pending.authorization.parameters.expected_enabled, zh)} → {itemState(pending.authorization.parameters.enabled, zh)}</p>
                <p>{zh ? '执行前会再次核对状态。恢复需要重新签名授权。' : 'The state is checked again before applying. Restore requires a new signed approval.'}</p>
            </DialogContent>}
            <DialogActions>
                <Button autoFocus onClick={() => void reject()} disabled={loading}>{zh ? '取消' : 'Cancel'}</Button>
                <Button variant='contained' onClick={() => void approve()} disabled={loading}>{loading ? (zh ? '正在执行…' : 'Applying…') : (zh ? '授权并执行' : 'Approve and apply')}</Button>
            </DialogActions>
        </Dialog>
    </section>;
};
