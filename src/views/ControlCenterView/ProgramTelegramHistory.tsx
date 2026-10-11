import React, {useEffect, useRef, useState} from 'react';
import {ComputeClusterService, ComputeProgramSnapshot} from '../../services/ComputeClusterService';
import {prettyTelegramJson, readTelegramHistory, TelegramHistory, TelegramRecord} from '../../services/ProgramTelegramHistory';

type Artifact = ComputeProgramSnapshot['programs'][number]['artifacts'][number] & {
    selection_id: string;
    program_id: string;
    program_name: string;
};

const PAGE_SIZE = 100;

const field = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)
        && (!Number.isInteger(value) || Number.isSafeInteger(value))) return String(value);
    return '—';
};

const recordTime = (record?: TelegramRecord): string => field(
    record?.value.t ?? record?.value.ts ?? record?.value.timestamp ?? record?.value.time ?? record?.value.created_at,
);

// Bilingual labels account for most branches in this view.
// eslint-disable-next-line complexity
const TelegramFile: React.FC<{url: string; online: boolean; zh: boolean; pretty: boolean}> = ({
    url, online, zh, pretty,
}) => {
    const [history, setHistory] = useState<TelegramHistory>();
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(0);
    const request = useRef<AbortController>();

    const load = async (previous?: TelegramHistory) => {
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        setLoading(true);
        setError('');
        try {
            const next = await readTelegramHistory(url, previous, controller.signal);
            if (controller.signal.aborted) return;
            setHistory(next);
            setPage(previous ? Math.floor(previous.records.length / PAGE_SIZE) : 0);
        } catch (reason) {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    };

    useEffect(() => {
        if (online) void load();
        else setLoading(false);
        return () => request.current?.abort();
    }, [url, online]);

    const records = history?.records || [];
    const first = records[0];
    const last = records[records.length - 1];
    const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
    const currentPage = Math.min(page, pageCount - 1);
    const end = records.length - currentPage * PAGE_SIZE;
    const visible = records.slice(Math.max(0, end - PAGE_SIZE), end).reverse();

    return <>
        <div className='ControlProgramLogTools'>
            <button type='button' disabled={!online || loading} onClick={() => void load()}>
                {zh ? '刷新文件' : 'Refresh file'}
            </button>
            <button type='button' disabled={!online || loading || !history || history.start === 0}
                onClick={() => void load(history)}>
                {zh ? '加载更早' : 'Load earlier'}
            </button>
            <a href={url} download='ixcom.jsonl'>{zh ? '下载原文件' : 'Download original'}</a>
        </div>
        {!online && <p role='status'>{zh ? '节点离线，历史读取已暂停。' : 'Node offline; history reads paused.'}</p>}
        {loading && <p role='status'>{zh ? '正在读取电文文件…' : 'Reading telegram file…'}</p>}
        {error && <p className='ControlProgramError' role='alert'>
            {zh ? '文件读取失败，已加载内容保留。可重试或刷新文件：' : 'Read failed; loaded content retained. Retry or refresh: '}{error}
        </p>}
        {history && <>
            <p role='status'>
                {history.start === 0
                    ? (zh ? '已读取至文件开头' : 'Reached start of file')
                    : (zh ? '仅已加载部分历史' : 'History partially loaded')}
                {zh ? ` · 电文 ${records.length} 条 · 坏行 ${history.invalid.length} 条`
                    : ` · ${records.length} telegrams · ${history.invalid.length} invalid lines`}
                {zh ? ` · 非 ixcom ${history.otherLines} 条（不计入电文）`
                    : ` · ${history.otherLines} non-ixcom lines (excluded)`}
                {` · ${history.size - history.start} / ${history.size} B`}
            </p>
            <p>{zh ? '已加载首尾（文件顺序）' : 'Loaded first/last (file order)'}
                {` · frame_idx: ${field(first?.value.frame_idx)} → ${field(last?.value.frame_idx)}`}
                {` · ${zh ? '时间' : 'Time'}: ${recordTime(first)} → ${recordTime(last)}`}
            </p>
            <p>{zh
                ? '电文只计 src=ixcom 的有效 JSON 行，空行不计。新增电文需刷新文件；读取期间请勿替换或覆盖文件。字段缺失或无法精确显示时标为 —，以原始行核对。'
                : 'Telegrams count valid JSON lines with src=ixcom; blank lines are excluded. Refresh for new telegrams; do not replace or overwrite files while reading. Missing or inexact summary fields show —; verify original lines.'}</p>
            {history.invalid.length > 0 && <details>
                <summary>{zh ? '查看坏行（最多前 100 条）' : 'Invalid lines (first 100)'}</summary>
                {history.invalid.slice(0, PAGE_SIZE).map(line => <div key={line.byteOffset}>
                    <span>{zh ? '字节位置' : 'Byte offset'} {line.byteOffset}</span>
                    <pre className='ControlProgramLogMessage'>{line.raw}</pre>
                </div>)}
            </details>}
            <div className='ControlProgramLogTools'>
                <button type='button' disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                    {zh ? '较新记录' : 'Newer records'}
                </button>
                <span>{currentPage + 1} / {pageCount}</span>
                <button type='button' disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>
                    {zh ? '较早记录' : 'Older records'}
                </button>
            </div>
            <ol>
                {visible.map(record => <li key={record.byteOffset}>
                    <span className='ControlProgramLogTime'>{recordTime(record)}</span>
                    <span className='ControlProgramLogProgram'>frame_idx {field(record.value.frame_idx)}</span>
                    <span className='ControlProgramLogType'>{zh ? '字节' : 'Byte'} {record.byteOffset}</span>
                    <pre className='ControlProgramLogMessage' aria-label={zh ? '电文内容' : 'Telegram content'}>
                        {pretty ? prettyTelegramJson(record.raw) : record.raw}
                    </pre>
                </li>)}
            </ol>
        </>}
    </>;
};

export const ProgramTelegramHistory: React.FC<{
    nodeId: string;
    artifacts: Artifact[];
    online: boolean;
    zh: boolean;
    pretty: boolean;
}> = ({nodeId, artifacts, online, zh, pretty}) => {
    const [selectedId, setSelectedId] = useState('');
    const selected = artifacts.find(artifact => artifact.selection_id === selectedId) || artifacts[0];
    if (!selected) return null;
    const url = ComputeClusterService.programArtifactUrl(
        nodeId, selected.program_id, selected.artifact_id, selected.modified_at,
    );
    return <div className='ControlProgramTelegramHistory'>
        <div className='ControlMonitorSearchHeader'>
            <label>{zh ? '电文文件' : 'Telegram file'}
                <select aria-label={zh ? '电文文件' : 'Telegram file'} value={selected.selection_id}
                    onChange={event => setSelectedId(event.target.value)}>
                    {artifacts.map(artifact => <option key={artifact.selection_id} value={artifact.selection_id}>
                        {artifact.program_name} · {artifact.relative_path}
                    </option>)}
                </select>
            </label>
        </div>
        <p>{zh
            ? '按文件读取原始电文；这里只列出节点当前返回的文件，未列出的归档不计入历史完整性。'
            : 'Original telegrams by file. Only files currently listed by the node are included; unlisted archives are outside this history.'}</p>
        <TelegramFile key={url} url={url} online={online} zh={zh} pretty={pretty} />
    </div>;
};
