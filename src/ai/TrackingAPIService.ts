/**
 * TrackingAPIService — streams per-frame masks from backend /track (NDJSON over HTTP).
 *
 * Uses fetch() + a ReadableStream reader (no axios) because axios buffers the
 * whole response before resolving. One POST per tracking run; the caller gets
 * an AbortController to cancel mid-stream.
 */
import { getDefaultBackendBase } from '../utils/DefaultBackendUrl';

export type TrackFrameResult = {
    frame_idx: number;
    mask: [number, number][]; // polygon vertices in image-space pixels
    area: number;
    confidence: number;
};

export type StreamTrackParams = {
    sessionId: string;
    startFrame: number;
    endFrame: number;
    bbox: [number, number, number, number]; // x1,y1,x2,y2 in image-space
    modelName: string;
};

export type StreamTrackCallbacks = {
    onFrame: (frame: TrackFrameResult) => void;
    onDone: (total: number) => void;
    onError: (err: Error) => void;
};

export class TrackingAPIService {
    /** Start a tracking stream. Returns an AbortController so caller can cancel. */
    public static streamTrack(
        params: StreamTrackParams,
        cb: StreamTrackCallbacks,
    ): AbortController {
        const controller = new AbortController();
        const url = `${getDefaultBackendBase()}/track`;

        const run = async () => {
            let response: Response;
            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        session_id: params.sessionId,
                        start_frame: params.startFrame,
                        end_frame: params.endFrame,
                        prompt: { bbox: params.bbox },
                        model: params.modelName,
                    }),
                });
            } catch (e: any) {
                if (e?.name !== 'AbortError') cb.onError(e as Error);
                return;
            }

            if (!response.ok || !response.body) {
                const text = await response.text().catch(() => '');
                cb.onError(new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`));
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });

                    let newlineIdx;
                    while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
                        const line = buffer.slice(0, newlineIdx).trim();
                        buffer = buffer.slice(newlineIdx + 1);
                        if (!line) continue;
                        let msg: any;
                        try { msg = JSON.parse(line); }
                        catch {
                            if (line.startsWith('{')) {
                                cb.onError(new Error(`Malformed tracking response: ${line.slice(0, 100)}`));
                                return;
                            }
                            continue;
                        }
                        if (msg.error) { cb.onError(new Error(msg.error)); return; }
                        if (msg.done) { cb.onDone(msg.total ?? 0); return; }
                        if (typeof msg.frame_idx === 'number') {
                            cb.onFrame(msg as TrackFrameResult);
                        }
                    }
                }
                // Flush any final line without newline
                const tail = buffer.trim();
                if (tail) {
                    try {
                        const msg = JSON.parse(tail);
                        if (msg.error) { cb.onError(new Error(msg.error)); return; }
                        if (msg.done) cb.onDone(msg.total ?? 0);
                    } catch { /* ignore */ }
                }
            } catch (e: any) {
                if (e?.name !== 'AbortError') cb.onError(e as Error);
            }
        };

        run();
        return controller;
    }
}
