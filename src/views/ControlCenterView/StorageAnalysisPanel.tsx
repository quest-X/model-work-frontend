import React, {FormEvent, useEffect, useMemo, useRef, useState} from 'react';
import {Button, Dialog, DialogActions, DialogContent, DialogTitle} from '@mui/material';
import {v4 as uuidv4} from 'uuid';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeStorageAuthorizationResult,
    ComputeStorageRequest,
    ComputeStorageResponse,
    ComputeStorageResult,
} from '../../services/ComputeClusterService';
import {canonicalAuthorizationJson, getApprovalIdentity, signAuthorization} from '../../services/ApprovalIdentityService';
import './StorageAnalysisPanel.scss';

interface IProps {
    node: ComputeClusterNode | null;
    zh: boolean;
    visible: boolean;
}

type ResultView = 'files' | 'directories' | 'categories';
type SuccessfulScan = {result: ComputeStorageResult; roots: string[]; completedAt: number};

const ACTIVE_STATES = new Set(['queued', 'running', 'paused']);
const MIB = 1024 * 1024;

const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KiB', 'MiB', 'GiB', 'TiB'];
    let value = bytes / 1024;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
};

const absolutePath = (path: string, windows: boolean): boolean => windows
    ? /^(?:[a-z]:[\\/]|\\\\[^\\])/i.test(path)
    : path.startsWith('/');

export const storageFullPath = (root: string, relativePath: string): string => {
    const parts = relativePath.split('/');
    if (!relativePath || relativePath.startsWith('/') || parts.some(part => !part || part === '.' || part === '..')) {
        throw new Error('Invalid storage result path');
    }
    const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(root);
    return `${root.replace(windows ? /[\\/]+$/ : /\/+$/, '')}${windows ? '\\' : '/'}${parts.join(windows ? '\\' : '/')}`;
};

// Stable backend codes are intentionally collapsed into a small user-facing vocabulary.
// eslint-disable-next-line complexity
const friendlyError = (reason: unknown, zh: boolean): string => {
    const raw = reason instanceof Error ? reason.message : String(reason);
    if (/authorization_(?:not_pending|expired|rejected)/.test(raw)) return zh
        ? '本次授权已结束，请重新开始扫描。'
        : 'This authorization has ended. Start the scan again.';
    if (raw.includes('authorization_user_unknown')) return zh
        ? '当前授权身份尚未登记到目标机器。'
        : 'The current approval identity is not registered on this machine.';
    if (raw.includes('permission_denied') || raw.includes('root_unavailable')) return zh
        ? '节点无法读取所选目录，请检查路径和服务权限。'
        : 'The node cannot read this directory. Check the path and service permissions.';
    if (raw.includes('target_changed')) return zh
        ? '扫描目录在授权后发生变化，请重新确认。'
        : 'The scan target changed after approval. Confirm it again.';
    if (raw.includes('waiting_for_network')) return zh
        ? '机器当前不可达；后台任务会保留，请恢复连接后再查看。'
        : 'The machine is unreachable. The background task is preserved.';
    if (raw.includes('capability_unavailable')) return zh
        ? '当前节点版本暂不支持存储分析。'
        : 'This node version does not support storage analysis.';
    return zh ? '存储扫描失败，请稍后重试。' : 'Storage scan failed. Try again.';
};

const phaseLabel = (phase: NonNullable<ComputeStorageResponse['progress']>['phase'], zh: boolean): string => ({
    walking: zh ? '正在遍历目录' : 'Walking directories',
    grouping: zh ? '正在汇总目录' : 'Grouping directories',
    hashing: zh ? '正在处理候选项' : 'Processing candidates',
    finalizing: zh ? '正在整理结果' : 'Finalizing results',
}[phase]);

const categoryLabel = (category: ComputeStorageResult['categories'][number]['category'], zh: boolean): string => ({
    model_weight: zh ? '模型权重' : 'Model weights',
    image: zh ? '图片' : 'Images',
    video: zh ? '视频' : 'Videos',
    archive: zh ? '压缩包' : 'Archives',
    log: zh ? '日志' : 'Logs',
    other: zh ? '其他' : 'Other',
}[category]);

