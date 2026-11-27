import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
    ComputeClusterService,
    ComputeTerminalSession,
    ComputeTerminalTarget,
    ComputeTerminalTransport,
    isComputeAccessDenied,
} from '../../../services/ComputeClusterService';


interface ComputeTerminalPanelProps {
    zh: boolean;
    preferredNodeId?: string;
    preferredTransport?: ComputeTerminalTransport;
    autoConnect?: boolean;
    targetLabel?: string;
    initialCommand?: string;
    closeOnUnmount?: boolean;
    focusKey?: boolean;
    onActiveChange?: (active: boolean) => void;
}

type TargetReadState = 'loading' | 'ready' | 'disabled' | 'denied' | 'failed';

const transportLabel = (transport: ComputeTerminalTransport, zh: boolean): string => {
    if (transport === 'lan') return zh ? '局域网 SSH' : 'LAN SSH';
    return transport === 'tailcat' ? 'Tailcat' : 'Tailscale';
};

const targetReason = (target: ComputeTerminalTarget, zh: boolean): string => {
    if (target.available) return target.online
        ? (zh ? '可连接' : 'Available')
        : (zh ? '节点离线，SSH 可达' : 'Node offline, SSH reachable');
    return target.reason === 'node_offline'
        ? (zh ? '节点离线' : 'Node offline')
        : (zh ? 'SSH 不可用' : 'SSH unavailable');
};

const sessionStateLabel = (state: ComputeTerminalSession['state'], zh: boolean): string => ({
    connecting: zh ? '连接中' : 'Connecting',
    running: zh ? '已连接' : 'Connected',
    closed: zh ? '已断开' : 'Disconnected',
    failed: zh ? '连接失败' : 'Connection failed',
})[state];

const sessionErrorMessage = (reason: unknown, zh: boolean): string => isComputeAccessDenied(reason)
    ? (zh ? '当前账号无权访问此终端会话。' : 'You do not have access to this terminal session.')
    : reason instanceof Error ? reason.message : String(reason);

