import React, {useState} from 'react';
import {ExternalLink, LoaderCircle} from 'lucide-react';
import {ComputeClusterNode, ComputeClusterService} from '../../services/ComputeClusterService';

export const hasRemotePlatformEntry = (node: ComputeClusterNode): boolean =>
    node.role === 'main'
    && node.capabilities.includes('platform.host.v1')
    && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

export const RemotePlatformButton: React.FC<{node: ComputeClusterNode; zh: boolean}> = ({node, zh}) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    if (!hasRemotePlatformEntry(node)) return null;
    const label = busy ? (zh ? '正在连接远程平台' : 'Connecting to remote platform')
        : (zh ? '打开远程平台' : 'Open remote platform');
    const open = async () => {
        // Open synchronously so browsers do not block the tab after SSH setup.
        const tab = window.open('about:blank', '_blank');
        if (!tab) {
            setError(zh ? '请允许打开新标签页后重试' : 'Allow pop-ups and try again');
            return;
        }
        tab.opener = null;
        setBusy(true);
        setError('');
        try {
            const {url} = await ComputeClusterService.openPlatform(node.node_id);
            if (!/^http:\/\/platform-[0-9a-f]{24}\.localhost:\d{1,5}\/_opensight\/open\?ticket=[A-Za-z0-9_-]{43}$/.test(url)) {
                throw new Error(zh ? '代理地址无效' : 'Invalid proxy address');
            }
            if (!tab.closed) tab.location.replace(url);
        } catch (cause) {
            tab.close();
            setError(`${zh ? '远程平台连接失败' : 'Remote platform connection failed'}: ${cause instanceof Error ? cause.message : ''}`);
        } finally {
            setBusy(false);
        }
    };
    return <span className='ControlRemotePlatform'>
        <button type='button' className='ControlRemotePlatformButton'
            aria-label={label} title={label} aria-busy={busy}
            disabled={busy || !node.network.ssh_available}
            onClick={() => void open()}
        >{busy ? <LoaderCircle size={18} aria-hidden='true'/> : <ExternalLink size={18} aria-hidden='true'/>}</button>
        {error && <span role='alert'>{error}</span>}
    </span>;
};
