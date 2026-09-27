import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import JSZip from 'jszip';
import {ComputeClusterService, ComputeProgramOverflowStatistics} from '../../../services/ComputeClusterService';
import {ProgramStatisticsExport} from '../ProgramStatisticsExport';
import {statisticsExportDates, statisticsExportFiles} from '../statisticsExport';

const createObjectURL = jest.fn<string, [Blob]>(() => 'blob:statistics-export');
const revokeObjectURL = jest.fn();
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
beforeAll(() => { URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL; });
afterAll(() => { URL.createObjectURL = originalCreateObjectURL; URL.revokeObjectURL = originalRevokeObjectURL; });

const statistics: ComputeProgramOverflowStatistics = {
    schema_version: 'runtime.program-overflow-statistics.v1',
    program_id: 'dlk-overflow', date: '2026-09-24', timezone_offset_minutes: 480,
    captured_at: 1790208000, total_frames: 100, overflow_frames: 10,
    episodes: {small: 1, medium: 0, large: 0, unknown: 0},
    hourly: Array(24).fill(0), latest_overflow_at: 1790208000,
    heats: [{
        heat_id: '001', sequence: 1, label: '出钢', start_at: 1790208000, end_at: 1790208005,
        duration_seconds: 5, overflow_events: 1, levels: {small: 1, medium: 0, large: 0, unknown: 0},
        total_overflow_duration_seconds: 0.5, max_event_duration_seconds: 0.5,
        avg_overflow_intensity: 0.1, max_overflow_intensity: 0.2, camera_drops: 0, result_folder: 'runs/day,"one"',
        events: [{start_at: 1790208000, end_at: 1790208000.5, duration_seconds: 0.5,
            level: 'small', max_intensity: 0.2, overflow_ratio: 0.1}],
    }],
};
const props = {
    nodeId: 'test-node', nodeName: 'AIPACK-07', programId: 'dlk-overflow',
    date: '2026-09-24', today: '2026-09-25', zh: true, onOpen: jest.fn(),
};
const open = () => {
    const rendered = render(<ProgramStatisticsExport {...props}/>);
    fireEvent.click(screen.getByRole('button', {name: '导出统计'}));
    return rendered;
};

afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); jest.useRealTimers(); });

it.each([true, false])('opens the date range from a text-only export button (zh=%s)', zh => {
    render(<ProgramStatisticsExport {...props} zh={zh}/>);
    const button = screen.getByRole('button', {name: zh ? '导出统计' : 'Export statistics'});
    expect(button).toHaveTextContent(zh ? '导出' : 'Export');
    expect(button.querySelector('svg')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByLabelText(zh ? '开始日期' : 'Start date')).toHaveValue(props.date);
    expect(screen.getByLabelText(zh ? '结束日期' : 'End date')).toHaveValue(props.date);
});

it('validates inclusive calendar dates, leap days, future dates and bounded ranges', () => {
    expect(statisticsExportDates('2024-02-28', '2024-03-01', props.today, true))
        .toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
    expect(statisticsExportDates(props.date, props.date, props.today, true)).toEqual([props.date]);
    for (const [start, end] of [['2026-02-30', '2026-03-01'], ['2026-09-25', '2026-09-24'],
        ['2026-09-26', '2026-09-26'], ['2024-01-01', '2026-09-24'], ['', props.date]]) {
        expect(() => statisticsExportDates(start, end, props.today, true)).toThrow();
    }
});

it('writes timezone-correct CSV, escapes formulas and keeps unavailable dates blank', () => {
    const files = statisticsExportFiles('=unsafe,"node"', 'dlk-overflow', [
        {date: props.date, statistics},
        {date: '2026-09-23', statistics: {...statistics, total_frames: 0, heats: [], episodes: {small: 0, medium: 0, large: 0, unknown: 0}}},
        {date: '2026-09-22', error: '+bad\nerror'},
    ], true);
    expect(Object.keys(files)).toHaveLength(5);
    expect(files['每日汇总.csv']).toMatch(/^\uFEFF/);
    expect(files['每日汇总.csv']).toContain(`"'=unsafe,""node"""`);
    expect(files['每日汇总.csv']).toContain(`"'+bad\nerror"`);
    expect(files['每日汇总.csv'].split('\r\n')[2]).toContain('"无有效记录"');
    expect(files['每日汇总.csv'].split('\r\n')[2]).toMatch(/(?:,""){9}$/);
    const localTime = new Date((statistics.captured_at + 480 * 60) * 1000).toISOString().slice(0, 23).replace('T', ' ');
    expect(files['炉次明细.csv']).toContain(localTime);
    expect(files['炉次明细.csv']).toContain('"runs/day,""one"""');
    expect(files['溢渣明细.csv']).toContain('"0.5","small","0.2","0.1"');
    const zeroDay = statisticsExportFiles('node', 'dlk-overflow', [{date: props.date,
        statistics: {...statistics, heats: [], episodes: {small: 0, medium: 0, large: 0, unknown: 0}}}], false);
    expect(zeroDay['daily.csv']).toContain('"Read"');
    expect(zeroDay['daily.csv']).not.toContain('No records');
});

