import {TextDecoder, TextEncoder} from 'util';
import {prettyTelegramJson, readTelegramHistory, TelegramHistory} from '../ProgramTelegramHistory';

const PAGE_BYTES = 256 * 1024;
const encoder = new TextEncoder();
const originalFetch = global.fetch;
const originalDecoder = global.TextDecoder;

const responseFor = (bytes: Uint8Array, start: number, end: number, total = bytes.length) => ({
    status: 206,
    headers: {get: () => `bytes ${start}-${end}/${total}`},
    body: {cancel: jest.fn().mockResolvedValue(undefined)},
    arrayBuffer: jest.fn().mockResolvedValue(bytes.slice(start, end + 1).buffer),
});

const serveFile = (getBytes: () => Uint8Array) => {
    global.fetch = jest.fn().mockImplementation((_url, init) => {
        const bytes = getBytes();
        const range = init.headers.Range as string;
        const match = /^bytes=(\d*)-(\d+)$/.exec(range);
        if (!match) throw new Error(`Unexpected range ${range}`);
        const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
        const end = match[1] ? Number(match[2]) : bytes.length - 1;
        return Promise.resolve(responseFor(bytes, start, end));
    });
};

beforeEach(() => {
    global.TextDecoder = TextDecoder as typeof global.TextDecoder;
});

afterEach(() => {
    global.fetch = originalFetch;
    global.TextDecoder = originalDecoder;
});

