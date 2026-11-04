import {readFileSync} from 'fs';
import path from 'path';
import {statisticsPdf} from '../statisticsPdf';
import {ComputeProgramOverflowStatistics} from '../../../services/ComputeClusterService';

jest.mock('jspdf', () => {
    const {TextEncoder, TextDecoder} = jest.requireActual('util');
    Object.assign(global, {TextEncoder, TextDecoder});
    return jest.requireActual('jspdf');
});

const originalFetch = global.fetch;
const font = readFileSync(path.join(process.cwd(), 'public/fonts/daily-report-sans.ttf'));
const fetchFont = jest.fn();
beforeAll(() => { global.fetch = fetchFont; });
afterAll(() => { global.fetch = originalFetch; });
beforeEach(() => fetchFont.mockResolvedValue({ok: true, arrayBuffer: async () =>
    font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength)}));

const statistics: ComputeProgramOverflowStatistics = {
    schema_version: 'runtime.program-overflow-statistics.v1', program_id: 'dlk-overflow',
    date: '2026-10-15', timezone_offset_minutes: 480, captured_at: 1792022400,
    total_frames: 100, overflow_frames: 10, episodes: {small: 1, medium: 0, large: 0, unknown: 0},
    hourly: [1, ...Array(23).fill(0)], latest_overflow_at: 1792022400,
    heats: [{heat_id: '001', sequence: 1, label: '出钢', start_at: 1792022400, end_at: 1792022405,
        duration_seconds: 5, overflow_events: 1, levels: {small: 1, medium: 0, large: 0, unknown: 0},
        total_overflow_duration_seconds: 0.5, max_event_duration_seconds: 0.5,
        avg_overflow_intensity: 0.1, max_overflow_intensity: 0.2, camera_drops: 0, result_folder: 'run-001',
        events: [{start_at: 1792022400, end_at: 1792022400.5, duration_seconds: 0.5,
            level: 'small', max_intensity: 0.2, overflow_ratio: 0.1}]}],
};

const contents = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer).toString('latin1'));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
});

it('aborts before loading fonts and reports a font download failure', async () => {
    const signal = new AbortController(); signal.abort();
    await expect(statisticsPdf('AIPACK-07', 'dlk-overflow', [], signal.signal)).rejects.toHaveProperty('name', 'AbortError');
    expect(fetchFont).not.toHaveBeenCalled();
    fetchFont.mockResolvedValueOnce({ok: false});
    await expect(statisticsPdf('AIPACK-07', 'dlk-overflow', [{date: statistics.date, statistics}],
        new AbortController().signal)).rejects.toThrow('Could not load report font');
    fetchFont.mockResolvedValueOnce({ok: true, arrayBuffer: async () => new Uint8Array([60, 104, 116, 109, 108]).buffer});
    await expect(statisticsPdf('AIPACK-07', 'dlk-overflow', [{date: statistics.date, statistics}],
        new AbortController().signal)).rejects.toThrow('Invalid report font');
});

it('creates a real PDF with embedded Chinese text, paginated sessions and isolated missing dates', async () => {
    const many = {...statistics, heats: Array.from({length: 31}, (_, i) => ({...statistics.heats[0], sequence: i + 1}))};
    const empty = {...statistics, total_frames: 0, overflow_frames: 0, heats: [], episodes: {small: 0, medium: 0, large: 0, unknown: 0}};
    const blob = await statisticsPdf('AIPACK-07', 'dlk-overflow', [
        {date: statistics.date, statistics: many},
        {date: '2026-10-16', statistics: {...empty, date: '2026-10-16'}},
        {date: '2026-10-17', error: 'HTTP 503'},
    ], new AbortController().signal);
    expect(blob.type).toBe('application/pdf');
    const pdf = await contents(blob);
    expect(pdf).toMatch(/^%PDF-/);
    expect(pdf).toContain('/FontFile2');
    expect(pdf).toContain('/ToUnicode');
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(7);
});
