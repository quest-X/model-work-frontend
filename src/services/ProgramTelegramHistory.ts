export type TelegramRecord = {
    byteOffset: number;
    raw: string;
    value: Record<string, unknown>;
};

export type TelegramHistory = {
    start: number;
    size: number;
    pending: Uint8Array;
    records: TelegramRecord[];
    invalid: {byteOffset: number; raw: string}[];
    otherLines: number;
};

const PAGE_BYTES = 256 * 1024;

const rejectResponse = async (response: Response, message: string): Promise<never> => {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(message);
};

const validateRange = async (response: Response, previous?: TelegramHistory) => {
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
    if (!match) return rejectResponse(response, 'Missing or invalid Content-Range for telegram history');
    const [start, end, total] = match.slice(1).map(Number);
    const expectedStart = previous ? Math.max(0, previous.start - PAGE_BYTES) : Math.max(0, total - PAGE_BYTES);
    const expectedEnd = previous ? previous.start - 1 : total - 1;
    if (![start, end, total].every(Number.isSafeInteger) || start !== expectedStart || end !== expectedEnd
        || start < 0 || end < start || end >= total) {
        return rejectResponse(response, 'The returned telegram byte range is incorrect; refresh the history');
    }
    if (previous && total < previous.size) return rejectResponse(response, 'Telegram history was truncated; refresh the history');
    return {start, end, total};
};

const parseLines = (bytes: Uint8Array, start: number): Pick<TelegramHistory, 'pending' | 'records' | 'invalid' | 'otherLines'> => {
    const firstNewline = bytes.indexOf(10);
    const prefixLength = start === 0 ? 0 : firstNewline === -1 ? bytes.length : firstNewline + 1;
    const pending = bytes.slice(0, prefixLength);
    const records: TelegramRecord[] = [];
    const invalid: TelegramHistory['invalid'] = [];
    let otherLines = 0;
    const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
    let lineStart = prefixLength;
    for (let index = prefixLength; index <= bytes.length; index++) {
        if (index < bytes.length && bytes[index] !== 10) continue;
        const raw = decoder.decode(bytes.subarray(lineStart, index));
        const byteOffset = start + lineStart;
        lineStart = index + 1;
        if (!raw.trim()) continue;
        try {
            const value: unknown = JSON.parse(raw);
            if (value && typeof value === 'object' && !Array.isArray(value)
                && (value as Record<string, unknown>).src === 'ixcom') {
                records.push({byteOffset, raw, value: value as Record<string, unknown>});
            } else {
                otherLines++;
            }
        } catch {
            invalid.push({byteOffset, raw});
        }
    }
    return {pending, records, invalid, otherLines};
};

export const readTelegramHistory = async (
    url: string,
    previous?: TelegramHistory,
    signal?: AbortSignal,
): Promise<TelegramHistory> => {
    if (previous?.start === 0) return previous;
    const response = await fetch(url, {
        headers: {Range: previous ? `bytes=${Math.max(0, previous.start - PAGE_BYTES)}-${previous.start - 1}` : `bytes=-${PAGE_BYTES}`},
        cache: 'no-store',
        signal,
    });
    const contentRange = response.headers.get('Content-Range');
    if (!previous && response.status === 416 && contentRange === 'bytes */0') {
        await response.body?.cancel().catch(() => undefined);
        return {start: 0, size: 0, pending: new Uint8Array(), records: [], invalid: [], otherLines: 0};
    }
    if (response.status !== 206) {
        return rejectResponse(response, `Expected HTTP 206 for telegram history; received ${response.status}`);
    }
    const {start, end, total} = await validateRange(response, previous);
    const chunk = new Uint8Array(await response.arrayBuffer());
    if (signal?.aborted) throw new DOMException('The request was aborted', 'AbortError');
    if (chunk.length !== end - start + 1) throw new Error('Telegram history response byte length does not match Content-Range');
    const retained = previous ?? {pending: new Uint8Array(), records: [], invalid: [], otherLines: 0};
    const bytes = new Uint8Array(chunk.length + retained.pending.length);
    bytes.set(chunk);
    bytes.set(retained.pending, chunk.length);
    const parsed = parseLines(bytes, start);
    // shortcut: this snapshot assumes append-only files; refresh after same-length in-place rewrites.
    return {
        start,
        size: previous?.size ?? total,
        pending: parsed.pending,
        records: [...parsed.records, ...retained.records],
        invalid: [...parsed.invalid, ...retained.invalid],
        otherLines: parsed.otherLines + retained.otherLines,
    };
};

// Keep numeric spelling, duplicate keys and string escapes intact while adding indentation.
export const prettyTelegramJson = (raw: string): string => {
    const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/g) ?? [];
    let depth = 0;
    let output = '';
    tokens.forEach((token, index) => {
        if (token === '{' || token === '[') {
            depth++;
            output += token;
            if (tokens[index + 1] !== '}' && tokens[index + 1] !== ']') output += `\n${'  '.repeat(depth)}`;
        } else if (token === '}' || token === ']') {
            depth--;
            if (tokens[index - 1] !== '{' && tokens[index - 1] !== '[') output += `\n${'  '.repeat(depth)}`;
            output += token;
        } else if (token === ',') {
            output += `,\n${'  '.repeat(depth)}`;
        } else {
            output += token === ':' ? ': ' : token;
        }
    });
    return output;
};
