import React, {FormEvent, useEffect, useMemo, useRef, useState} from 'react';
import {Button, Dialog, DialogActions, DialogContent, DialogTitle} from '@mui/material';
import {v4 as uuidv4} from 'uuid';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeDuplicateAuthorizationResult,
    ComputeDuplicateRequest,
    ComputeDuplicateResponse,
    ComputeDuplicateResult,
} from '../../services/ComputeClusterService';
import {canonicalAuthorizationJson, getApprovalIdentity, signAuthorization} from '../../services/ApprovalIdentityService';
import {absolutePath, formatBytes, storageFullPath} from './StorageAnalysisPanel';
import './StorageAnalysisPanel.scss';

interface IProps {
    node: ComputeClusterNode | null;
    zh: boolean;
    visible: boolean;
}

type SuccessfulScan = {result: ComputeDuplicateResult; roots: string[]; completedAt: number};

const ACTIVE_STATES = new Set(['queued', 'running', 'paused']);
const MIB = 1024 * 1024;

const friendlyError = (reason: unknown, zh: boolean): string => {
    const raw = reason instanceof Error ? reason.message : String(reason);
    if (raw.includes('authorization_')) return zh ? '本次授权无效，请重新开始扫描。' : 'This approval is no longer valid. Start again.';
    if (raw.includes('waiting_for_network')) return zh ? '机器当前不可达，连接恢复后可继续查看任务。' : 'The machine is unreachable. Check the task after connectivity returns.';
    if (raw.includes('target_changed') || raw.includes('root_unavailable')) return zh ? '目录在授权后发生变化或不可读取，请重新确认。' : 'The directory changed or cannot be read. Confirm it again.';
    if (raw.includes('capability_unavailable')) return zh ? '当前节点版本暂不支持重复文件扫描。' : 'This node version does not support duplicate scanning.';
    return zh ? '重复文件扫描失败，请稍后重试。' : 'Duplicate scan failed. Try again.';
};

const responseMatches = (
    response: ComputeDuplicateResponse,
    request: Pick<ComputeDuplicateRequest, 'request_id' | 'node_id'>,
    taskId?: string,
): boolean => response.schema_version === 'agentos.capability-response.v1'
    && response.tool === 'agentos.duplicate.scan'
    && response.request_id === request.request_id
    && response.node_id === request.node_id
    && (!taskId || response.task_id === taskId);

const resultMatchesRoots = (result: ComputeDuplicateResult, rootCount: number): boolean => [
    ...result.groups.flatMap(group => group.files),
    ...result.warnings,
].every(item => item.root_index < rootCount);

