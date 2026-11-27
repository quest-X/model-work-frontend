import React, {useState} from 'react';
import type {DeviceAlert} from './DeviceAlerts';
import type {ProgramLogScope} from './ProgramRunnerPanel';
import {metricLabel} from './PerformanceDiagnosisPanel';
import type {ComputePerformanceMetric} from '../../services/ComputeClusterService';

type AlertStatus = 'pending' | 'acknowledged' | 'recovered';
const status = (row: DeviceAlert): AlertStatus => row.recoveredAt ? 'recovered'
    : row.acknowledgedAt ? 'acknowledged' : 'pending';

const title = (row: DeviceAlert, zh: boolean) => ({
    offline: zh ? '节点离线' : 'Node offline',
    ssh: zh ? 'SSH 控制路径异常' : 'SSH control route degraded',
    disk: zh ? '可用磁盘空间不足' : 'Low free disk space',
    service: zh ? '服务异常' : 'Service fault',
    program: zh ? '业务程序异常' : 'Business program fault',
    performance: zh ? '性能指标持续越线' : 'Sustained performance threshold breach',
})[row.rule];

const subject = (row: DeviceAlert, zh: boolean) => row.rule === 'performance'
    ? metricLabel(row.subject as ComputePerformanceMetric, zh) : row.label;

const formatTime = (at: number, zh: boolean) => new Date(at * 1000).toLocaleString(zh ? 'zh-CN' : 'en-US');

interface Props {
    alerts: DeviceAlert[];
    persistent: boolean;
    zh: boolean;
    availableNodes: ReadonlySet<string>;
    acknowledge: (id: string) => void;
    openNode: (nodeId: string, scope?: ProgramLogScope) => void;
}

// Alert acknowledgement records a review while the condition remains open.
// eslint-disable-next-line complexity
export const DeviceAlertsPanel = ({alerts, persistent, zh, availableNodes, acknowledge, openNode}: Props) => {
    const [filter, setFilter] = useState<AlertStatus | 'all'>('pending');
    const labels = {
        all: zh ? '全部' : 'All',
        pending: zh ? '待确认' : 'Pending',
        acknowledged: zh ? '已确认' : 'Acknowledged',
        recovered: zh ? '已恢复' : 'Recovered',
    };
    const pending = alerts.filter(row => status(row) === 'pending').length;
    const open = alerts.filter(row => !row.recoveredAt).length;
    const rows = alerts.filter(row => filter === 'all' || status(row) === filter);

    return <section className='ControlManagerAlerts' aria-labelledby='device-alerts-title'>
        <details>
            <summary>
                <h2 id='device-alerts-title'>{zh ? '设备告警' : 'Device alerts'}</h2>
                <span aria-live='polite'>{zh ? `${pending} 待确认 · ${open} 未恢复` : `${pending} pending · ${open} open`}</span>
            </summary>
            <p>{zh
                ? '页面运行时依据节点刷新监测离线、SSH 和磁盘。服务、程序和性能在自检后更新。采集失败或证据过期时保留原告警。'
                : 'Node refreshes track offline status, SSH and disk while the page is open. Self-checks update service, program and performance alerts. Missing or stale evidence keeps the previous alert open.'}</p>
            <p>{zh
                ? '磁盘可用空间 ≤10% 时触发，恢复至 ≥15% 后关闭。确认仅记录查阅，恢复需要同一来源提供新的正常证据。'
                : 'Free disk space at 10% or less triggers an alert. Recovery requires 15% or more. Acknowledgement records review. Recovery requires newer healthy evidence from the same source.'}</p>
            <p>{persistent
                ? (zh ? '记录按账号保存在当前浏览器，保留最近 100 条已恢复告警。' : 'Records are saved per account in this browser, including up to 100 recovered alerts.')
                : (zh ? '本地记录当前不可持久化。' : 'Local records cannot currently be saved.')}</p>
            <label>{zh ? '告警状态' : 'Alert status'}
                <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
                    {Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
            </label>
            {rows.length === 0 ? <p>{zh ? '没有符合筛选条件的告警。' : 'No alerts match this filter.'}</p> : <ul>
                {rows.map(row => <li key={row.id}>
                    <div className='ControlManagerAlertIdentity'>
                        <strong>{row.nodeName} · {title(row, zh)}</strong>
                        <span>{subject(row, zh)}</span>
                    </div>
                    <strong className={row.recoveredAt ? 'recovered' : row.severity}>
                        {labels[status(row)]} · {row.severity === 'critical' ? (zh ? '故障' : 'Fault') : (zh ? '警告' : 'Warning')}
                    </strong>
                    {[
                        [zh ? '触发' : 'Opened', row.openedAt],
                        [zh ? '最近证据' : 'Latest evidence', row.observedAt],
                        [zh ? '确认' : 'Acknowledged', row.acknowledgedAt],
                        [zh ? '恢复' : 'Recovered', row.recoveredAt],
                    ].map(([label, time]) => typeof time === 'number' && <small key={label}>{label} {formatTime(time, zh)}</small>)}
                    <div className='ControlManagerAlertActions'>
                        {status(row) === 'pending' && <button type='button' onClick={() => acknowledge(row.id)}>{zh ? '确认告警' : 'Acknowledge'}</button>}
                        <button type='button' disabled={!availableNodes.has(row.nodeId)} onClick={() => openNode(row.nodeId)}>
                            {zh ? '查看设备' : 'View device'}
                        </button>
                        {row.log && <button type='button' disabled={!availableNodes.has(row.nodeId)} onClick={() => openNode(row.nodeId, row.log)}>
                            {zh ? '查看告警日志' : 'View alert logs'}
                        </button>}
                    </div>
                </li>)}
            </ul>}
        </details>
    </section>;
};
