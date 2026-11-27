import React, {useEffect, useState} from 'react';
import {ACCOUNT_SESSION_CHANGED} from '../../services/AccountService';
import {ComputeClusterNode, ComputeClusterService, ComputeSecurityBaseline, isComputeAccessDenied} from '../../services/ComputeClusterService';

const names: Record<ComputeSecurityBaseline['checks'][number]['check_id'], [string, string]> = {
    firewall_domain: ['Windows 防火墙 · 域', 'Windows Firewall · Domain'],
    firewall_private: ['Windows 防火墙 · 专用', 'Windows Firewall · Private'],
    firewall_public: ['Windows 防火墙 · 公用', 'Windows Firewall · Public'],
    defender_realtime: ['Microsoft Defender 实时保护', 'Microsoft Defender real-time protection'],
    bitlocker_system: ['BitLocker 系统盘保护', 'BitLocker protection on the system drive'],
    application_firewall: ['macOS 应用防火墙', 'macOS application firewall'],
    filevault: ['FileVault 启动卷保护', 'FileVault protection on the startup volume'],
    ufw_service: ['UFW 服务', 'UFW service'],
    firewalld_service: ['firewalld 服务', 'firewalld service'],
    nftables_service: ['nftables 服务', 'nftables service'],
};
const evidence: Record<ComputeSecurityBaseline['checks'][number]['evidence'], [string, string]> = {
    enabled: ['已启用', 'Enabled'],
    disabled: ['需检查 · 未启用', 'Review · Disabled'],
    active: ['服务运行', 'Service active'],
    inactive: ['服务未运行', 'Service inactive'],
    failed: ['需检查 · 服务故障', 'Review · Service failed'],
    not_installed: ['未找到服务', 'Service not found'],
    unavailable: ['暂时无法读取', 'Unavailable'],
    permission_denied: ['节点无读取权限', 'Node lacks permission'],
    not_supported: ['节点缺少对应工具', 'Probe unavailable on this node'],
    timed_out: ['读取超时', 'Timed out'],
    unrecognized: ['当前状态无法确认', 'Unverified'],
};

type Result =
    | {state: 'loading' | 'denied' | 'failed'}
    | {state: 'ready'; baseline: ComputeSecurityBaseline};

const Evidence = ({baseline, zh}: {baseline: ComputeSecurityBaseline; zh: boolean}) => {
    const captured = baseline.captured_at * 1000;
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const current = Date.now();
        setNow(current);
        const remaining = captured + 120_000 - current;
        if (remaining <= 0 || captured - current > 30_000) return undefined;
        const timer = window.setTimeout(() => setNow(Date.now()), remaining);
        return () => window.clearTimeout(timer);
    }, [captured]);
    const lang = zh ? 0 : 1;
    const clockMismatch = captured - now > 30_000;
    const stale = now - captured >= 120_000;
    return <>
        <small>{zh ? '采集于' : 'Captured'} <time dateTime={new Date(captured).toISOString()}>
            {new Date(captured).toLocaleString(zh ? 'zh-CN' : 'en-US')}
        </time></small>
        {clockMismatch && <p role='status'>{zh ? '设备采集时间晚于本机时间。' : 'The device timestamp is ahead of this console.'}</p>}
        {stale && <p role='status'>{zh ? '证据已过期，请重新检查。' : 'Evidence is stale. Run the check again.'}</p>}
        {baseline.platform === 'linux' && <p>{zh ? '以下为 systemd 服务状态。防火墙规则是否生效需要另外核对。'
            : 'These are systemd service states. Effective firewall rules require a separate check.'}</p>}
        {baseline.checks.length ? <ul>{baseline.checks.map(item => <li key={item.check_id}>
            <strong>{names[item.check_id]?.[lang] ?? item.check_id}</strong>
            <span data-evidence={item.evidence}>{evidence[item.evidence]?.[lang] ?? evidence.unrecognized[lang]}</span>
        </li>)}</ul> : <p>{zh ? '此系统暂无对应的基线检查项。' : 'No baseline checks are available for this system.'}</p>}
    </>;
};

const BaselineWorkspace = ({node, zh}: {node: ComputeClusterNode; zh: boolean}) => {
    const [result, setResult] = useState<Result>({state: 'loading'});
    const [revision, setRevision] = useState(0);
    const {node_id: nodeId, installation_id: installationId} = node;
    useEffect(() => {
        const controller = new AbortController();
        const reset = () => {
            controller.abort();
            setResult({state: 'loading'});
            setRevision(current => current + 1);
        };
        window.addEventListener(ACCOUNT_SESSION_CHANGED, reset);
        void ComputeClusterService.securityBaseline(nodeId, controller.signal).then(baseline => {
            if (controller.signal.aborted) return;
            if (baseline.schema_version !== 'runtime.security-baseline.v1' || baseline.installation_id !== installationId
                || !Number.isFinite(baseline.captured_at) || baseline.captured_at <= 0 || baseline.captured_at >= 8_640_000_000_000) {
                setResult({state: 'failed'});
                return;
            }
            setResult({state: 'ready', baseline});
        }).catch(reason => {
            if (!controller.signal.aborted) setResult({state: isComputeAccessDenied(reason) ? 'denied' : 'failed'});
        });
        return () => {
            controller.abort();
            window.removeEventListener(ACCOUNT_SESSION_CHANGED, reset);
        };
    }, [installationId, nodeId, revision]);

    const messages = {
        loading: zh ? '正在读取系统安全状态…' : 'Reading system security status…',
        denied: zh ? '当前账号无权读取此设备的安全基线。' : 'Your account cannot read this device’s security baseline.',
        failed: zh ? '安全基线读取失败，请重试。' : 'The security baseline could not be read. Try again.',
    };
    return <section className='ControlManagerSecurityBaseline' aria-label={zh ? '系统安全基线' : 'System security baseline'}>
        <header>
            <h3>{zh ? '系统安全基线' : 'System security baseline'}</h3>
            <button type='button' disabled={result.state === 'loading'} onClick={() => {
                setResult({state: 'loading'});
                setRevision(current => current + 1);
            }}>{zh ? '重新检查' : 'Run again'}</button>
        </header>
        <p>{zh ? '只读检查。按当前系统显示能够确认的防护状态。' : 'Read-only checks for protection states the current system can report.'}</p>
        {result.state === 'ready' ? <Evidence baseline={result.baseline} zh={zh}/>
            : <p role={result.state === 'loading' ? 'status' : 'alert'}>{messages[result.state]}</p>}
    </section>;
};

export const SecurityBaselinePanel = ({node, zh}: {node: ComputeClusterNode; zh: boolean}) => {
    if (!node.capabilities.includes('runtime.security-baseline.read.v1')) {
        return <p role='status'>{zh ? '当前节点版本未提供安全基线。' : 'This node version does not provide the security baseline.'}</p>;
    }
    if (!node.online && !node.network.ssh_available) {
        return <p role='status'>{zh ? '当前设备暂不可达。' : 'This device is not reachable.'}</p>;
    }
    return <BaselineWorkspace key={`${node.node_id}:${node.installation_id}`} node={node} zh={zh}/>;
};
