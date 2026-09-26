import {ComputeProgramOverflowStatistics} from '../../services/ComputeClusterService';

export type StatisticsExportDay = {
    date: string;
    statistics?: ComputeProgramOverflowStatistics;
    error?: string;
};

export const statisticsExportDates = (start: string, end: string, today: string, zh: boolean): string[] => {
    const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
        && Number.isFinite(Date.parse(value))
        && new Date(value).toISOString().slice(0, 10) === value;
    if (!valid(start) || !valid(end) || start > end || end > today) {
        throw new Error(zh ? '请选择有效的起止日期，结束日期不能晚于今天。' : 'Choose valid dates, ending no later than today.');
    }
    const count = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    if (count > 366) throw new Error(zh ? '一次最多导出 366 天。' : 'Export up to 366 days at a time.');
    return Array.from({length: count}, (_, index) =>
        new Date(Date.parse(start) + index * 86400000).toISOString().slice(0, 10));
};

export const statisticsHasRecords = (value: ComputeProgramOverflowStatistics): boolean =>
    value.total_frames > 0 || value.heats.length > 0 || Object.values(value.episodes).some(count => count > 0);

const csv = (rows: (string | number | null)[][]): string => '\uFEFF' + rows.map(row => row.map(value => {
    let text = value === null ? '' : String(value);
    // Keep names and error messages from being interpreted as spreadsheet formulas.
    if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}).join(',')).join('\r\n') + '\r\n';

const timestamp = (seconds: number | null, offset: number): string => seconds === null
    ? '' : new Date((seconds + offset * 60) * 1000).toISOString().slice(0, 23).replace('T', ' ');

export const statisticsExportFiles = (
    nodeName: string, programId: string, days: StatisticsExportDay[], zh: boolean,
): Record<string, string> => {
    const t = (cn: string, en: string) => zh ? cn : en;
    const valid = days.filter(day => day.statistics && statisticsHasRecords(day.statistics));
    const missing = days.filter(day => day.statistics && !statisticsHasRecords(day.statistics)).length;
    const failed = days.filter(day => !day.statistics).length;
    const sum = (get: (value: ComputeProgramOverflowStatistics) => number) =>
        valid.length ? valid.reduce((total, day) => total + get(day.statistics), 0) : null;
    const prefix = [t('机器', 'Machine'), t('程序', 'Program'), t('日期', 'Date')];
    const levels = [t('小溢渣', 'Small'), t('中溢渣', 'Medium'), t('大溢渣', 'Large'), t('未知等级', 'Unknown level')];
    const overview = [
        [t('机器', 'Machine'), t('程序', 'Program'), t('开始日期', 'Start date'), t('结束日期', 'End date'),
            t('有效日期数', 'Recorded days'), t('无记录日期数', 'Days without records'), t('失败日期数', 'Failed days'),
            t('有效日期溢渣次数', 'Episodes on recorded days'), ...levels,
            t('溢渣帧', 'Overflow frames'), t('总帧数', 'Total frames'), t('导出时间 UTC', 'Exported at UTC')],
        [nodeName, programId, days[0].date, days[days.length - 1].date, valid.length, missing, failed,
            sum(s => Object.values(s.episodes).reduce((a, b) => a + b, 0)),
            sum(s => s.episodes.small), sum(s => s.episodes.medium), sum(s => s.episodes.large),
            sum(s => s.episodes.unknown), sum(s => s.overflow_frames), sum(s => s.total_frames), new Date().toISOString()],
    ];
    const daily: (string | number | null)[][] = [[...prefix, t('读取状态', 'Read status'), t('错误', 'Error'),
        t('时区偏移(分钟)', 'UTC offset (minutes)'), t('采集时间', 'Captured at'), t('溢渣次数', 'Episodes'),
        ...levels, t('溢渣帧', 'Overflow frames'), t('总帧数', 'Total frames'), t('炉次数', 'Heats'),
        t('最近溢渣', 'Latest overflow')]];
    const hourly: (string | number | null)[][] = [[...prefix, t('小时', 'Hour'), t('溢渣次数', 'Episodes')]];
    const heats: (string | number | null)[][] = [[...prefix, t('炉次标识', 'Heat ID'), t('炉次序号', 'Sequence'),
        t('开始时间', 'Started at'), t('结束时间', 'Ended at'), t('时长(秒)', 'Duration (s)'),
        t('溢渣次数', 'Episodes'), ...levels, t('累计溢渣(秒)', 'Overflow duration (s)'),
        t('最长溢渣(秒)', 'Longest episode (s)'), t('平均强度', 'Mean intensity'), t('最大强度', 'Peak intensity'),
        t('相机丢帧', 'Camera drops'), t('结果目录', 'Result directory')]];
    const events: (string | number | null)[][] = [[...prefix, t('炉次标识', 'Heat ID'),
        t('开始时间', 'Started at'), t('结束时间', 'Ended at'), t('时长(秒)', 'Duration (s)'),
        t('等级', 'Level'), t('最大强度', 'Peak intensity'), t('溢渣比例', 'Overflow ratio')]];
    for (const day of days) {
        const s = day.statistics;
        const recorded = s && statisticsHasRecords(s);
        daily.push([nodeName, programId, day.date,
            s ? recorded ? t('已读取', 'Read') : t('无有效记录', 'No records') : t('读取失败', 'Failed'),
            day.error || '', s?.timezone_offset_minutes ?? null,
            s ? timestamp(s.captured_at, s.timezone_offset_minutes) : '',
            ...(recorded ? [
                Object.values(s.episodes).reduce((a, b) => a + b, 0), s.episodes.small, s.episodes.medium,
                s.episodes.large, s.episodes.unknown, s.overflow_frames, s.total_frames, s.heats.length,
                timestamp(s.latest_overflow_at, s.timezone_offset_minutes),
            ] : Array(9).fill(null)),
        ]);
        if (!recorded) continue;
        s.hourly.forEach((count, hour) => hourly.push([nodeName, programId, day.date, hour, count]));
        for (const heat of s.heats) {
            const id = [nodeName, programId, day.date, heat.heat_id];
            heats.push([...id, heat.sequence, timestamp(heat.start_at, s.timezone_offset_minutes),
                timestamp(heat.end_at, s.timezone_offset_minutes), heat.duration_seconds, heat.overflow_events,
                heat.levels.small, heat.levels.medium, heat.levels.large, heat.levels.unknown,
                heat.total_overflow_duration_seconds, heat.max_event_duration_seconds, heat.avg_overflow_intensity,
                heat.max_overflow_intensity, heat.camera_drops, heat.result_folder]);
            heat.events.forEach(event => events.push([...id, timestamp(event.start_at, s.timezone_offset_minutes),
                timestamp(event.end_at, s.timezone_offset_minutes), event.duration_seconds, event.level,
                event.max_intensity, event.overflow_ratio]));
        }
    }
    return {
        [t('导出概览.csv', 'overview.csv')]: csv(overview),
        [t('每日汇总.csv', 'daily.csv')]: csv(daily),
        [t('时段分布.csv', 'hourly.csv')]: csv(hourly),
        [t('炉次明细.csv', 'heats.csv')]: csv(heats),
        [t('溢渣明细.csv', 'events.csv')]: csv(events),
    };
};
