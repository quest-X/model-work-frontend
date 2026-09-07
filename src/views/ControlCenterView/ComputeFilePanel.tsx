import React, {FormEvent, useEffect, useMemo, useState} from 'react';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeFilesystemEntry,
    ComputeFilesystemRequestTarget,
    ComputeFilesystemResult,
} from '../../services/ComputeClusterService';
import {
    canonicalAuthorizationJson,
    getApprovalIdentity,
    signAuthorization,
} from '../../services/ApprovalIdentityService';

type ListResult = Extract<ComputeFilesystemResult, {schema_version: 'filesystem.list-result.v1'}>;

interface IProps {
    nodes: ComputeClusterNode[];
    zh: boolean;
}

const windowsNode = (node?: ComputeClusterNode): boolean =>
    Boolean(node?.resources.platform.toLowerCase().includes('windows'));

export const remoteChildPath = (path: string, name: string, windows: boolean): string => {
    const separator = windows ? '\\' : '/';
    if (!name || name === '.' || name === '..' || (windows ? /[\\/]/.test(name) : name.includes('/')) || name.includes('\0')) {
        throw new Error('Invalid directory name');
    }
    return `${path.replace(windows ? /[\\/]+$/ : /\/+$/, '')}${separator}${name}`;
};

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

const friendlyError = (reason: unknown, zh: boolean): string => {
    const raw = reason instanceof Error ? reason.message : String(reason);
    if (raw.includes('authorization_not_pending') || raw.includes('authorization_expired')) return zh
        ? '本次读取已失效，请重试。'
        : 'This read expired. Try again.';
    if (raw.includes('authorization_user_unknown')) return zh
        ? '当前浏览身份尚未登记到目标机器。'
        : 'The current browsing identity is not registered on this machine.';
    if (raw.includes('permission_denied')) return zh
        ? '节点服务没有访问该目录的权限。'
        : 'The node service cannot access this directory.';
    if (raw.includes('path_not_found')) return zh
        ? '目录不存在或已被移动。'
        : 'The directory does not exist or was moved.';
    if (raw.includes('waiting_for_network')) return zh
        ? '机器当前不可达，请恢复连接后重试。'
        : 'The machine is unreachable. Restore its connection and retry.';
    return raw;
};