const responseMatches = (
    document: ComputeStorageResponse,
    request: Pick<ComputeStorageRequest, 'request_id' | 'node_id'>,
    taskId?: string,
): boolean => document.schema_version === 'agentos.capability-response.v1'
    && document.tool === 'agentos.storage.scan'
    && document.request_id === request.request_id
    && document.node_id === request.node_id
    && (!taskId || document.task_id === taskId);

const resultMatchesRoots = (result: ComputeStorageResult, rootCount: number): boolean => [
    ...result.largest_files,
    ...result.largest_directories,
    ...result.warnings,
].every(item => item.root_index < rootCount);

// eslint-disable-next-line complexity
export const StorageAnalysisPanel: React.FC<IProps> = ({node, zh, visible}) => {
    const [path, setPath] = useState('');
    const [minMiB, setMinMiB] = useState(50);
    const [pending, setPending] = useState<ComputeStorageAuthorizationResult>();
    const [response, setResponse] = useState<ComputeStorageResponse>();
    const [roots, setRoots] = useState<string[]>([]);
    const [success, setSuccess] = useState<SuccessfulScan>();
    const [view, setView] = useState<ResultView>('files');
    const [busy, setBusy] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState('');
    const startButton = useRef<HTMLButtonElement>(null);
    const windows = Boolean(node?.resources.platform.toLowerCase().includes('windows'));
    const available = Boolean(node?.online && node.capabilities.includes('task.storage.scan.v1'));
    const active = Boolean(response && ACTIVE_STATES.has(response.state));

    const currentRequest = useMemo(() => {
        if (!response?.request_id || !response.node_id) return null;
        return {request_id: response.request_id, node_id: response.node_id};
    }, [response?.node_id, response?.request_id]);

    useEffect(() => {
        if (!visible || !active || !response?.task_id || !currentRequest) return undefined;
        const controller = new AbortController();
        let timer = 0;
        const poll = async () => {
            try {
                const next = await ComputeClusterService.storageStatus(
                    currentRequest.node_id,
                    response.task_id as string,
                    controller.signal,
                );
                if (controller.signal.aborted) return;
                if (!responseMatches(next, currentRequest, response.task_id as string)) {
                    throw new Error('storage_response_mismatch');
                }
                setResponse(next);
                setError(next.error ? friendlyError(next.error.code, zh) : '');
                if (next.state === 'succeeded' && next.result) {
                    if (!resultMatchesRoots(next.result, roots.length)) throw new Error('storage_result_mismatch');
                    setSuccess({
                        result: next.result,
                        roots,
                        completedAt: Date.now(),
                    });
                    setView('files');
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

    // Validate the complete signed scope before showing it to the user.
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
            setError(zh ? '大文件阈值须为 1 至 1048576 MiB。' : 'Large-file threshold must be 1–1048576 MiB.');
            return;
        }
        setBusy(true);
        setError('');
        setCancelling(false);
        try {
            const identity = getApprovalIdentity();
            const requestId = uuidv4();
            const request: ComputeStorageRequest = {
                schema_version: 'agentos.capability-request.v1',
                request_id: requestId,
                idempotency_key: requestId,
                tool: 'agentos.storage.scan',
                node_id: node.node_id,
                arguments: {roots: [{kind: 'path', path: root}], min_file_bytes: minMiB * MIB, max_results: 200},
            };
            const created = await ComputeClusterService.createStorageAuthorization({
                request, user: identity.user, ttl_seconds: 120,
            });
            const authorization = created.authorization;
            if (!responseMatches(created.response, request)
                || created.response.state !== 'authorization_required'
                || created.response.authorization?.authorization_id !== authorization.authorization_id
                || authorization.state !== 'pending'
                || authorization.target_installation_id !== node.installation_id
                || authorization.operation !== request.tool
                || authorization.target.kind !== 'storage_roots'
                || authorization.target.request_id !== request.request_id
                || authorization.target.idempotency_key !== request.idempotency_key
                || authorization.target.roots.length !== request.arguments.roots.length
                || canonicalAuthorizationJson(authorization.parameters)
                    !== canonicalAuthorizationJson({min_file_bytes: request.arguments.min_file_bytes, max_results: 200})
                || authorization.user_id !== identity.user.user_id
                || authorization.user_public_key !== identity.user.user_public_key) {
                throw new Error('storage_authorization_mismatch');
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
            const decision = await ComputeClusterService.approveStorageAuthorization(
                authorization.authorization_id,
                signature,
            );
            if (decision.authorization.authorization_id !== authorization.authorization_id
                || !responseMatches(decision.response, {
                    request_id: authorization.target.request_id,
                    node_id: authorization.target_installation_id,
                }, authorization.authorization_id)
                || !ACTIVE_STATES.has(decision.response.state)) {
                throw new Error('storage_decision_mismatch');
            }
            setResponse(decision.response);
            setPending(undefined);
        } catch (reason) {
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
    const status = response?.state === 'cancelled'
        ? (zh ? '扫描已取消，未生成完整结论' : 'Scan cancelled; no complete conclusion')
        : response?.state === 'failed'
            ? friendlyError(response.error?.code, zh)
            : response?.progress
                ? `${phaseLabel(response.progress.phase, zh)} · ${response.progress.files_scanned} ${zh ? '个文件' : 'files'} · ${formatBytes(response.progress.bytes_scanned)}`
                : active ? (zh ? '任务已排队' : 'Task queued') : '';

    return <section className='StorageAnalysisPanel' aria-label={zh ? '存储分析' : 'Storage analysis'}>
        <header className='StorageAnalysisHeading'>
            <div>
                <h3>{zh ? '存储分析' : 'Storage analysis'}</h3>
                <p>{zh ? '只读取文件元数据，不读取或上传文件内容。' : 'Reads file metadata only; file contents are never read or uploaded.'}</p>
            </div>
            <span className={!node ? 'unselected' : available ? 'healthy' : 'offline'}>{!node
                ? (zh ? '请选择机器' : 'Choose machine')
                : available ? (zh ? '只读 · 正常' : 'Read-only · Normal')
                    : (zh ? '不可用' : 'Unavailable')}</span>
        </header>

        {!node && <div className='StorageAnalysisNotice'>{zh ? '请先从机器列表选择目标机器。' : 'Choose a target machine from the machine list.'}</div>}
        {node && !available && <div className='StorageAnalysisNotice'>{!node.online
            ? (zh ? '机器当前离线，暂不能开始新扫描。' : 'The machine is offline; a new scan cannot start.')
            : (zh ? '当前节点版本暂不支持存储分析。' : 'This node version does not support storage analysis.')}</div>}

        {node && available && <>
            <form className='StorageAnalysisForm' onSubmit={prepare}>
                <label>
                    <span>{zh ? '扫描目录' : 'Scan directory'}</span>
                    <input
                        value={path}
                        onChange={event => setPath(event.target.value)}
                        placeholder={windows ? 'C:\\Users\\Public' : '/home/user'}
                        disabled={busy || active}
                        aria-label={zh ? '扫描目录' : 'Scan directory'}
                    />
                </label>
                <label>
                    <span>{zh ? '大文件阈值（MiB）' : 'Large-file threshold (MiB)'}</span>
                    <input
                        type='number'
                        min={1}
                        max={1024 * 1024}
                        step={1}
                        value={minMiB}
                        onChange={event => setMinMiB(Number(event.target.value))}
                        disabled={busy || active}
                        aria-label={zh ? '大文件阈值（MiB）' : 'Large-file threshold (MiB)'}
                    />
                </label>
                {active
                    ? <button type='button' className='danger' disabled={cancelling} onClick={() => void cancel()}>
                        {cancelling ? (zh ? '正在取消…' : 'Cancelling…') : (zh ? '取消扫描' : 'Cancel scan')}
                    </button>
                    : <button ref={startButton} type='submit' disabled={busy || !path.trim()}>
                        {busy ? (zh ? '正在准备…' : 'Preparing…') : (zh ? '开始扫描' : 'Start scan')}
                    </button>}
            </form>

            {(status || error) && <div className={`StorageAnalysisStatus ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'} aria-live='polite'>
                {error || status}
                {response?.progress && <small>{zh
                    ? `${response.progress.roots_completed} / ${response.progress.roots_total} 个目录根已完成`
                    : `${response.progress.roots_completed} / ${response.progress.roots_total} roots completed`}</small>}
            </div>}

            {!result && !active && response?.state !== 'cancelled' && <div className='StorageAnalysisNotice'>{zh
                ? '输入绝对目录路径后开始。每次扫描都需确认一次只读授权。'
                : 'Enter an absolute directory path. Every scan requires one read-only approval.'}</div>}

            {result && success && <div className='StorageAnalysisResults'>
                <div className='StorageAnalysisSummary'>
                    <div><strong>{formatBytes(result.summary.total_bytes)}</strong><span>{zh ? '扫描文件总量' : 'File bytes scanned'}</span></div>
                    <div><strong>{result.summary.file_count}</strong><span>{zh ? '文件' : 'Files'}</span></div>
                    <div><strong>{result.summary.large_file_count}</strong><span>{zh ? '大文件' : 'Large files'}</span></div>
                    <div><strong>{result.summary.inaccessible_count}</strong><span>{zh ? '不可访问项' : 'Inaccessible'}</span></div>
                </div>
                <p className='StorageAnalysisMeta'>{zh ? '范围：' : 'Scope: '}{success.roots.join(' · ')} · {new Date(success.completedAt).toLocaleString(zh ? 'zh-CN' : 'en-US')}
                    {result.truncated ? (zh ? ' · 结果已按上限截断' : ' · Results truncated at the limit') : ''}</p>
                <div className='StorageAnalysisTabs' role='tablist' aria-label={zh ? '存储分析结果' : 'Storage analysis results'}>
                    {(['files', 'directories', 'categories'] as ResultView[]).map(item => <button
                        type='button'
                        role='tab'
                        aria-selected={view === item}
                        key={item}
                        onClick={() => setView(item)}
                    >{{files: zh ? '大文件' : 'Large files', directories: zh ? '最大目录' : 'Largest directories', categories: zh ? '类型分布' : 'Type distribution'}[item]}</button>)}
                </div>
                <div className='StorageAnalysisTableWrap'>
                    {view === 'files' && <table><thead><tr><th>{zh ? '名称' : 'Name'}</th><th>{zh ? '相对位置' : 'Relative location'}</th><th>{zh ? '大小' : 'Size'}</th><th>{zh ? '修改时间' : 'Modified'}</th><th>{zh ? '操作' : 'Action'}</th></tr></thead>
                        <tbody>{result.largest_files.map(file => {
                            const fullPath = storageFullPath(success.roots[file.root_index], file.relative_path);
                            const name = file.relative_path.split('/').pop();
                            return <tr key={`${file.root_index}-${file.relative_path}`}><td data-label={zh ? '名称' : 'Name'}>{name}</td><td data-label={zh ? '相对位置' : 'Relative location'} title={file.relative_path}>{file.relative_path}</td><td data-label={zh ? '大小' : 'Size'}>{formatBytes(file.size)}</td><td data-label={zh ? '修改时间' : 'Modified'}>{new Date(file.modified_at * 1000).toLocaleString(zh ? 'zh-CN' : 'en-US')}</td><td data-label={zh ? '操作' : 'Action'}><button type='button' onClick={() => void copyPath(file.root_index, file.relative_path)}>{copied === fullPath ? (zh ? '已复制' : 'Copied') : (zh ? '复制路径' : 'Copy path')}</button></td></tr>;
                        })}</tbody></table>}
                    {view === 'directories' && <table><thead><tr><th>{zh ? '目录' : 'Directory'}</th><th>{zh ? '相对位置' : 'Relative location'}</th><th>{zh ? '大小' : 'Size'}</th><th>{zh ? '识别' : 'Classification'}</th><th>{zh ? '操作' : 'Action'}</th></tr></thead>
                        <tbody>{result.largest_directories.map(directory => <tr key={`${directory.root_index}-${directory.relative_path}`}><td data-label={zh ? '目录' : 'Directory'}>{directory.relative_path.split('/').pop()}</td><td data-label={zh ? '相对位置' : 'Relative location'} title={directory.relative_path}>{directory.relative_path}</td><td data-label={zh ? '大小' : 'Size'}>{formatBytes(directory.size)}</td><td data-label={zh ? '识别' : 'Classification'}>{directory.classification === 'dataset_candidate' ? (zh ? '数据集候选' : 'Dataset candidate') : directory.classification === 'cache_candidate' ? (zh ? '缓存候选' : 'Cache candidate') : '—'}</td><td data-label={zh ? '操作' : 'Action'}><button type='button' onClick={() => void copyPath(directory.root_index, directory.relative_path)}>{zh ? '复制路径' : 'Copy path'}</button></td></tr>)}</tbody></table>}
                    {view === 'categories' && <table><thead><tr><th>{zh ? '类型' : 'Type'}</th><th>{zh ? '文件数' : 'Files'}</th><th>{zh ? '总大小' : 'Total size'}</th></tr></thead>
                        <tbody>{result.categories.map(category => <tr key={category.category}><td data-label={zh ? '类型' : 'Type'}>{categoryLabel(category.category, zh)}</td><td data-label={zh ? '文件数' : 'Files'}>{category.file_count}</td><td data-label={zh ? '总大小' : 'Total size'}>{formatBytes(category.total_bytes)}</td></tr>)}</tbody></table>}
                </div>
                {((view === 'files' && !result.largest_files.length) || (view === 'directories' && !result.largest_directories.length)) && <p className='StorageAnalysisEmpty'>{zh ? '没有符合当前条件的项目。' : 'No items match the current conditions.'}</p>}
            </div>}
        </>}

        <Dialog open={Boolean(pending && visible)} onClose={() => void reject()} aria-labelledby='storage-authorization-title'>
            <DialogTitle id='storage-authorization-title'>{zh ? '确认只读存储扫描' : 'Confirm read-only storage scan'}</DialogTitle>
            <DialogContent>
                <dl className='StorageAuthorizationDetails'>
                    <div><dt>{zh ? '目标机器' : 'Target machine'}</dt><dd>{node?.name}</dd></div>
                    <div><dt>{zh ? '规范化目录' : 'Normalized directory'}</dt><dd>{pending?.authorization.target.roots.map(root => root.path).join(' · ')}</dd></div>
                    <div><dt>{zh ? '操作' : 'Operation'}</dt><dd>{zh ? '只读元数据扫描' : 'Read-only metadata scan'}</dd></div>
                    <div><dt>{zh ? '大文件阈值' : 'Large-file threshold'}</dt><dd>{formatBytes(pending?.authorization.parameters.min_file_bytes || 0)}</dd></div>
                    <div><dt>{zh ? '结果上限' : 'Result limit'}</dt><dd>{pending?.authorization.parameters.max_results}</dd></div>
                    <div><dt>{zh ? '授权失效时间' : 'Approval expires'}</dt><dd>{pending ? new Date(pending.authorization.expires_at * 1000).toLocaleTimeString(zh ? 'zh-CN' : 'en-US') : ''}</dd></div>
                </dl>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => void reject()} disabled={busy}>{zh ? '取消' : 'Cancel'}</Button>
                <Button variant='contained' autoFocus onClick={() => void approve()} disabled={busy}>{busy ? (zh ? '正在授权…' : 'Approving…') : (zh ? '授权并扫描' : 'Approve and scan')}</Button>
            </DialogActions>
        </Dialog>
    </section>;
};
