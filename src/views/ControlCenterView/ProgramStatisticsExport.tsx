import React, {useEffect, useRef, useState} from 'react';
import {Dialog, DialogContent, DialogTitle} from '@mui/material';
import {Download, X} from 'lucide-react';
import JSZip from 'jszip';
import {saveAs} from 'file-saver';
import {ComputeClusterService} from '../../services/ComputeClusterService';
import {useEscapeToClose} from '../../hooks/useEscapeToClose';
import {StatisticsExportDay, statisticsExportDates, statisticsExportFiles, statisticsHasRecords} from './statisticsExport';

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

export const ProgramStatisticsExport: React.FC<Props> = ({nodeId, nodeName, programId, date, today, zh, onOpen}) => {
    const [open, setOpen] = useState(false);
    const [start, setStart] = useState(date);
    const [end, setEnd] = useState(date);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState('');
    const [message, setMessage] = useState('');
    const controller = useRef<AbortController | null>(null);
    const close = () => {
        controller.current?.abort();
        setOpen(false);
    };
    useEscapeToClose(close, open, 40);
    useEffect(() => () => controller.current?.abort(), []);

    const download = async () => {
        if (controller.current) return;
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
            setProgress(`${dates.length} / ${dates.length} · ${zh ? '正在打包' : 'Packaging'}`);
            const zip = new JSZip();
            Object.entries(statisticsExportFiles(nodeName, programId, days, zh)).forEach(([name, contents]) => zip.file(name, contents));
            const blob = await zip.generateAsync({type: 'blob', compression: 'DEFLATE'});
            if (job.signal.aborted) return;
            const safeName = nodeName.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_');
            saveAs(blob, `${safeName}_overflow_${start}_${end}.zip`);
            const failed = days.filter(day => !day.statistics).length;
            const empty = days.filter(day => day.statistics && !statisticsHasRecords(day.statistics)).length;
            setMessage(zh
                ? `已导出 ${days.length} 天；无记录 ${empty} 天，读取失败 ${failed} 天。`
                : `Exported ${days.length} days; ${empty} without records, ${failed} failed.`);
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
        <button type='button' className='ControlMachineHistoryRefresh'
            aria-label={zh ? '导出统计' : 'Export statistics'} title={zh ? '导出统计' : 'Export statistics'}
            onClick={() => { onOpen(); setMessage(''); setOpen(true); }}>
            <Download aria-hidden='true'/>
        </button>
        <Dialog open={open} onClose={close} aria-labelledby='statistics-export-title'
            PaperProps={{className: 'ControlStatisticsExportDialog', sx: {backgroundColor: '#242424', color: '#eee'}}}>
            <DialogTitle id='statistics-export-title'>{zh ? '导出统计' : 'Export statistics'} · {nodeName}</DialogTitle>
            <DialogContent>
                <form onSubmit={event => { event.preventDefault(); void download(); }}>
                    <div className='date-range'>
                        <label>{zh ? '开始日期' : 'Start date'}<input type='date' required value={start} max={today}
                            disabled={busy} onChange={event => setStart(event.target.value)}/></label>
                        <label>{zh ? '结束日期' : 'End date'}<input type='date' required value={end} min={start} max={today}
                            disabled={busy} onChange={event => setEnd(event.target.value)}/></label>
                    </div>
                    <p>CSV · ZIP</p>
                    <div role='status' aria-live='polite'>{busy ? progress : message}</div>
                    <footer>
                        <button type='button' onClick={close}><X aria-hidden='true'/>{zh ? '取消' : 'Cancel'}</button>
                        <button type='submit' disabled={busy}><Download aria-hidden='true'/>{zh ? '导出' : 'Export'}</button>
                    </footer>
                </form>
            </DialogContent>
        </Dialog>
    </>;
};