it('defaults to the selected day and exports a range sequentially with failure and empty markers', async () => {
    let completeFirst: (value: ComputeProgramOverflowStatistics) => void;
    const request = jest.spyOn(ComputeClusterService, 'programOverflowStatistics').mockImplementation((_, __, date, offset) => {
        if (date === '2026-09-22') return new Promise(resolve => { completeFirst = resolve; });
        if (date === '2026-09-23') return Promise.resolve({...statistics, date, timezone_offset_minutes: offset,
            total_frames: 0, heats: [], episodes: {small: 0, medium: 0, large: 0, unknown: 0}});
        return Promise.reject(new Error('HTTP 503'));
    });
    open();
    expect(screen.getByLabelText('开始日期')).toHaveValue(props.date);
    expect(screen.getByLabelText('结束日期')).toHaveValue(props.date);
    expect(props.onOpen).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('开始日期'), {target: {value: '2026-09-22'}});
    fireEvent.click(screen.getByRole('button', {name: '导出', exact: true}));
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('开始日期')).toBeDisabled();
    await act(async () => completeFirst({...statistics, date: '2026-09-22',
        timezone_offset_minutes: -new Date('2026-09-22T12:00:00').getTimezoneOffset()}));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(request.mock.calls.map(call => call[2])).toEqual(['2026-09-22', '2026-09-23', '2026-09-24']);
    expect(screen.getByRole('status')).toHaveTextContent('已生成 3 天；无记录 1 天，读取失败 1 天');
    expect(screen.getByRole('link', {name: '下载文件'})).toHaveAttribute('download', 'AIPACK-07_overflow_2026-09-22_2026-09-24.zip');
    const zip = await JSZip.loadAsync(createObjectURL.mock.calls[0][0]);
    expect(Object.keys(zip.files)).toHaveLength(5);
    expect(await zip.file('每日汇总.csv').async('string')).toContain('"读取失败","HTTP 503"');
    expect(await zip.file('炉次明细.csv').async('string')).toContain('"001"');
    fireEvent.change(screen.getByLabelText('开始日期'), {target: {value: props.date}});
    expect(screen.queryByRole('link', {name: '下载文件'})).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:statistics-export');
});

it('exports the selected day without additional date requests', async () => {
    const request = jest.spyOn(ComputeClusterService, 'programOverflowStatistics')
        .mockImplementation((_, __, date, offset) => Promise.resolve({...statistics, date, timezone_offset_minutes: offset}));
    open();
    fireEvent.click(screen.getByRole('button', {name: '导出', exact: true}));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][2]).toBe(props.date);
    expect(screen.getByRole('link', {name: '下载文件'})).toHaveAttribute('download', 'AIPACK-07_overflow_2026-09-24_2026-09-24.zip');
    expect(screen.getByRole('status')).toHaveTextContent('已生成 1 天；无记录 0 天，读取失败 0 天');
    fireEvent.click(screen.getByRole('button', {name: '取消'}));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:statistics-export');
});

it('marks a timed-out day and continues to the next day', async () => {
    const request = jest.spyOn(ComputeClusterService, 'programOverflowStatistics').mockImplementation((_, __, date, offset, signal) =>
        date === '2026-09-23'
            ? new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
            : Promise.resolve({...statistics, date, timezone_offset_minutes: offset}));
    open();
    fireEvent.change(screen.getByLabelText('开始日期'), {target: {value: '2026-09-23'}});
    jest.useFakeTimers();
    fireEvent.click(screen.getByRole('button', {name: '导出', exact: true}));
    await act(async () => { jest.advanceTimersByTime(30000); });
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    jest.useRealTimers();
    expect(request.mock.calls.map(call => call[2])).toEqual(['2026-09-23', '2026-09-24']);
    const zip = await JSZip.loadAsync(createObjectURL.mock.calls[0][0]);
    expect(await zip.file('每日汇总.csv').async('string')).toContain('"读取失败","读取超时"');
});

it.each(['cancel', 'unmount'])('aborts requests and suppresses download on %s', async action => {
    let signal: AbortSignal;
    jest.spyOn(ComputeClusterService, 'programOverflowStatistics').mockImplementation((_, __, ___, ____, current) =>
        new Promise((resolve, reject) => {
            signal = current;
            current.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }));
    const rendered = open();
    fireEvent.click(screen.getByRole('button', {name: '导出', exact: true}));
    await act(async () => {
        if (action === 'unmount') rendered.unmount();
        else fireEvent.click(screen.getByRole('button', {name: '取消'}));
    });
    expect(signal.aborted).toBe(true);
    expect(createObjectURL).not.toHaveBeenCalled();
});

it('marks mismatched responses as failed instead of exporting a different day', async () => {
    jest.spyOn(ComputeClusterService, 'programOverflowStatistics').mockResolvedValue({...statistics, date: '2026-09-01'});
    open();
    fireEvent.click(screen.getByRole('button', {name: '导出', exact: true}));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent('读取失败 1 天');
    const zip = await JSZip.loadAsync(createObjectURL.mock.calls[0][0]);
    const overview = await zip.file('导出概览.csv').async('string');
    expect(overview).toContain('"0","0","1","","","","","","",""');
});
