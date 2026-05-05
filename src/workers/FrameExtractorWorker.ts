/**
 * FrameExtractorWorker
 *
 * Unzips a frame-batch ArrayBuffer off the main thread (jsZip in worker).
 *
 * Protocol:
 *   in  : { id: number; buffer: ArrayBuffer }   (buffer is transferred)
 *   out : { id: number; ok: true; entries: { name: string; blob: Blob }[] }
 *       | { id: number; ok: false; error: string }
 */
import JSZip from 'jszip';

interface InMessage {
    id: number;
    buffer: ArrayBuffer;
}

interface OutMessageOk {
    id: number;
    ok: true;
    entries: { name: string; blob: Blob }[];
}

interface OutMessageErr {
    id: number;
    ok: false;
    error: string;
}

self.onmessage = async (ev: MessageEvent<InMessage>) => {
    const { id, buffer } = ev.data;
    try {
        const zip = await JSZip.loadAsync(buffer);
        const names = Object.keys(zip.files).filter(n => n.endsWith('.jpg')).sort();
        const entries: { name: string; blob: Blob }[] = [];
        for (const name of names) {
            const blob = await zip.files[name].async('blob');
            entries.push({ name, blob });
        }
        const out: OutMessageOk = { id, ok: true, entries };
        (self as any).postMessage(out);
    } catch (err) {
        const out: OutMessageErr = {
            id,
            ok: false,
            error: (err as Error)?.message || String(err),
        };
        (self as any).postMessage(out);
    }
};

export {};
