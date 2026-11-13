import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ExternalLink, LoaderCircle, Pencil} from 'lucide-react';
import {ComputeClusterNode, ComputeClusterService} from '../../services/ComputeClusterService';
import {getExtensionEngineBaseUrl} from '../../utils/DefaultBackendUrl';
import './RemotePlatformButton.scss';

export const hasRemotePlatformEntry = (node: ComputeClusterNode): boolean =>
    node.role === 'main'
    && node.capabilities.includes('platform.host.v1')
    && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

const panelAddress = (value: string): string => {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || (url.pathname === '/_opensight/open' && url.searchParams.has('ticket'))) {
        throw new Error('Invalid panel address');
    }
    return url.href;
};

const panelLabels = (zh: boolean) => zh ? {
    open: '打开远程平台', connecting: '正在连接远程平台', settings: '远程面板设置',
    url: '远程面板地址', placeholder: '清空并保存可恢复自动地址', loading: '正在获取地址…', unavailable: '地址暂不可用', save: '保存', edit: '修改',
} : {
    open: 'Open remote platform', connecting: 'Connecting to remote platform', settings: 'Remote panel settings',
    url: 'Remote panel URL', placeholder: 'Clear and save to restore automatic addressing',
    loading: 'Getting address…', unavailable: 'Address unavailable', save: 'Save', edit: 'Edit',
};

export const RemotePlatformButton: React.FC<{node: ComputeClusterNode; zh: boolean; hideAddressEditor?: boolean}> = ({node, zh, hideAddressEditor = false}) => {
    const storageKey = `opensight.remote-platform:${getExtensionEngineBaseUrl()}:${node.node_id}`;
    const [customAddress, setCustomAddress] = useState(() => {
        try {
            const saved = window.localStorage.getItem(storageKey);
            return saved ? panelAddress(saved) : '';
        } catch {
            return '';
        }
    });
    const [automaticAddress, setAutomaticAddress] = useState('');
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [loadingAddress, setLoadingAddress] = useState(false);
    const [error, setError] = useState('');
    const preparation = useRef<Promise<string> | null>(null);
    const preparedAt = useRef(0);
    const available = hasRemotePlatformEntry(node);
    const prepare = useCallback((): Promise<string> => {
        // Bootstrap tickets expire after 60 seconds, before the proxy itself expires.
        if (Date.now() - preparedAt.current >= 60 * 1000) preparation.current = null;
        if (!preparation.current) {
            preparedAt.current = Date.now();
            preparation.current = ComputeClusterService.openPlatform(node.node_id).then(({url}) => {
                if (!/^http:\/\/platform-[0-9a-f]{24}\.localhost:\d{1,5}\/_opensight\/open\?ticket=[A-Za-z0-9_-]{43}$/.test(url)
                    || new URL(url).port === '0') throw new Error('Invalid proxy address');
                return url;
            }).catch(cause => { preparation.current = null; throw cause; });
        }
        return preparation.current;
    }, [node.node_id]);
    // shortcut: preparation uses one proxy slot; add reusable previews if frequent reloads exhaust the server limit.
    useEffect(() => {
        if (hideAddressEditor || !available || customAddress || !node.network.ssh_available) {
            setLoadingAddress(false);
            return undefined;
        }
        let active = true;
        setLoadingAddress(true);
        void prepare().then(url => {
            if (active) {
                setAutomaticAddress(`${new URL(url).origin}/`);
                setError('');
            }
        }).catch(cause => {
            if (active) setError(`${zh ? '远程平台连接失败' : 'Remote platform connection failed'}: ${cause instanceof Error ? cause.message : ''}`);
        }).finally(() => { if (active) setLoadingAddress(false); });
        return () => { active = false; };
    }, [available, customAddress, hideAddressEditor, node.network.ssh_available, prepare, zh]);
    if (!available) return null;
    const labels = panelLabels(zh);
    const fixedAddress = hideAddressEditor ? '' : customAddress;
    const address = fixedAddress || automaticAddress;
    const label = busy ? labels.connecting : labels.open;
    const connecting = busy || loadingAddress;
    const disabled = busy || (!fixedAddress && !node.network.ssh_available);
    const save = () => {
        let next = '';
        try {
            next = draft.trim() ? panelAddress(draft) : '';
        } catch {
            setError(zh ? '请输入完整的 HTTP/HTTPS 面板地址，不含账号密码或临时连接票据；清空可恢复自动地址。'
                : 'Enter a full HTTP/HTTPS panel URL without credentials or temporary tickets; clear it to restore automatic addressing.');
            return;
        }
        try {
            if (next) window.localStorage.setItem(storageKey, next);
            else window.localStorage.removeItem(storageKey);
            setCustomAddress(next);
            setAutomaticAddress('');
            setEditing(false);
            setError('');
        } catch {
            setError(zh ? '地址保存失败，请检查浏览器存储权限后重试。'
                : 'Could not save the address. Check browser storage permissions and try again.');
        }
    };
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
            let url = fixedAddress;
            if (!url) {
                url = await prepare();
                preparation.current = null;
                setAutomaticAddress(`${new URL(url).origin}/`);
            }
            if (!tab.closed) tab.location.replace(url);
        } catch (cause) {
            tab.close();
            setError(`${zh ? '远程平台连接失败' : 'Remote platform connection failed'}: ${cause instanceof Error ? cause.message : ''}`);
        } finally {
            setBusy(false);
        }
    };
    return <div className='ControlRemotePlatformPanel'>
        <form className='ControlRemotePlatform' aria-label={labels.settings}
            onSubmit={event => { event.preventDefault(); save(); }}>
        <button type='button' className='ControlRemotePlatformButton'
            aria-label={label} title={label} aria-busy={connecting}
            disabled={disabled}
            onClick={() => void open()}
        >{connecting ? <LoaderCircle size={18} aria-hidden='true'/> : <ExternalLink size={18} aria-hidden='true'/>}</button>
        {!hideAddressEditor && <>
        {editing ? <input type='text' inputMode='url' autoFocus value={draft}
            aria-label={labels.url}
            placeholder={labels.placeholder}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Escape') { setEditing(false); setError(''); } }}/>
            : address ? <a href={address} target='_blank' rel='noopener noreferrer'
                aria-disabled={disabled}
                onClick={event => {
                    event.preventDefault();
                    if (!disabled) void open();
                }}>{address}</a>
                : <span className='ControlRemotePlatformAutomatic'>
                    {loadingAddress ? labels.loading : labels.unavailable}
                </span>}
        {editing ? <button key='save' type='submit' className='ControlRemotePlatformEdit'>{labels.save}</button>
            : <button key='edit' type='button' className='ControlRemotePlatformButton ControlRemotePlatformEditIcon' disabled={busy}
                aria-label={labels.edit} title={labels.edit}
                onClick={() => { setDraft(address); setEditing(true); setError(''); }}>
                <Pencil size={15} aria-hidden='true'/>
            </button>}
        </>}
        </form>
        {error && <span role='alert'>{error}</span>}
    </div>;
};
