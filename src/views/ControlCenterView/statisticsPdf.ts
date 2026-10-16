import {jsPDF} from 'jspdf';
import {ComputeProgramOverflowStatistics} from '../../services/ComputeClusterService';
import {StatisticsExportDay, statisticsHasRecords} from './statisticsExport';

const BLUE = '#1F4E78';
const GRAY = '#657582';
const INK = '#202020';
const WIDTH = 504;
const LEFT = 56;
let reportFont: string;

const clean = (value: string) => value.replace(/\p{Cc}/gu, ' ').slice(0, 700);
const total = (levels: ComputeProgramOverflowStatistics['episodes']) => Object.values(levels).reduce((a, b) => a + b, 0);
const timestamp = (seconds: number | null, offset: number) => seconds === null ? '-'
    : new Date((seconds + offset * 60) * 1000).toISOString().slice(0, 19).replace('T', ' ');
const duration = (seconds: number) => {
    const n = Math.round(seconds);
    return `${Math.floor(n / 60).toString().padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
};
const timezone = (offset: number) => `UTC${offset < 0 ? '-' : '+'}${Math.floor(Math.abs(offset) / 60)
    .toString().padStart(2, '0')}:${(Math.abs(offset) % 60).toString().padStart(2, '0')}`;
const aborted = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); };

async function loadFont(signal: AbortSignal): Promise<string> {
    if (reportFont) return reportFont;
    const response = await fetch('/fonts/daily-report-sans.ttf', {signal});
    if (!response.ok) throw new Error('PDF 中文字体读取失败 / Could not load report font.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    aborted(signal);
    if (bytes[0] !== 0 || bytes[1] !== 1 || bytes[2] !== 0 || bytes[3] !== 0) {
        throw new Error('PDF 中文字体无效 / Invalid report font.');
    }
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
    reportFont = btoa(chunks.join(''));
    return reportFont;
}

class DailyReport {
    doc = new jsPDF({unit: 'pt', format: 'letter', compress: true, putOnlyUsedFonts: true});
    pageDates: string[] = [];
    constructor(private nodeName: string, private programId: string, font: string) {
        this.doc.addFileToVFS('daily-report-sans.ttf', font);
        this.doc.addFont('daily-report-sans.ttf', 'Report', 'normal');
        this.doc.setProperties({title: `${nodeName} Daily Statistics`, author: '', subject: 'Bilingual daily device report'});
    }
    text(value: string | number, x: number, y: number, size = 9, color = INK, align: 'left' | 'center' | 'right' = 'left', bold = false) {
        const text = String(value);
        this.doc.setFont(/[^\x20-\x7E]/.test(text) ? 'Report' : 'helvetica', bold ? 'bold' : 'normal');
        this.doc.setFontSize(size); this.doc.setTextColor(color);
        this.doc.text(text, x, y + size, {align});
    }
    rule(y: number, color = '#CCD9E2') {
        this.doc.setDrawColor(color); this.doc.setLineWidth(0.4); this.doc.line(LEFT, y, LEFT + WIDTH, y);
    }
    page(date: string, cn: string, en: string) {
        if (this.pageDates.length) this.doc.addPage();
        this.pageDates.push(date);
        this.text(this.nodeName, LEFT, 23, 8, GRAY);
        this.text(`${date} | ${this.programId}`, LEFT + WIDTH, 23, 8, GRAY, 'right');
        this.rule(42, BLUE);
        this.text(cn, LEFT, 63, 23, BLUE);
        this.text(en, LEFT, 96, 13, GRAY);
    }
    heading(cn: string, en: string, y: number): number {
        this.text(cn, LEFT, y, 13, BLUE);
        this.text(en, LEFT + WIDTH, y + 4, 9, BLUE, 'right');
        return y + 28;
    }
    note(cn: string, en: string, y: number, size = 9): number {
        for (const [value, font, textSize, color] of [[cn, 'Report', size, INK], [en, 'helvetica', size - 1, GRAY]] as const) {
            this.doc.setFont(font, 'normal'); this.doc.setFontSize(textSize); this.doc.setTextColor(color);
            const lines = this.doc.splitTextToSize(value, WIDTH);
            this.doc.text(lines, LEFT, y + textSize, {lineHeightFactor: 1.3});
            y += lines.length * textSize * 1.3;
        }
        return y + 7;
    }
    table(headers: [string, string][], rows: (string | number)[][], widths: number[], y: number, rowHeight = 27, large = false): number {
        this.doc.setFillColor(BLUE); this.doc.rect(LEFT, y, WIDTH, 32, 'F');
        let x = LEFT;
        headers.forEach(([cn, en], i) => {
            this.text(cn, x + widths[i] / 2, y + 5, 8, '#FFFFFF', 'center');
            this.text(en, x + widths[i] / 2, y + 18, 7, '#FFFFFF', 'center');
            x += widths[i];
        });
        y += 32;
        rows.forEach((row, index) => {
            this.doc.setFillColor(index % 2 ? '#EFF5FA' : '#FFFFFF');
            this.doc.rect(LEFT, y, WIDTH, rowHeight, 'F');
            x = LEFT;
            row.forEach((value, i) => {
                const lines = String(value).split('\n');
                const size = large ? 25 : 8.5;
                const top = y + (rowHeight - lines.length * (large ? 30 : 11)) / 2;
                lines.forEach((line, n) => this.text(line, x + widths[i] / 2, top + n * 11,
                    size, large ? BLUE : INK, 'center', large));
                this.doc.setDrawColor('#CCD9E2'); this.doc.setLineWidth(0.35);
                this.doc.rect(x, y, widths[i], rowHeight);
                x += widths[i];
            });
            y += rowHeight;
        });
        return y;
    }
    overview(s: ComputeProgramOverflowStatistics) {
        this.page(s.date, '每日溢渣统计报告', 'DAILY SLAG OVERFLOW REPORT');
        this.text(`${s.date} | ${timezone(s.timezone_offset_minutes)} | ${this.programId}`, LEFT, 123, 8, GRAY);
        this.table([['溢渣次数', 'Total episodes'], ['小溢渣', 'Small'], ['中溢渣', 'Medium'], ['大溢渣', 'Large']],
            [[total(s.episodes).toLocaleString('en-US'), s.episodes.small, s.episodes.medium, s.episodes.large]], [126, 126, 126, 126], 157, 45, true);
        this.table([['溢渣帧及占比', 'Overflow frames / share'], ['总帧数', 'Total frames'],
            ['倾炉会话', 'Tilt sessions'], ['最近溢渣', 'Last overflow']], [[
            `${s.overflow_frames.toLocaleString('en-US')} / ${s.total_frames ? `${(100 * s.overflow_frames / s.total_frames).toFixed(2)}%` : '-'}`,
            s.total_frames.toLocaleString('en-US'), s.heats.length, timestamp(s.latest_overflow_at, s.timezone_offset_minutes).slice(11) || '-',
        ]], [154, 112, 106, 132], 244);
        this.heading('时段分布', 'Hourly Distribution', 323);
        this.hourly(s.hourly);
        const peak = Math.max(0, ...s.hourly);
        const hour = s.hourly.indexOf(peak);
        let y = 547;
        y = this.note(peak ? `峰值 ${hour.toString().padStart(2, '0')}:00 至 ${(hour + 1).toString().padStart(2, '0')}:00，共 ${peak} 次。`
            : '已读取的小时统计中没有溢渣事件。', peak ? `Peak recorded hour: ${hour}:00-${hour + 1}:00, ${peak} episodes.`
            : 'No overflow episodes in the recorded hourly statistics.', y);
        y = this.note(`逐炉报告另计 ${s.heats.reduce((n, h) => n + h.overflow_events, 0)} 条事件；未知等级 ${s.episodes.unknown} 次。`,
            `Session events are counted separately. Daily unknown-grade episodes: ${s.episodes.unknown}.`, y);
        y = this.note('小时值 0 可能包含未到时段或无有效采集的区间；不证明该时段没有溢渣。',
            'Zero bins may include future hours or gaps in capture coverage; zero does not establish absence of overflow.', y);
        if (s.date === timestamp(Date.now() / 1000, s.timezone_offset_minutes).slice(0, 10)) {
            y = this.note('当日统计截至数据快照时间，尚非全天汇总。', 'In-progress day: statistics are as of the snapshot time.', y, 8);
        }
        this.note(`数据快照 ${timestamp(s.captured_at, s.timezone_offset_minutes)}（${timezone(s.timezone_offset_minutes)}）`,
            'Source: Program Runner statistics export.', Math.max(y, 705), 8);
    }
    hourly(values: number[]) {
        const max = Math.max(1, ...values);
        const scale = Math.max(100, Math.ceil(max / 100) * 100);
        const x0 = LEFT + 25, base = 515, width = WIDTH - 30, height = 130;
        for (let i = 0; i <= 4; i++) {
            const y = base - height * i / 4;
            this.doc.setDrawColor('#D6E2EA'); this.doc.setLineWidth(0.35); this.doc.line(x0, y, x0 + width, y);
            this.text(Math.round(scale * i / 4), x0 - 6, y - 4, 6.5, GRAY, 'right');
        }
        const slot = width / 24;
        values.slice(0, 24).forEach((value, hour) => {
            const x = x0 + hour * slot + 2, h = height * value / scale;
            this.doc.setFillColor(value === max ? BLUE : '#6D99BC');
            if (value) this.doc.rect(x, base - h, slot - 4, h, 'F');
            this.text(hour.toString().padStart(2, '0'), x + (slot - 4) / 2, 523, 6.5, GRAY, 'center');
            if (value) this.text(value, x + (slot - 4) / 2, base - h - 12, 6.5, GRAY, 'center');
        });
    }
    sessions(s: ComputeProgramOverflowStatistics, heats: ComputeProgramOverflowStatistics['heats'], index: number, count: number) {
        this.page(s.date, '逐炉统计', 'TILT SESSION STATISTICS');
        this.text(`${s.date} | ${s.heats.length} tilt sessions | ${index + 1} / ${count} | ${timezone(s.timezone_offset_minutes)}`, LEFT, 123, 8, GRAY);
        this.table([['全日会话事件', 'Daily session events'], ['小 / 中 / 大 / 未知', 'Small / Medium / Large / Unknown'],
            ['累计溢渣时长', 'Total overflow duration']], [[s.heats.reduce((n, h) => n + h.overflow_events, 0),
            ['small', 'medium', 'large', 'unknown'].map(level => s.heats.reduce((n, h) => n + h.levels[level], 0)).join(' / '),
            `${s.heats.reduce((n, h) => n + h.total_overflow_duration_seconds, 0).toFixed(1)} s`]], [126, 189, 189], 155);
        const y = this.table([['序号', 'No.'], ['开始 / 结束', 'Start / End'], ['时长', 'mm:ss'], ['次数', 'Events'],
            ['小 / 中 / 大 / 未知', 'S / M / L / U'], ['累计', 'Total s'], ['最长', 'Max s'], ['峰值强度', 'Peak intensity']],
        heats.map(h => [h.sequence.toString().padStart(3, '0'), `${timestamp(h.start_at, s.timezone_offset_minutes).slice(11)}\n${timestamp(h.end_at, s.timezone_offset_minutes).slice(11)}`,
            duration(h.duration_seconds), h.overflow_events,
            `${h.levels.small} / ${h.levels.medium} / ${h.levels.large} / ${h.levels.unknown}`,
            h.total_overflow_duration_seconds.toFixed(1), h.max_event_duration_seconds.toFixed(1), h.max_overflow_intensity.toFixed(3)]),
        [35, 84, 49, 40, 86, 57, 57, 96], 232);
        this.note(heats.length ? '序号为倾炉会话编号，不替代生产炉号；强度未附物理单位，保留原值。' : '该日期没有炉次报告。',
            heats.length ? 'Numbers identify tilt sessions, not production heat IDs. Intensity has no supplied physical unit.' : 'No session reports for this date.', y + 12, 8);
        this.note(`全日会话相机丢帧合计 ${s.heats.reduce((n, h) => n + h.camera_drops, 0)}；不证明全天视频链路完整。`,
            'Reported camera drops cover these session records; they do not establish full-day video completeness.', Math.max(y + 44, 710), 8);
    }
    definitions(s: ComputeProgramOverflowStatistics) {
        this.page(s.date, '重点事件与统计说明', 'KEY EVENTS AND STATISTICAL NOTES');
        this.heading('持续时间最长的十条事件', 'Ten Longest Events', 130);
        const events = s.heats.flatMap(h => h.events.map(event => ({...event, sequence: h.sequence})))
            .sort((a, b) => b.duration_seconds - a.duration_seconds).slice(0, 10);
        const levels = {small: '小 / Small', medium: '中 / Medium', large: '大 / Large', unknown: '未知 / Unknown'};
        let y = this.table([['序号', 'Session'], ['开始', 'Start'], ['结束', 'End'], ['时长', 'Duration s'],
            ['等级', 'Grade'], ['峰值强度', 'Peak intensity']], events.map(e => [e.sequence.toString().padStart(3, '0'),
            timestamp(e.start_at, s.timezone_offset_minutes).slice(11), timestamp(e.end_at, s.timezone_offset_minutes).slice(11),
            e.duration_seconds.toFixed(2), levels[e.level] || levels.unknown, e.max_intensity.toFixed(3)]), [46, 94, 94, 75, 99, 96], 161, 23);
        if (!events.length) y = this.note('该日期没有炉次事件明细。', 'No session event details for this date.', y + 8);
        y = this.heading('统计口径与来源', 'Definitions and Source', y + 17);
        y = this.note(`每日汇总 ${total(s.episodes)} 次：连续溢渣帧合并为一次，按最高等级归类；小时分布沿用此口径。`,
            'Daily episodes merge consecutive overflow frames and use the peak grade. Hourly bins use the same basis.', y);
        y = this.note(`逐炉报告 ${s.heats.reduce((n, h) => n + h.overflow_events, 0)} 条：来自会话结果文件的事件清单。两套统计独立计算，不相加、不互相替代。`,
            'Session events come from individual result files. The two datasets are independent and are not added or substituted.', y);
        y = this.note('采集覆盖、误报漏报、告警及 PLC 对应不在本次数据中；本报告不作生产放行结论。',
            'Capture coverage, detection accuracy and alarm/PLC correlation are not included. This report does not authorize production release.', y, 8);
        this.note(`导出时间 ${timestamp(Date.now() / 1000, s.timezone_offset_minutes)}（${timezone(s.timezone_offset_minutes)}）`,
            'Source: Program Runner statistics export.', Math.max(y + 8, 704), 8);
    }
    unavailable(day: StatisticsExportDay) {
        this.page(day.date, '每日统计报告', 'DAILY STATISTICS REPORT');
        this.heading(day.statistics ? '无有效记录' : '读取失败', day.statistics ? 'No valid records' : 'Read failed', 154);
        this.note(day.statistics ? '该日期没有可用统计记录，未将缺失数据记为零。' : `该日期统计读取失败：${clean(day.error || '未知错误')}`,
            day.statistics ? 'No valid records for this date. Missing data is not recorded as zero.' : 'Statistics could not be read for this date. No totals are reported.', 196);
    }
    finish(): Blob {
        this.pageDates.forEach((date, index) => {
            this.doc.setPage(index + 1); this.rule(752);
            this.text(`${date} | Daily report`, LEFT, 766, 7.5, GRAY);
            this.text(`${index + 1} / ${this.pageDates.length}`, LEFT + WIDTH, 766, 8, BLUE, 'right');
        });
        return this.doc.output('blob');
    }
}

export async function statisticsPdf(nodeName: string, programId: string, days: StatisticsExportDay[], signal: AbortSignal): Promise<Blob> {
    aborted(signal);
    const report = new DailyReport(clean(nodeName), clean(programId), await loadFont(signal));
    for (const day of days) {
        aborted(signal);
        const s = day.statistics;
        if (!s || !statisticsHasRecords(s)) report.unavailable(day);
        else {
            report.overview(s);
            const count = Math.max(1, Math.ceil(s.heats.length / 15));
            for (let i = 0; i < count; i++) {
                aborted(signal);
                report.sessions(s, s.heats.slice(i * 15, (i + 1) * 15), i, count);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            report.definitions(s);
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    aborted(signal);
    return report.finish();
}
