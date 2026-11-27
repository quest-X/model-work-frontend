import React, {useState} from 'react';
import {ComputeClusterNode} from '../../services/ComputeClusterService';
import {BatchDeviceCheck, checkSummaryLabel} from './DeviceChecks';
import type {ProgramLogScope} from './ProgramRunnerPanel';

interface IProps {
    nodes: ComputeClusterNode[];
    zh: boolean;
    active?: 'single' | 'batch';
    batch?: BatchDeviceCheck;
    start: (nodes: ComputeClusterNode[]) => void;
    cancel: () => void;
    openNode: (nodeId: string, scope?: ProgramLogScope) => void;
}

export const DeviceBatchChecks = ({nodes, zh, active, batch, start, cancel, openNode}: IProps) => {
    const [expanded, setExpanded] = useState(false);
    const [chosen, setChosen] = useState<string[]>([]);
    const selection = nodes.filter(node => chosen.includes(node.node_id));
    const accessible = new Set(nodes.map(node => node.node_id));
    const rows = batch?.rows.filter(row => accessible.has(row.node.node_id)) || [];
    const completed = rows.filter(row => row.check?.summary || (batch?.cancelled && !row.check)).length;
    const open = expanded || active === 'batch';

    return <section className='ControlManagerBatch' aria-labelledby='device-batch-check-title'>
        <div className='ControlManagerBatchHeading'>
            <h2 id='device-batch-check-title'>{zh ? '批量只读自检' : 'Batch read-only self-check'}</h2>
            <button type='button' aria-expanded={open} aria-controls='device-batch-check-body' disabled={active === 'batch'}
                onClick={() => setExpanded(value => !value)}>
                {open ? (zh ? '收起批量自检' : 'Hide batch self-check') : (zh ? '选择检查机器' : 'Choose machines to check')}
            </button>
        </div>
        <div id='device-batch-check-body' hidden={!open}>
            <fieldset disabled={Boolean(active)}>
                <legend>{zh ? '目标机器' : 'Target machines'}</legend>
                {nodes.map(node => <label key={node.node_id}>
                    <input type='checkbox' checked={chosen.includes(node.node_id)}
                        onChange={event => {
                            const checked = event.target.checked;
                            setChosen(previous => checked
                                ? [...previous, node.node_id]
                                : previous.filter(id => id !== node.node_id));
                        }}/>
                    <span>{node.name}</span>
                    <small>{node.online ? (zh ? '在线' : 'Online') : (zh ? '离线' : 'Offline')}</small>
                </label>)}
            </fieldset>
            <div className='ControlManagerActions'>
                <button type='button' className='primary' disabled={Boolean(active) || selection.length === 0}
                    onClick={() => start(selection)}>
                    {zh ? `开始批量自检（${selection.length} 台）` : `Check selected machines (${selection.length})`}
                </button>
                {active === 'batch' && <button type='button' onClick={cancel}>
                    {zh ? '取消批量自检' : 'Cancel batch self-check'}
                </button>}
            </div>
            {batch && <div className='ControlManagerBatchResults'>
                <p role='status'>{zh ? `已处理 ${completed} / ${rows.length} 台`
                    : `${completed} of ${rows.length} machines processed`}</p>
                <ul>{rows.map(({node, check}) => {
                    const summary = check?.summary;
                    return <li key={node.node_id}>
                        <strong>{node.name}</strong>
                        <span>{summary ? checkSummaryLabel(summary.status, zh)
                            : check ? (zh ? '检查中' : 'Checking')
                                : batch.cancelled ? (zh ? '已取消' : 'Cancelled') : (zh ? '排队中' : 'Queued')}</span>
                        {summary && <small>{zh ? `${summary.faults} 项故障或告警` : `${summary.faults} faults or warnings`}</small>}
                        <button type='button' disabled={!check}
                            onClick={() => openNode(node.node_id)}>
                            {zh ? `查看 ${node.name} 自检` : `View ${node.name} check`}
                        </button>
                        {summary?.log && <button type='button'
                            onClick={() => openNode(node.node_id, summary.log)}>
                            {zh ? `查看 ${node.name} 日志` : `View ${node.name} logs`}
                        </button>}
                    </li>;
                })}</ul>
            </div>}
        </div>
    </section>;
};