// eslint-disable-next-line complexity
export const DuplicateAnalysisPanel: React.FC<IProps> = ({node, zh, visible}) => {
    const [path, setPath] = useState('');
    const [minMiB, setMinMiB] = useState(1);
    const [pending, setPending] = useState<ComputeDuplicateAuthorizationResult>();
    const [response, setResponse] = useState<ComputeDuplicateResponse>();
    const [roots, setRoots] = useState<string[]>([]);
    const [success, setSuccess] = useState<SuccessfulScan>();
    const [busy, setBusy] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState('');
    const startButton = useRef<HTMLButtonElement>(null);
    const windows = Boolean(node?.resources.platform.toLowerCase().includes('windows'));
    const available = Boolean(node?.online && node.capabilities.includes('task.duplicate.scan.v1'));
    const active = Boolean(response && ACTIVE_STATES.has(response.state));
    const currentRequest = useMemo(() => response
        ? {request_id: response.request_id, node_id: response.node_id}
        : null, [response]);

    useEffect(() => {
        if (!visible || !active || !response?.task_id || !currentRequest) return undefined;
        const controller = new AbortController();
        let timer = 0;
        // eslint-disable-next-line complexity
        const poll = async () => {
            try {
                const next = await ComputeClusterService.duplicateStatus(
                    currentRequest.node_id, response.task_id as string, controller.signal,
                );
                if (controller.signal.aborted) return;
                if (!responseMatches(next, currentRequest, response.task_id as string)) throw new Error('duplicate_response_mismatch');
                setResponse(next);
                setError(next.error ? friendlyError(next.error.code, zh) : '');
                if (next.state === 'succeeded' && next.result) {
                    if (!resultMatchesRoots(next.result, roots.length)) throw new Error('duplicate_result_mismatch');
                    setSuccess({result: next.result, roots, completedAt: Date.now()});
                } else if (ACTIVE_STATES.has(next.state)) {
                    timer = window.setTimeout(poll, 1000);
                }
            } catch (reason) {
                if (controller.signal.aborted) return;
                setError(friendlyError(reason, zh));
                timer = window.setTimeout(poll, 2000);
            }
        };
        timer = window.setTimeout(poll, 250);
        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [active, currentRequest, response?.task_id, roots, visible, zh]);

    // eslint-disable-next-line complexity
    const prepare = async (event: FormEvent) => {
        event.preventDefault();
        const root = path.trim();
        if (!node || !available || busy || active) return;
        if (!absolutePath(root, windows)) {
            setError(zh ? '请输入当前平台的绝对目录路径。' : 'Enter an absolute path for this platform.');
            return;
        }
        if (!Number.isInteger(minMiB) || minMiB < 1 || minMiB > 1024 * 1024) {
            setError(zh ? '文件阈值须为 1 至 1048576 MiB。' : 'File threshold must be 1–1048576 MiB.');
            return;
        }
        setBusy(true);
        setError('');
        setCancelling(false);
        try {
            const identity = getApprovalIdentity();
            const requestId = uuidv4();
            const request: ComputeDuplicateRequest = {
                schema_version: 'agentos.capability-request.v1',
                request_id: requestId,
                idempotency_key: requestId,
                tool: 'agentos.duplicate.scan',
                node_id: node.node_id,
                arguments: {roots: [{kind: 'path', path: root}], min_file_bytes: minMiB * MIB, max_groups: 200},
            };
            const created = await ComputeClusterService.createDuplicateAuthorization({
                request, user: identity.user, ttl_seconds: 120,
            });
            const authorization = created.authorization;
            if (!responseMatches(created.response, request)
                || created.response.state !== 'authorization_required'
                || created.response.authorization?.authorization_id !== authorization.authorization_id
                || authorization.state !== 'pending'
                || authorization.target_installation_id !== node.installation_id
                || authorization.operation !== request.tool
                || authorization.target.kind !== 'duplicate_roots'
                || authorization.target.request_id !== request.request_id
                || authorization.target.idempotency_key !== request.idempotency_key
                || canonicalAuthorizationJson(authorization.parameters) !== canonicalAuthorizationJson({
                    min_file_bytes: request.arguments.min_file_bytes, max_groups: 200,
                })
                || authorization.user_id !== identity.user.user_id
                || authorization.user_public_key !== identity.user.user_public_key) {
                throw new Error('duplicate_authorization_mismatch');
            }
            setRoots(authorization.target.roots.map(item => item.path));
            setPending(created);
            setResponse(created.response);
        } catch (reason) {
            setError(friendlyError(reason, zh));
        } finally {
            setBusy(false);
        }
    };

    const reject = async () => {
        const authorization = pending?.authorization;
        setPending(undefined);
        startButton.current?.focus();
        if (!authorization) return;
        try {
            await ComputeClusterService.rejectStorageAuthorization(authorization.authorization_id);
        } catch (reason) {
            setError(friendlyError(reason, zh));
        }
    };

    const approve = async () => {
        const authorization = pending?.authorization;
        if (!authorization || busy) return;
        setBusy(true);
        setError('');
        try {
            const signature = await signAuthorization(authorization, getApprovalIdentity());
            const decision = await ComputeClusterService.approveDuplicateAuthorization(authorization.authorization_id, signature);
            if (decision.authorization.authorization_id !== authorization.authorization_id
                || !responseMatches(decision.response, {
                    request_id: authorization.target.request_id,
                    node_id: authorization.target_installation_id,
                }, authorization.authorization_id)
                || !ACTIVE_STATES.has(decision.response.state)) throw new Error('duplicate_decision_mismatch');
            setResponse(decision.response);
            setPending(undefined);
        } catch (reason) {
            setPending(undefined);
            startButton.current?.focus();
            setError(friendlyError(reason, zh));
        } finally {
            setBusy(false);
        }
    };

    const cancel = async () => {
        if (!response?.task_id || cancelling) return;
        setCancelling(true);
        setError('');
        try {
            await ComputeClusterService.controlTask({node_id: response.node_id, task_id: response.task_id}, 'cancel');
        } catch (reason) {
            setError(friendlyError(reason, zh));
            setCancelling(false);
        }
    };

    const copyPath = async (rootIndex: number, relativePath: string) => {
        try {
            const value = storageFullPath(success?.roots[rootIndex] || '', relativePath);
            await navigator.clipboard.writeText(value);
            setCopied(value);
        } catch {
            setError(zh ? '浏览器未允许复制路径。' : 'The browser did not allow copying the path.');
        }
    };

    const result = success?.result;
    const status = response?.state === 'succeeded'
        ? (zh ? '扫描完成' : 'Scan complete')
        : response?.state === 'cancelled'
            ? (zh ? '扫描已取消，未生成完整结论' : 'Scan cancelled; no complete conclusion')
            : response?.state === 'failed'
                ? friendlyError(response.error?.code, zh)
                : response?.progress
                    ? `${zh ? '正在扫描' : 'Scanning'} · ${response.progress.files_scanned} ${zh ? '个文件' : 'files'} · ${formatBytes(response.progress.bytes_scanned)}`
                    : active ? (zh ? '任务已排队' : 'Task queued') : '';

    return <section className='StorageAnalysisPanel' aria-label={zh ? '重复文件' : 'Duplicate files'}>
        <header className='StorageAnalysisHeading'>
            <div><h3>{zh ? '重复文件' : 'Duplicate files'}</h3><p>{zh ? '内容仅在目标机器本地计算哈希；只生成报告，不删除文件。' : 'Hashes locally on the target machine; reports only and never deletes files.'}</p></div>
            <span className={!node ? 'unselected' : available ? 'healthy' : 'offline'}>{!node ? (zh ? '请选择机器' : 'Choose machine') : available ? (zh ? '只读 · 正常' : 'Read-only · Normal') : (zh ? '不可用' : 'Unavailable')}</span>
        </header>

        {!node && <div className='StorageAnalysisNotice'>{zh ? '请先从机器列表选择目标机器。' : 'Choose a target machine from the machine list.'}</div>}
        {node && !available && <div className='StorageAnalysisNotice'>{!node.online ? (zh ? '机器当前离线，暂不能开始新扫描。' : 'The machine is offline; a new scan cannot start.') : (zh ? '当前节点版本暂不支持重复文件扫描。' : 'This node version does not support duplicate scanning.')}</div>}
        {node && available && <>
            <form className='StorageAnalysisForm' onSubmit={prepare}>
                <label><span>{zh ? '扫描目录' : 'Scan directory'}</span><input value={path} onChange={event => setPath(event.target.value)} placeholder={windows ? 'C:\\Users\\Public' : '/home/user'} disabled={busy || active} aria-label={zh ? '重复文件扫描目录' : 'Duplicate scan directory'}/></label>
                <label><span>{zh ? '最小文件（MiB）' : 'Minimum file (MiB)'}</span><input type='number' min={1} max={1024 * 1024} step={1} value={minMiB} onChange={event => setMinMiB(Number(event.target.value))} disabled={busy || active} aria-label={zh ? '重复文件最小大小（MiB）' : 'Minimum duplicate file size (MiB)'}/></label>
                {active ? <button type='button' className='danger' disabled={cancelling} onClick={() => void cancel()}>{cancelling ? (zh ? '正在取消…' : 'Cancelling…') : (zh ? '取消扫描' : 'Cancel scan')}</button> : <button ref={startButton} type='submit' disabled={busy || !path.trim()}>{busy ? (zh ? '正在准备…' : 'Preparing…') : (zh ? '查找重复文件' : 'Find duplicates')}</button>}
            </form>
            {(status || error) && <div className={`StorageAnalysisStatus ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'} aria-live='polite'>{error || status}</div>}
            {!result && !active && response?.state !== 'cancelled' && <div className='StorageAnalysisNotice'>{zh ? '按大小、局部哈希和完整 SHA-256 分级确认；硬链接不会计为重复文件。' : 'Confirms by size, partial hash, then full SHA-256; hard links are excluded.'}</div>}
            {result && success && <div className='StorageAnalysisResults'>
                <div className='StorageAnalysisSummary'>
                    <div><strong>{result.summary.group_count}</strong><span>{zh ? '重复组' : 'Duplicate groups'}</span></div>
                    <div><strong>{result.summary.duplicate_file_count}</strong><span>{zh ? '重复文件' : 'Duplicate files'}</span></div>
                    <div><strong>{formatBytes(result.summary.reclaimable_bytes)}</strong><span>{zh ? '可释放空间' : 'Reclaimable'}</span></div>
                    <div><strong>{result.summary.changed_count}</strong><span>{zh ? '扫描中变化' : 'Changed during scan'}</span></div>
                </div>
                <p className='StorageAnalysisMeta'>{zh ? '范围：' : 'Scope: '}{success.roots.join(' · ')} · {new Date(success.completedAt).toLocaleString(zh ? 'zh-CN' : 'en-US')}{result.truncated ? (zh ? ' · 报告已按上限截断' : ' · Report truncated at the limit') : ''}</p>
                <div className='StorageAnalysisTableWrap'><table><thead><tr><th>{zh ? '文件' : 'Files'}</th><th>{zh ? '大小' : 'Size'}</th><th>{zh ? '可释放' : 'Reclaimable'}</th><th>SHA-256</th></tr></thead><tbody>{result.groups.map(group => <tr key={group.sha256}><td data-label={zh ? '文件' : 'Files'}>{group.files.map(file => {
                    const fullPath = storageFullPath(success.roots[file.root_index], file.relative_path);
                    return <button key={`${file.root_index}-${file.relative_path}`} type='button' title={file.relative_path} onClick={() => void copyPath(file.root_index, file.relative_path)}>{copied === fullPath ? (zh ? '已复制' : 'Copied') : file.relative_path}</button>;
                })}{group.truncated ? <small>{zh ? `另有 ${group.file_count - group.files.length} 个文件` : `${group.file_count - group.files.length} more files`}</small> : null}</td><td data-label={zh ? '大小' : 'Size'}>{formatBytes(group.size)}</td><td data-label={zh ? '可释放' : 'Reclaimable'}>{formatBytes(group.reclaimable_bytes)}</td><td data-label='SHA-256' title={group.sha256}>{group.sha256.slice(0, 12)}…</td></tr>)}</tbody></table></div>
                {!result.groups.length && <p className='StorageAnalysisEmpty'>{zh ? '未发现符合条件的重复文件。' : 'No matching duplicate files were found.'}</p>}
            </div>}
        </>}

        <Dialog open={Boolean(pending && visible)} onClose={() => void reject()} aria-labelledby='duplicate-authorization-title'>
            <DialogTitle id='duplicate-authorization-title'>{zh ? '确认只读重复文件扫描' : 'Confirm read-only duplicate scan'}</DialogTitle>
            <DialogContent><dl className='StorageAuthorizationDetails'>
                <div><dt>{zh ? '目标机器' : 'Target machine'}</dt><dd>{node?.name}</dd></div>
                <div><dt>{zh ? '规范化目录' : 'Normalized directory'}</dt><dd>{pending?.authorization.target.roots.map(root => root.path).join(' · ')}</dd></div>
                <div><dt>{zh ? '操作' : 'Operation'}</dt><dd>{zh ? '本地只读哈希与报告' : 'Local read-only hashing and report'}</dd></div>
                <div><dt>{zh ? '最小文件' : 'Minimum file'}</dt><dd>{formatBytes(pending?.authorization.parameters.min_file_bytes || 0)}</dd></div>
                <div><dt>{zh ? '结果上限' : 'Result limit'}</dt><dd>{pending?.authorization.parameters.max_groups}</dd></div>
            </dl></DialogContent>
            <DialogActions><Button onClick={() => void reject()} disabled={busy}>{zh ? '取消' : 'Cancel'}</Button><Button variant='contained' autoFocus onClick={() => void approve()} disabled={busy}>{busy ? (zh ? '正在授权…' : 'Approving…') : (zh ? '授权并扫描' : 'Approve and scan')}</Button></DialogActions>
        </Dialog>
    </section>;
};