// Read-only listings keep a one-use signed scope without interrupting browsing for manual confirmation.
// The branches below are presentation states for one bounded operation.
// eslint-disable-next-line complexity
export const ComputeFilePanel: React.FC<IProps> = ({nodes, zh}) => {
    const [selectedNodeId, setSelectedNodeId] = useState('');
    const [result, setResult] = useState<ListResult>();
    const [history, setHistory] = useState<ListResult[]>([]);
    const [path, setPath] = useState('');
    const [search, setSearch] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState('');
    const node = nodes.find(candidate => candidate.node_id === selectedNodeId);
    const windows = windowsNode(node);
    const available = Boolean(node?.online && node.capabilities.includes('filesystem.list.v1'));
    const entries = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        return (result?.entries || []).filter(entry => !query
            || entry.name.toLocaleLowerCase().includes(query));
    }, [result, search]);

    // eslint-disable-next-line complexity
    const prepare = async (
        target: ComputeFilesystemRequestTarget,
        previous?: ListResult,
        targetNode: ComputeClusterNode | undefined = node,
    ) => {
        if (!targetNode?.online || !targetNode.capabilities.includes('filesystem.list.v1') || busy) return;
        if (target.kind === 'path' && !(windowsNode(targetNode)
            ? /^(?:[a-z]:[\\/]|\\\\[^\\])/i.test(target.path.trim())
            : target.path.trim().startsWith('/'))) {
            setError(zh ? '请输入绝对目录路径。' : 'Enter an absolute directory path.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const identity = getApprovalIdentity();
            const authorization = await ComputeClusterService.createFilesystemAuthorization(targetNode.node_id, {
                operation: 'filesystem.list',
                target: target.kind === 'path' ? {...target, path: target.path.trim()} : target,
                parameters: {limit: 500},
                user: identity.user,
                ttl_seconds: 120,
            });
            if (authorization.target_installation_id !== targetNode.installation_id
                || authorization.operation !== 'filesystem.list'
                || authorization.target.kind !== 'path'
                || authorization.parameters.limit !== 500
                || authorization.user_id !== identity.user.user_id
                || authorization.user_public_key !== identity.user.user_public_key) {
                throw new Error(zh ? '机器返回了不匹配的读取范围。' : 'The machine returned a mismatched read scope.');
            }
            const signature = await signAuthorization(authorization, identity);
            const decision = await ComputeClusterService.approveFilesystemAuthorization(
                authorization.authorization_id,
                signature,
            );
            if (decision.authorization.authorization_id !== authorization.authorization_id
                || decision.result.schema_version !== 'filesystem.list-result.v1'
                || canonicalAuthorizationJson(decision.result.target)
                    !== canonicalAuthorizationJson(authorization.target)) {
                throw new Error(zh ? '机器返回了不匹配的目录结果。' : 'The machine returned a mismatched directory result.');
            }
            if (previous) setHistory(current => [...current, previous]);
            setResult(decision.result);
            setPath(decision.result.target.path);
            setSearch('');
        } catch (reason) {
            setError(friendlyError(reason, zh));
        } finally {
            setBusy(false);
        }
    };

    const submitPath = (event: FormEvent) => {
        event.preventDefault();
        void prepare({kind: 'path', path}, result?.target.path === path.trim() ? undefined : result);
    };

    const openDirectory = (entry: ComputeFilesystemEntry) => {
        if (!result || entry.type !== 'directory') return;
        try {
            void prepare({kind: 'path', path: remoteChildPath(result.target.path, entry.name, windows)}, result);
        } catch (reason) {
            setError(friendlyError(reason, zh));
        }
    };

    const goBack = () => {
        const previous = history[history.length - 1];
        if (!previous || busy) return;
        setHistory(current => current.slice(0, -1));
        setResult(previous);
        setPath(previous.target.path);
        setSearch('');
        setError('');
    };

    const copyPath = async (entry: ComputeFilesystemEntry) => {
        if (!result) return;
        const value = remoteChildPath(result.target.path, entry.name, windows);
        try {
            await navigator.clipboard.writeText(value);
            setCopied(value);
        } catch {
            setError(zh ? '浏览器未允许复制路径。' : 'The browser did not allow copying the path.');
        }
    };

    const selectNode = (nodeId: string) => {
        const selected = nodes.find(candidate => candidate.node_id === nodeId);
        setSelectedNodeId(nodeId);
        setResult(undefined);
        setHistory([]);
        setPath('');
        setSearch('');
        setError('');
        setCopied('');
        if (selected?.online && selected.capabilities.includes('filesystem.list.v1')) {
            void prepare({kind: 'known_folder', id: 'public_desktop'}, undefined, selected);
        }
    };

    useEffect(() => {
        if (selectedNodeId) return;
        const selected = nodes.find(candidate => candidate.online
            && candidate.capabilities.includes('filesystem.list.v1'));
        if (selected) selectNode(selected.node_id);
    }, [nodes, selectedNodeId]);

    return <section className='ComputeFilePanel' aria-label={zh ? '节点文件管理' : 'Node file manager'}>
        <header className='ComputeFileHeading'>
            <div>
                <h3>{zh ? '节点文件管理' : 'Node file manager'}</h3>
                <p>{zh
                    ? '直接浏览文件名、大小和修改时间；不读取或上传文件内容。'
                    : 'Browse names, sizes, and timestamps directly. File contents are never read or uploaded.'}</p>
            </div>
            <span className={!node ? 'unselected' : available ? 'healthy' : 'offline'}>{!node
                ? (zh ? '请选择节点' : 'Choose node')
                : available ? (zh ? '只读 · 正常' : 'Read-only · Normal')
                    : (zh ? '不可用' : 'Unavailable')}</span>
        </header>

        <label className='ComputeFileTarget'>
            <span>{zh ? '目标节点' : 'Target node'}</span>
            <select
                value={selectedNodeId}
                disabled={busy}
                onChange={event => selectNode(event.target.value)}
            >
                <option value=''>{zh ? '选择节点' : 'Choose node'}</option>
                {nodes.map(candidate => <option value={candidate.node_id} key={candidate.node_id}>
                    {`${candidate.name} · ${candidate.resources.platform} · ${candidate.online && candidate.capabilities.includes('filesystem.list.v1')
                        ? (zh ? '正常' : 'Normal')
                        : (zh ? '故障' : 'Fault')}`}
                </option>)}
            </select>
        </label>

        {!node && <div className='ComputeFileNotice'>{zh ? '请先选择目标节点。' : 'Choose a target node first.'}</div>}
        {node && !available && <div className='ComputeFileNotice'>{!node.online
            ? (zh ? '机器当前离线，暂不能浏览文件。' : 'The machine is offline; files cannot be browsed.')
            : (zh ? '当前节点版本暂不支持文件浏览。' : 'This node version does not support file browsing.')}</div>}

        {node && available && <>
            <form className='ComputeFileToolbar' onSubmit={submitPath}>
                <button type='button' onClick={goBack} disabled={!history.length || busy} aria-label={zh ? '返回上一级已浏览目录' : 'Return to the previous browsed directory'}>‹</button>
                <input
                    value={path}
                    onChange={event => setPath(event.target.value)}
                    placeholder={windows ? 'C:\\Users\\Public' : '/home/user'}
                    aria-label={zh ? '绝对目录路径' : 'Absolute directory path'}
                    disabled={busy}
                />
                <button type='submit' disabled={!path.trim() || busy}>{zh ? '转到' : 'Go'}</button>
                <button
                    type='button'
                    disabled={busy}
                    onClick={() => void prepare({kind: 'known_folder', id: 'public_desktop'}, result)}
                >{zh ? '桌面' : 'Desktop'}</button>
                <button
                    type='button'
                    disabled={!result || busy}
                    onClick={() => result && void prepare({kind: 'path', path: result.target.path})}
                >{zh ? '刷新' : 'Refresh'}</button>
            </form>

            {busy && <p className='ComputeFileProgress' role='status'>{zh ? '正在读取目录…' : 'Reading directory…'}</p>}
            {error && <p className='ComputeFileError' role='alert'>{error}</p>}

            {!result && !busy && <div className='ComputeFileNotice'>{zh
                ? '打开桌面，或输入绝对路径开始浏览。'
                : 'Open the desktop or enter an absolute path.'}</div>}

            {result && <>
                <div className='ComputeFileResultHeader'>
                    <span>{zh ? `${result.entries.length} / ${result.total} 项` : `${result.entries.length} / ${result.total} entries`}</span>
                    <input value={search} onChange={event => setSearch(event.target.value)} placeholder={zh ? '筛选当前目录' : 'Filter this directory'} aria-label={zh ? '筛选当前目录' : 'Filter this directory'}/>
                </div>
                <div className='ComputeFileTableWrap'>
                    <table>
                        <thead><tr><th>{zh ? '名称' : 'Name'}</th><th>{zh ? '类型' : 'Type'}</th><th>{zh ? '大小' : 'Size'}</th><th>{zh ? '修改时间' : 'Modified'}</th><th>{zh ? '操作' : 'Action'}</th></tr></thead>
                        <tbody>{entries.map(entry => {
                            const fullPath = remoteChildPath(result.target.path, entry.name, windows);
                            return <tr key={`${entry.type}-${entry.name}`}>
                                <td>{entry.type === 'directory'
                                    ? <button type='button' className='ComputeFileName' title={entry.name} onClick={() => openDirectory(entry)}>▸ {entry.name}</button>
                                    : <span className='ComputeFileName' title={entry.name}>· {entry.name}</span>}</td>
                                <td>{entry.type === 'directory' ? (zh ? '文件夹' : 'Folder') : entry.type}</td>
                                <td>{entry.type === 'directory' ? '—' : formatBytes(entry.size)}</td>
                                <td>{new Date(entry.modified_at * 1000).toLocaleString(zh ? 'zh-CN' : 'en-US')}</td>
                                <td><button type='button' onClick={() => void copyPath(entry)}>{copied === fullPath ? (zh ? '已复制' : 'Copied') : (zh ? '复制路径' : 'Copy path')}</button></td>
                            </tr>;
                        })}</tbody>
                    </table>
                    {entries.length === 0 && <div className='ComputeFileEmpty'>{search
                        ? (zh ? '没有匹配项。' : 'No matching entries.')
                        : (zh ? '此目录为空。' : 'This directory is empty.')}</div>}
                </div>
                {result.truncated && <p className='ComputeFileProgress'>{zh ? '结果已按 500 项上限截断。' : 'Results were truncated at 500 entries.'}</p>}
            </>}
        </>}
    </section>;
};