describe('readTelegramHistory', () => {
    it('reconstructs complete file order, counts, offsets and raw fields across backwards pages', async () => {
        const rows = [
            '',
            JSON.stringify({src: 'ixcom', frame_idx: 0, timestamp: '2026-10-11T00:00:00Z'}),
            '{bad json}\r',
            JSON.stringify({src: 'other', frame_idx: -1}),
            JSON.stringify({frame_idx: -2}),
            'null',
            '[]',
            '42',
            '  ',
            ...Array.from({length: 7500}, (_, index) => JSON.stringify({
                src: 'ixcom', frame_idx: index + 1, timestamp: `t-${index}`,
                nested: {raw: '电文中文原始字段', zero: 0, empty: null},
            }) + (index % 2 ? '\r' : '')),
            '{"src":"ixcom","frame_idx":7501,"timestamp":"last","unknown":[1,null,false]}',
        ];
        rows.splice(20, 0, rows[20]);
        const bytes = encoder.encode(rows.join('\n'));
        serveFile(() => bytes);
        const signal = new AbortController().signal;
        let history = await readTelegramHistory('/ixcom.jsonl', undefined, signal);
        expect(global.fetch).toHaveBeenNthCalledWith(1, '/ixcom.jsonl', {
            headers: {Range: `bytes=-${PAGE_BYTES}`}, cache: 'no-store', signal,
        });
        expect(history.start).toBeGreaterThan(0);
        expect(history.records.length).toBeLessThan(7502);
        while (history.start > 0) {
            const previous = history;
            const previousJSON = JSON.stringify(previous);
            history = await readTelegramHistory('/ixcom.jsonl', previous);
            expect(JSON.stringify(previous)).toBe(previousJSON);
            expect(global.fetch).toHaveBeenLastCalledWith('/ixcom.jsonl', expect.objectContaining({
                headers: {Range: `bytes=${Math.max(0, previous.start - PAGE_BYTES)}-${previous.start - 1}`},
            }));
        }
        let byteOffset = 0;
        const expected: {byteOffset: number; raw: string}[] = [];
        rows.forEach(raw => {
            if (raw.startsWith('{"src":"ixcom"')) expected.push({byteOffset, raw});
            byteOffset += encoder.encode(raw).length + 1;
        });
        expect(history.size).toBe(bytes.length);
        expect(history.pending).toHaveLength(0);
        expect(history.records.map(({byteOffset: offset, raw}) => ({byteOffset: offset, raw}))).toEqual(expected);
        expect(history.records).toHaveLength(7503);
        expect(history.otherLines).toBe(5);
        expect(history.records[0].value).toEqual({src: 'ixcom', frame_idx: 0, timestamp: '2026-10-11T00:00:00Z'});
        expect(history.records[history.records.length - 1].value).toEqual({
            src: 'ixcom', frame_idx: 7501, timestamp: 'last', unknown: [1, null, false],
        });
        expect(history.invalid).toEqual([{
            byteOffset: encoder.encode(rows.slice(0, 2).join('\n') + '\n').length, raw: '{bad json}\r',
        }]);
        const calls = jest.mocked(global.fetch).mock.calls.length;
        expect(await readTelegramHistory('/ixcom.jsonl', history)).toBe(history);
        expect(global.fetch).toHaveBeenCalledTimes(calls);
    });

    it('retains a long Chinese line through multiple byte boundaries without decoding fragments', async () => {
        const raw = JSON.stringify({src: 'ixcom', frame_idx: 9, payload: '汉'.repeat(PAGE_BYTES)});
        const bytes = encoder.encode(raw);
        serveFile(() => bytes);
        let history = await readTelegramHistory('/long.jsonl');
        expect(history.pending.length).toBe(PAGE_BYTES);
        expect(history.records).toHaveLength(0);
        expect(history.invalid).toHaveLength(0);
        while (history.start > 0) history = await readTelegramHistory('/long.jsonl', history);
        expect(history.records).toEqual([{byteOffset: 0, raw, value: JSON.parse(raw)}]);
        expect(history.invalid).toHaveLength(0);
    });

    it('joins CRLF when the suffix starts at LF and retains CR in raw text', async () => {
        const first = '{"src":"ixcom","frame_idx":1}';
        const prefix = '{"src":"ixcom","payload":"';
        const last = prefix + 'x'.repeat(PAGE_BYTES - 1 - prefix.length - 2) + '"}';
        const bytes = encoder.encode(first + '\r\n' + last);
        serveFile(() => bytes);
        const tail = await readTelegramHistory('/crlf.jsonl');
        expect(tail.pending).toEqual(new Uint8Array([10]));
        expect(tail.records.map(record => record.raw)).toEqual([last]);
        const full = await readTelegramHistory('/crlf.jsonl', tail);
        expect(full.records.map(record => record.raw)).toEqual([first + '\r', last]);
        expect(full.invalid).toHaveLength(0);
    });

    it('reports a malformed line only after its earlier bytes have been loaded', async () => {
        const first = '{"src":"ixcom","frame_idx":1}\n';
        const bad = '{"src":"ixcom","broken":"' + '汉'.repeat(PAGE_BYTES / 2);
        const last = '{"src":"ixcom","frame_idx":2}';
        const bytes = encoder.encode(first + bad + '\r\n' + last);
        serveFile(() => bytes);
        const tail = await readTelegramHistory('/bad-line.jsonl');
        expect(tail.invalid).toHaveLength(0);
        expect(tail.records.map(record => record.raw)).toEqual([last]);
        const history = await readTelegramHistory('/bad-line.jsonl', tail);
        expect(history.invalid).toEqual([{byteOffset: encoder.encode(first).length, raw: bad + '\r'}]);
        expect(history.records.map(record => record.value.frame_idx)).toEqual([1, 2]);
    });

    it.each(['', '\n', '\r\n'])('supports a short file with ending %j', async ending => {
        const raw = '{"src":"ixcom","frame_idx":1}';
        const bytes = encoder.encode(raw + ending);
        serveFile(() => bytes);
        const history = await readTelegramHistory('/short.jsonl');
        expect(history.start).toBe(0);
        expect(history.records.map(record => record.raw)).toEqual([raw + (ending === '\r\n' ? '\r' : '')]);
    });

    it('keeps the original snapshot size when new records are appended', async () => {
        const first = '{"src":"ixcom","frame_idx":1}\n';
        const middle = JSON.stringify({src: 'ixcom', frame_idx: 2, payload: 'x'.repeat(PAGE_BYTES)});
        let bytes = encoder.encode(first + middle + '\n');
        serveFile(() => bytes);
        let history = await readTelegramHistory('/growing.jsonl');
        const snapshotSize = bytes.length;
        bytes = encoder.encode(first + middle + '\n{"src":"ixcom","frame_idx":3}\n');
        while (history.start > 0) history = await readTelegramHistory('/growing.jsonl', history);
        expect(history.size).toBe(snapshotSize);
        expect(history.records.map(record => record.value.frame_idx)).toEqual([1, 2]);
    });

    it('accepts a confirmed empty file without reading an error response body', async () => {
        const response = responseFor(new Uint8Array(), 0, 0);
        response.status = 416;
        response.headers.get = () => 'bytes */0';
        global.fetch = jest.fn().mockResolvedValue(response);
        expect(await readTelegramHistory('/empty.jsonl')).toEqual({
            start: 0, size: 0, pending: new Uint8Array(), records: [], invalid: [], otherLines: 0,
        });
        expect(response.arrayBuffer).not.toHaveBeenCalled();
        expect(response.body.cancel).toHaveBeenCalledTimes(1);
    });

    it.each([
        [200, 'bytes 0-9/10'], [404, null], [416, 'bytes */10'],
        [206, null], [206, 'bytes 0-9/*'], [206, 'bytes 1-9/10'],
        [206, 'bytes 0-8/10'], [206, 'bytes 0-10/10'],
        [206, 'bytes 0-9007199254740992/9007199254740993'],
    ])('rejects status %s / Content-Range %s before reading the body', async (status, range) => {
        const response = {
            ...responseFor(new Uint8Array(10), 0, 9), status,
            headers: {get: () => range},
        };
        global.fetch = jest.fn().mockResolvedValue(response);
        await expect(readTelegramHistory('/wrong.jsonl')).rejects.toThrow();
        expect(response.body.cancel).toHaveBeenCalledTimes(1);
        expect(response.arrayBuffer).not.toHaveBeenCalled();
    });

    it('rejects a body length mismatch', async () => {
        global.fetch = jest.fn().mockResolvedValue(responseFor(new Uint8Array(4), 0, 9, 10));
        await expect(readTelegramHistory('/short-body.jsonl')).rejects.toThrow('byte length');
    });

    it('rejects truncation or shifted earlier pages without changing the previous state', async () => {
        const previous: TelegramHistory = {
            start: 12, size: PAGE_BYTES + 12, pending: new Uint8Array([1, 2]),
            records: [{byteOffset: 16, raw: '{"src":"ixcom"}', value: {src: 'ixcom'}}], invalid: [], otherLines: 0,
        };
        const snapshot = JSON.stringify(previous);
        for (const range of ['bytes 0-11/20', `bytes 1-11/${previous.size}`, 'bytes */0']) {
            const response = responseFor(new Uint8Array(12), 0, 11);
            response.headers.get = () => range;
            response.status = range === 'bytes */0' ? 416 : 206;
            global.fetch = jest.fn().mockResolvedValue(response);
            await expect(readTelegramHistory('/changed.jsonl', previous)).rejects.toThrow();
            expect(JSON.stringify(previous)).toBe(snapshot);
            expect(response.arrayBuffer).not.toHaveBeenCalled();
        }
    });

    it('propagates abort and fetch failures without mutating previous state', async () => {
        const previous: TelegramHistory = {start: 1, size: 2, pending: new Uint8Array([10]), records: [], invalid: [], otherLines: 0};
        const snapshot = JSON.stringify(previous);
        const controller = new AbortController();
        const response = responseFor(new Uint8Array([32]), 0, 0, 2);
        response.arrayBuffer.mockImplementation(async () => {
            controller.abort();
            return new Uint8Array([32]).buffer;
        });
        global.fetch = jest.fn().mockResolvedValue(response);
        await expect(readTelegramHistory('/aborted.jsonl', previous, controller.signal))
            .rejects.toMatchObject({name: 'AbortError'});
        global.fetch = jest.fn().mockRejectedValue(new Error('network unavailable'));
        await expect(readTelegramHistory('/failed.jsonl', previous)).rejects.toThrow('network unavailable');
        expect(JSON.stringify(previous)).toBe(snapshot);
    });

    it('rejects invalid UTF-8 instead of silently replacing original bytes', async () => {
        serveFile(() => new Uint8Array([123, 255, 125]));
        await expect(readTelegramHistory('/invalid-utf8.jsonl')).rejects.toThrow();
    });
});

describe('prettyTelegramJson', () => {
    it('preserves large numbers, decimal spelling, duplicate keys, strings and field order', () => {
        const raw = '{"src":"ixcom","n":90071992547409931234,"n":1.234567890123456789,"exp":1e+99,"neg":-0,"s":"a\\"b\\\\c:,{[汉]}","obj":{},"arr":[[],null,false]}';
        const pretty = prettyTelegramJson(raw);
        expect(pretty).toContain('"n": 90071992547409931234,\n  "n": 1.234567890123456789');
        expect(pretty).toContain('"exp": 1e+99');
        expect(pretty).toContain('"neg": -0');
        expect(pretty).toContain('"s": "a\\"b\\\\c:,{[汉]}"');
        expect(pretty).toContain('"obj": {}');
        expect(pretty).toContain('"arr": [\n    [],\n    null,\n    false\n  ]');
        expect(JSON.parse(pretty)).toEqual(JSON.parse(raw));
    });
});