// The terminal surface intentionally owns one bounded connection lifecycle.
// eslint-disable-next-line complexity
export const ComputeTerminalPanel: React.FC<ComputeTerminalPanelProps> = ({
    zh,
    preferredNodeId,
    preferredTransport,
    autoConnect = false,
    targetLabel,
    initialCommand,
    closeOnUnmount = false,
    focusKey = false,
    onActiveChange,
}) => {
    const [targets, setTargets] = useState<ComputeTerminalTarget[]>([]);
    const [targetRead, setTargetRead] = useState<TargetReadState>('loading');
    const [selectedNode, setSelectedNode] = useState(preferredNodeId || '');
    const [session, setSession] = useState<ComputeTerminalSession | null>(null);
    const [busy, setBusy] = useState(false);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState('');
    const [sessionReadError, setSessionReadError] = useState<{message: string; denied: boolean}>();
    const [restoreError, setRestoreError] = useState('');
    const [restoreAttempt, setRestoreAttempt] = useState(0);
    const [sessionConflict, setSessionConflict] = useState<{sessionId: string; transport: ComputeTerminalTransport}>();
    const [viewSessionId, setViewSessionId] = useState('');
    const cursorRef = useRef(0);
    const sessionIdRef = useRef('');
    const outputRef = useRef<HTMLDivElement | null>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const zhRef = useRef(zh);
    const inputQueueRef = useRef<Promise<unknown>>(Promise.resolve());
    const inputSessionRef = useRef<ComputeTerminalSession | null>(null);
    const deniedRef = useRef(false);
    const rawModeRef = useRef(false);
    const autoConnectStartedRef = useRef(false);
    const startedHereRef = useRef(false);
    const initialCommandSessionRef = useRef('');
    const active = Boolean(session && ['connecting', 'running'].includes(session.state));
    const selectedTarget = targets.find(target => target.node_id === selectedNode);
    const tailcatUnavailable = preferredTransport === 'tailcat' && selectedTarget?.tailcat_available !== true;
    const restorableSessionId = selectedNode === preferredNodeId ? selectedTarget?.active_session_id : null;
    const sessionReadDenied = sessionReadError?.denied === true;
    zhRef.current = zh;
    inputSessionRef.current = session;
    deniedRef.current = sessionReadDenied;
    const canConnect = targetRead === 'ready' && Boolean(selectedTarget?.available) && !tailcatUnavailable
        && (!restorableSessionId || restorableSessionId === session?.session_id)
        && !active && !busy;

    useEffect(() => {
        const container = outputRef.current;
        if (!container) return undefined;
        const terminal = new Terminal({
            cursorBlink: true, scrollback: 3000, fontSize: 11,
            fontFamily: "SFMono-Regular, Consolas, 'Liberation Mono', monospace",
            theme: {background: '#090d0c', foreground: '#b7edca', cursor: '#b7edca'},
        });
        const fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(container);
        terminalRef.current = terminal;
        terminal.writeln(zh ? '选择节点并连接终端。' : 'Choose a node and connect.');
        const fitTerminal = () => {
            if (container.clientWidth && container.clientHeight) fit.fit();
        };
        fitTerminal();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fitTerminal);
        observer?.observe(container);
        const dataSubscription = terminal.onData(data => {
            const current = inputSessionRef.current;
            if (!current || current.state !== 'running' || deniedRef.current) return;
            const sessionId = current.session_id;
            inputQueueRef.current = inputQueueRef.current.then(async () => {
                if (sessionIdRef.current !== sessionId) return undefined;
                const characters = Array.from(data);
                for (let offset = 0; offset < characters.length; offset += 8192) {
                    if (sessionIdRef.current !== sessionId) break;
                    await ComputeClusterService.terminalInput(sessionId, characters.slice(offset, offset + 8192).join(''));
                }
                return undefined;
            }).catch(reason => setError(sessionErrorMessage(reason, zhRef.current)));
        });
        const resizeSubscription = terminal.onResize(({rows, cols}) => {
            const current = inputSessionRef.current;
            if (current?.state === 'running' && rawModeRef.current) {
                void ComputeClusterService.terminalResize(current.session_id, rows, cols)
                    .catch(reason => setError(sessionErrorMessage(reason, zhRef.current)));
            }
        });
        return () => {
            observer?.disconnect();
            dataSubscription.dispose();
            resizeSubscription.dispose();
            terminal.dispose();
            terminalRef.current = null;
        };
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        let reading = false;
        const refreshTargets = async () => {
            if (reading) return;
            reading = true;
            try {
                const response = await ComputeClusterService.terminalTargets(controller.signal);
                if (controller.signal.aborted) return;
                setTargets(response.enabled ? response.targets : []);
                setTargetRead(response.enabled ? 'ready' : 'disabled');
            } catch (reason) {
                if (controller.signal.aborted) return;
                setTargets([]);
                setTargetRead(isComputeAccessDenied(reason) ? 'denied' : 'failed');
            } finally {
                reading = false;
            }
        };
        void refreshTargets();
        const timer = window.setInterval(() => void refreshTargets(), 5000);
        return () => {
            controller.abort();
            window.clearInterval(timer);
        };
    }, []);

    useEffect(() => {
        if (!restorableSessionId || sessionIdRef.current || restorableSessionId === session?.session_id || busy) return undefined;
        const controller = new AbortController();
        setRestoreError('');
        setSessionConflict(undefined);
        void ComputeClusterService.terminal(restorableSessionId, 0, controller.signal).then(restored => {
            if (controller.signal.aborted) return;
            if (restored.session_id !== restorableSessionId || restored.node_id !== selectedNode) {
                throw new Error(zh ? '返回的会话与所选节点不一致。' : 'The returned session does not match the selected node.');
            }
            if (preferredTransport && restored.transport !== preferredTransport && restored.session_id !== viewSessionId) {
                const route = restored.transport ? transportLabel(restored.transport, zh) : (zh ? '未知路线' : 'unknown route');
                if (restored.transport) setSessionConflict({sessionId: restored.session_id, transport: restored.transport});
                setRestoreError(zh
                    ? `该节点已有 ${route} 会话。查看后可断开，再使用 ${transportLabel(preferredTransport, zh)} 连接。`
                    : `This node already has a session on ${route}. View it, then disconnect before connecting via ${transportLabel(preferredTransport, zh)}.`);
                return;
            }
            sessionIdRef.current = ['connecting', 'running'].includes(restored.state) ? restored.session_id : '';
            cursorRef.current = 0;
            rawModeRef.current = false;
            startedHereRef.current = false;
            terminalRef.current?.reset();
            setSession(restored);
        }).catch(reason => {
            if (!controller.signal.aborted) setRestoreError(sessionErrorMessage(reason, zh));
        });
        return () => controller.abort();
    }, [busy, preferredTransport, restorableSessionId, restoreAttempt, selectedNode, session?.session_id, viewSessionId, zh]);

    useEffect(() => {
        if (!session || !['connecting', 'running'].includes(session.state)) return undefined;
        const controller = new AbortController();
        let reading = false;
        // eslint-disable-next-line complexity
        const poll = async () => {
            if (reading) return;
            reading = true;
            try {
                const next = await ComputeClusterService.terminal(
                    session.session_id,
                    cursorRef.current,
                    controller.signal,
                    true,
                );
                if (controller.signal.aborted || sessionIdRef.current !== session.session_id) return;
                if (next.session_id !== session.session_id || next.node_id !== session.node_id
                    || next.transport !== session.transport) {
                    setSessionReadError({
                        message: zh ? '返回的会话与所选节点或路线不一致。' : 'The returned session does not match the selected node or route.',
                        denied: true,
                    });
                    return;
                }
                cursorRef.current = next.cursor;
                if (next.ansi && !rawModeRef.current) {
                    rawModeRef.current = true;
                    void ComputeClusterService.terminalResize(
                        session.session_id, terminalRef.current?.rows || 24, terminalRef.current?.cols || 80,
                    ).catch(reason => setError(sessionErrorMessage(reason, zh)));
                }
                if (next.output_truncated) terminalRef.current?.reset();
                if (next.output) terminalRef.current?.write(next.output);
                setSession(next);
                if (!['connecting', 'running'].includes(next.state)) sessionIdRef.current = '';
                setError(next.error || '');
                setSessionReadError(undefined);
            } catch (reason) {
                if (!controller.signal.aborted && sessionIdRef.current === session.session_id) {
                    if (isComputeAccessDenied(reason)) {
                        cursorRef.current = 0;
                        terminalRef.current?.reset();
                    }
                    setSessionReadError({
                        message: sessionErrorMessage(reason, zh), denied: isComputeAccessDenied(reason),
                    });
                }
            } finally {
                reading = false;
            }
        };
        const timer = window.setInterval(() => void poll(), 500);
        void poll();
        return () => {
            controller.abort();
            window.clearInterval(timer);
        };
    }, [session?.session_id, session?.state, session?.transport, zh]);

    useEffect(() => {
        if (session?.state === 'running' && !busy && !sessionReadDenied) {
            terminalRef.current?.focus();
        }
    }, [busy, focusKey, session?.session_id, session?.state, sessionReadDenied, zh]);

    useEffect(() => {
        onActiveChange?.(active);
    }, [active, onActiveChange]);

    useEffect(() => () => {
        if (closeOnUnmount && sessionIdRef.current) {
            void ComputeClusterService.terminalControl(sessionIdRef.current, 'close');
        }
    }, [closeOnUnmount]);

    const connect = useCallback(async () => {
        if (!canConnect) return;
        setBusy(true);
        setStarting(true);
        setError('');
        setSessionReadError(undefined);
        setRestoreError('');
        setSessionConflict(undefined);
        setViewSessionId('');
        setSession(null);
        try {
            const next = preferredTransport
                ? await ComputeClusterService.startTerminal(selectedNode, preferredTransport)
                : await ComputeClusterService.startTerminal(selectedNode);
            if (next.node_id !== selectedNode || (preferredTransport && next.transport !== preferredTransport)) {
                throw new Error(zh ? '返回的会话与所选节点或路线不一致。' : 'The returned session does not match the selected node or route.');
            }
            cursorRef.current = 0;
            rawModeRef.current = false;
            sessionIdRef.current = ['connecting', 'running'].includes(next.state) ? next.session_id : '';
            startedHereRef.current = true;
            terminalRef.current?.reset();
            setSession(next);
            if (initialCommand && next.state === 'running') {
                initialCommandSessionRef.current = next.session_id;
                await ComputeClusterService.terminalInput(next.session_id, `${initialCommand}\r`);
            }
        } catch (reason) {
            setError(sessionErrorMessage(reason, zh));
        } finally {
            setStarting(false);
            setBusy(false);
        }
    }, [canConnect, initialCommand, preferredTransport, selectedNode, zh]);

    useEffect(() => {
        if (!autoConnect || autoConnectStartedRef.current || !canConnect || selectedNode !== preferredNodeId || session) return;
        autoConnectStartedRef.current = true;
        void connect();
    }, [autoConnect, canConnect, connect, preferredNodeId, selectedNode, session]);

    useEffect(() => {
        if (
            !initialCommand
            || !startedHereRef.current
            || session?.state !== 'running'
            || initialCommandSessionRef.current === session.session_id
        ) return;
        initialCommandSessionRef.current = session.session_id;
        void ComputeClusterService.terminalInput(session.session_id, `${initialCommand}\r`)
            .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
    }, [initialCommand, session?.session_id, session?.state]);

    const control = useCallback(async (action: 'interrupt' | 'close') => {
        if (!session || busy) return;
        setBusy(true);
        try {
            const next = await ComputeClusterService.terminalControl(session.session_id, action);
            setSession(next);
            if (action === 'close') sessionIdRef.current = '';
            setSessionReadError(undefined);
            setError('');
        } catch (reason) {
            setError(sessionErrorMessage(reason, zh));
        } finally {
            setBusy(false);
        }
    }, [busy, session, zh]);

    const selectNode = (nodeId: string) => {
        setSelectedNode(nodeId);
        setSession(null);
        terminalRef.current?.reset();
        cursorRef.current = 0;
        rawModeRef.current = false;
        setError('');
        setSessionReadError(undefined);
        setRestoreError('');
        setSessionConflict(undefined);
        setViewSessionId('');
    };

    const targetNotices = {
        loading: zh ? '正在读取终端目标…' : 'Loading terminal targets…',
        ready: zh ? '当前没有可查询的终端目标。' : 'No terminal targets are listed.',
        disabled: zh ? '当前服务未启用终端连接。' : 'Terminal connections are disabled on this service.',
        denied: zh ? '当前账号无权查看终端目标。' : 'You do not have access to terminal targets.',
        failed: zh ? '终端目标读取失败，稍后自动重试。' : 'Could not read terminal targets. Retrying shortly.',
    };
    const restorePending = Boolean(restorableSessionId && !session && !restoreError && !busy);
    const restoreFailed = Boolean(restoreError && restorableSessionId);
    const sessionState = session?.state || (starting || restorePending ? 'connecting' : error || restoreFailed ? 'failed' : undefined);
    const route = session?.transport || preferredTransport;
    const stateTone = sessionReadError ? 'failed' : sessionConflict ? 'available' : sessionState || (selectedTarget?.available ? 'available' : '');
    const stateLabel = sessionReadError ? (zh ? '会话读取异常' : 'Session read error')
        : sessionConflict ? (zh ? '已有其他路线会话' : 'Session on another route')
        : targetRead === 'ready' && selectedTarget && tailcatUnavailable ? (zh ? '暂不可连接' : 'Unavailable')
        : sessionState ? sessionStateLabel(sessionState, zh) : selectedTarget
            ? targetReason(selectedTarget, zh) : (zh ? '等待目标' : 'Waiting for target');

    return <section className='ComputeTerminalPanel'>
        <div className='ComputeTerminalHeading'>
            <div>
                <h3>{targetLabel
                    ? `${targetLabel} · ${zh ? '终端' : 'Terminal'}`
                    : (zh ? '节点终端连接' : 'Node terminal connection')}</h3>
                <p>{targetLabel
                    ? (zh
                        ? '先连接所属节点，再进入这台局域网设备；密码只在当前终端输入，不会保存。'
                        : 'Connect through the owning node, then enter this LAN device. Password input is never saved.')
                    : (zh
                        ? '点击终端直接输入命令；可使用目标节点已安装的程序。'
                        : 'Click the terminal to type commands and use programs installed on the target node.')}</p>
            </div>
            {(selectedTarget || sessionState || preferredTransport) && <div role='status'
                className={`ComputeTerminalState ${stateTone} ${route === 'lan' ? 'lan' : route ? 'remote' : ''}`}>
                <i/><strong>{route ? `${transportLabel(route, zh)} · ${stateLabel}` : stateLabel}</strong>
            </div>}
        </div>

        <div className='ComputeTerminalToolbar'>
            <label>
                <span>{targetLabel ? (zh ? '目标设备' : 'Target device') : (zh ? '目标节点' : 'Target node')}</span>
                <select value={selectedNode} disabled={active || busy || targetRead !== 'ready'}
                    onChange={event => selectNode(event.target.value)}>
                    <option value=''>{zh ? '选择节点' : 'Choose node'}</option>
                    {selectedNode && !selectedTarget && <option value={selectedNode} disabled>
                        {selectedNode} · {zh ? '目标未列出' : 'Target not listed'}
                    </option>}
                    {targets.map(target => <option value={target.node_id} key={target.node_id} disabled={!target.available}>
                        {targetLabel && target.node_id === selectedNode
                            ? `${targetLabel} · ${target.node_name}`
                            : `${target.node_name} · ${target.platform} · ${targetReason(target, zh)}`}
                    </option>)}
                </select>
            </label>
            {!active && <button type='button' disabled={!canConnect} onClick={() => void connect()}>{zh ? '连接终端' : 'Connect'}</button>}
            {active && <>
                <button type='button' disabled={busy || sessionReadDenied || session?.state !== 'running'} onClick={() => void control('interrupt')}>Ctrl+C</button>
                <button type='button' className='danger' disabled={busy} onClick={() => void control('close')}>{zh ? '断开' : 'Disconnect'}</button>
            </>}
        </div>

        {(targetRead !== 'ready' || !targets.length) && <div
            className={targetRead === 'denied' || targetRead === 'failed' ? 'ComputeTerminalError' : 'ComputeTerminalNotice'}
            role={targetRead === 'denied' || targetRead === 'failed' ? 'alert' : 'status'}>{targetNotices[targetRead]}</div>}
        {targetRead === 'ready' && targets.length > 0 && selectedNode && !selectedTarget && <div className='ComputeTerminalNotice' role='status'>
            {zh ? '所选节点当前未出现在终端目标列表中。' : 'The selected node is missing from the terminal target list.'}
        </div>}
        {targetRead === 'ready' && selectedTarget && tailcatUnavailable && <div className='ComputeTerminalNotice' role='status'>
            {zh ? '当前主控未提供此节点的 Tailcat 终端。' : 'The controller does not currently offer a Tailcat terminal for this node.'}
        </div>}
        {restoreFailed && <div className={sessionConflict ? 'ComputeTerminalNotice' : 'ComputeTerminalError'} role={sessionConflict ? 'status' : 'alert'}>
            {restoreError} {sessionConflict && <button type='button' onClick={() => setViewSessionId(sessionConflict.sessionId)}>
                {zh ? `查看现有 ${transportLabel(sessionConflict.transport, zh)} 会话` : `View existing ${transportLabel(sessionConflict.transport, zh)} session`}
            </button>} <button type='button' onClick={() => setRestoreAttempt(attempt => attempt + 1)}>{zh ? '重试读取会话' : 'Retry session read'}</button>
        </div>}
        {(error || session?.error) && <div className='ComputeTerminalError' role='alert'>{error || session?.error}</div>}
        {sessionReadError && <div className='ComputeTerminalError' role='alert'>
            {zh ? '会话读取' : 'Session read'} · {sessionReadError.message}
        </div>}
        <div className='ComputeTerminalScreen' ref={outputRef} aria-label={zh ? '终端输出' : 'Terminal output'}
            onClick={() => terminalRef.current?.focus()}/>
        <small className='ComputeTerminalBoundary'>{zh
            ? `${targetLabel ? '关闭窗口会断开这次设备终端；' : ''}每个节点限开 1 个终端；空闲 30 分钟或使用满 2 小时后自动断开。`
            : `${targetLabel ? 'Closing this window disconnects the device terminal. ' : ''}One terminal per node; it disconnects after 30 idle minutes or 2 hours of use.`}</small>
    </section>;
};
