import React, {useEffect, useRef, useState} from 'react';
import {Dialog, DialogContent, DialogTitle} from '@mui/material';
import {Download, X} from 'lucide-react';
import {ComputeClusterService} from '../../services/ComputeClusterService';
import {useEscapeToClose} from '../../hooks/useEscapeToClose';
import {StatisticsExportDay, statisticsExportDates, statisticsExportTables, statisticsHasRecords} from './statisticsExport';
import {statisticsDataExport} from './statisticsDataExport';

interface Props {
    nodeId: string;
    nodeName: string;
    programId: string;
    date: string;
    today: string;
    zh: boolean;
    onOpen: () => void;
}

async function readDay(nodeId: string, programId: string, day: string, signal: AbortSignal, zh: boolean): Promise<StatisticsExportDay> {
    const request = new AbortController();
    const cancel = () => request.abort();
    signal.addEventListener('abort', cancel, {once: true});
    const timeout = window.setTimeout(cancel, 30000);
    try {
        const offset = -new Date(`${day}T12:00:00`).getTimezoneOffset();
        const statistics = await ComputeClusterService.programOverflowStatistics(nodeId, programId, day, offset, request.signal);
        if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (statistics.date !== day || statistics.program_id !== programId || statistics.timezone_offset_minutes !== offset) {
            throw new Error(zh ? '统计响应的日期、程序或时区不匹配。' : 'Statistics date, program or timezone mismatch.');
        }
        return {date: day, statistics};
    } catch (error) {
        if (signal.aborted) throw error;
        return {date: day, error: request.signal.aborted
            ? (zh ? '读取超时' : 'Request timed out')
            : error instanceof Error ? error.message : String(error)};
    } finally {
        window.clearTimeout(timeout);
        signal.removeEventListener('abort', cancel);
    }
}

const packagingStatus = (format: 'csv' | 'pdf', zh: boolean) => format === 'pdf'
    ? (zh ? '正在生成 PDF 报告' : 'Preparing PDF report') : (zh ? '正在生成数据文件' : 'Preparing data file');

async function exportBlob(format: 'csv' | 'pdf', nodeName: string, programId: string, days: StatisticsExportDay[], signal: AbortSignal, zh: boolean) {
    if (format === 'pdf') {
        const {statisticsPdf} = await import('./statisticsPdf');
        return {blob: await statisticsPdf(nodeName, programId, days, signal), extension: 'pdf'};
    }
    return statisticsDataExport(statisticsExportTables(nodeName, programId, days, zh), signal);
}

export const ProgramStatisticsExport: React.FC<Props> = ({nodeId, nodeName, programId, date, today, zh, onOpen}) => {
    const [open, setOpen] = useState(false);
    const [start, setStart] = useState(date);
    const [end, setEnd] = useState(date);
    const [format, setFormat] = useState<'csv' | 'pdf'>('csv');
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState('');
    const [message, setMessage] = useState('');
    const [file, setFile] = useState<{url: string; name: string} | null>(null);
    const controller = useRef<AbortController | null>(null);
    const formatText = zh
        ? {label: '导出格式', csv: 'CSV 数据', pdf: 'PDF 报告', hint: '中英双语日报，按日期分页。', dataHint: '单表导出 CSV；多表合并为 Excel，不同表格存放在不同 Sheet。'}
        : {label: 'Export format', csv: 'CSV data', pdf: 'PDF report', hint: 'Bilingual daily reports, paginated by date.', dataHint: 'One table: CSV. Multiple tables: one Excel workbook with separate sheets.'};
    const close = () => {
        controller.current?.abort();
        setFile(null);
        setOpen(false);
    };
    useEscapeToClose(close, open, 40);
    useEffect(() => () => controller.current?.abort(), []);
    useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);

    const prepareExport = async () => {
        if (controller.current) return;
        setFile(null);
        setMessage('');
        let dates: string[];
        try {
            dates = statisticsExportDates(start, end, today, zh);
        } catch (error) {
            setMessage((error as Error).message);
            return;
        }
        const job = new AbortController();
        controller.current = job;
        setBusy(true);
        const days: StatisticsExportDay[] = [];
        try {
            for (const day of dates) {
                if (job.signal.aborted) return;
                setProgress(`${days.length} / ${dates.length} · ${day}`);
                days.push(await readDay(nodeId, programId, day, job.signal, zh));
            }
            if (job.signal.aborted) return;
            setProgress(`${dates.length} / ${dates.length} · ${packagingStatus(format, zh)}`);
            const {blob, extension} = await exportBlob(format, nodeName, programId, days, job.signal, zh);
            if (job.signal.aborted) return;
            const safeName = nodeName.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_');
            setFile({url: URL.createObjectURL(blob), name: `${safeName}_overflow_${start}_${end}.${extension}`});
            const failed = days.filter(day => !day.statistics).length;
            const empty = days.filter(day => day.statistics && !statisticsHasRecords(day.statistics)).length;
            setMessage(zh
                ? `已生成 ${days.length} 天；无记录 ${empty} 天，读取失败 ${failed} 天。`
                : `Prepared ${days.length} days; ${empty} without records, ${failed} failed.`);
        } catch (error) {
            if (!job.signal.aborted) setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            if (controller.current === job) {
                controller.current = null;
                setBusy(false);
                setProgress('');
            }
        }
    };
    return <>
        <button type='button' className='ControlProgramStatisticsExportButton'
            aria-label={zh ? '导出统计' : 'Export statistics'} title={zh ? '导出统计' : 'Export statistics'}
            onClick={() => { onOpen(); setMessage(''); setOpen(true); }}>
            {zh ? '导出' : 'Export'}
        </button>
        <Dialog open={open} onClose={close} aria-labelledby='statistics-export-title'
            PaperProps={{className: 'ControlStatisticsExportDialog', sx: {backgroundColor: '#242424', color: '#eee'}}}>
            <DialogTitle id='statistics-export-title'>{zh ? '导出统计' : 'Export statistics'} · {nodeName}</DialogTitle>
            <DialogContent>
                <form onSubmit={event => { event.preventDefault(); void prepareExport(); }}>
                    <div className='date-range'>
                        <label>{zh ? '开始日期' : 'Start date'}<input type='date' required value={start} max={today}
                            disabled={busy} onChange={event => { setStart(event.target.value); setFile(null); setMessage(''); }}/></label>
                        <label>{zh ? '结束日期' : 'End date'}<input type='date' required value={end} min={start} max={today}
                            disabled={busy} onChange={event => { setEnd(event.target.value); setFile(null); setMessage(''); }}/></label>
                    </div>
                    <label className='format-field'>{formatText.label}
                        <select value={format} disabled={busy} onChange={event => {
                            setFormat(event.target.value as 'csv' | 'pdf'); setFile(null); setMessage('');
                        }}>
                            <option value='csv'>{formatText.csv}</option>
                            <option value='pdf'>{formatText.pdf}</option>
                        </select>
                    </label>
                    <p>{format === 'pdf' ? formatText.hint : formatText.dataHint}</p>
                    <div role='status' aria-live='polite'>{busy ? progress : message}</div>
                    <footer>
                        <button type='button' onClick={close}><X aria-hidden='true'/>{zh ? '取消' : 'Cancel'}</button>
                        {file
                            ? <a href={file.url} download={file.name}><Download aria-hidden='true'/>{zh ? '下载文件' : 'Download file'}</a>
                            : <button type='submit' disabled={busy}><Download aria-hidden='true'/>{zh ? '导出' : 'Export'}</button>}
                    </footer>
                </form>
            </DialogContent>
        </Dialog>
    </>;
};
