import {getEngineBaseUrl} from '../../../utils/DefaultBackendUrl';

export type InspectorSlot = 'detection' | 'segmentation';
export type CatalogDetail = 'stages' | 'all';
export type HeatmapKind = 'mean_abs' | 'max_abs' | 'eigen' | 'channel' | 'gradcam';
export type HeatmapPalette = 'turbo' | 'magma' | 'viridis' | 'inferno' | 'jet' | 'gray';

export interface SlotCapability {
    slot: InspectorSlot;
    state: 'ready' | 'not_loaded' | 'unsupported' | 'unavailable';
    model: string;
    runtime: string;
    family: string;
    supports_activations: boolean;
    supports_attribution: boolean;
    reason: string | null;
}

export interface InspectorStatus {
    status: 'ok';
    version: string;
    sessions: number;
    cache_bytes: number;
    limits: {
        max_upload_mb: number;
        max_layers: number;
        max_total_layers?: number;
        max_top_channels: number;
        max_map_side: number;
        batch_top_channels?: number;
        batch_map_side?: number;
        session_ttl_seconds: number;
        max_cache_mb: number;
    };
    slots: SlotCapability[];
}

export interface InspectorLayer {
    id: string;
    path: string;
    type: string;
    group: string;
    depth: number;
    parameters: number;
    default_selected: boolean;
}

export interface LayerCatalogResponse {
    status: 'success';
    slot: InspectorSlot;
    model: string;
    family: string;
    runtime: string;
    layers: InspectorLayer[];
    default_layer_ids: string[];
}

export interface ChannelResult {
    index: number;
    score: number;
}

export interface InspectionLayerResult {
    id: string;
    path: string;
    type: string;
    group: string;
    output_shape: number[];
    layout: string | null;
    status: 'ready' | 'unsupported' | 'error';
    reason: string | null;
    maps: string[];
    channels: ChannelResult[];
}

export interface InspectionPrediction {
    index: number;
    class_id: number;
    name: string;
    confidence: number;
    bbox: number[] | null;
}

export interface InspectionSession {
    status: 'success';
    id: string;
    slot: InspectorSlot;
    model: string;
    family: string;
    runtime: string;
    filename: string;
    original_size: number[];
    input_size: number[];
    created_at: number;
    expires_at: number;
    elapsed_ms: number;
    layers: InspectionLayerResult[];
    predictions: InspectionPrediction[];
    warnings: string[];
}

export class InspectorAPIError extends Error {
    public readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'InspectorAPIError';
        this.status = status;
    }
}

const readJson = async <T>(response: Response): Promise<T> => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = typeof body.detail === 'string' ? body.detail : `${response.status}`;
        throw new InspectorAPIError(detail, response.status);
    }
    return body as T;
};

const endpoint = (path: string): string =>
    `${getEngineBaseUrl()}/extensions/model-inspector${path}`;

export const ModelInspectorAPI = {
    async status(signal?: AbortSignal): Promise<InspectorStatus> {
        return readJson<InspectorStatus>(await fetch(endpoint('/status'), {signal}));
    },

    async layers(slot: InspectorSlot, detail: CatalogDetail, signal?: AbortSignal): Promise<LayerCatalogResponse> {
        const query = new URLSearchParams({slot, detail});
        return readJson<LayerCatalogResponse>(
            await fetch(`${endpoint('/layers')}?${query.toString()}`, {signal}),
        );
    },

    async createSession(
        file: File,
        slot: InspectorSlot,
        layerIds: string[],
        options: {imgsz: number; topK: number; maxSide: number},
        signal?: AbortSignal,
    ): Promise<InspectionSession> {
        const form = new FormData();
        form.append('file', file);
        form.append('slot', slot);
        form.append('layer_ids', layerIds.join(','));
        form.append('imgsz', String(options.imgsz));
        form.append('top_k', String(options.topK));
        form.append('max_side', String(options.maxSide));
        return readJson<InspectionSession>(
            await fetch(endpoint('/sessions'), {method: 'POST', body: form, signal}),
        );
    },

    async deleteSession(sessionId: string): Promise<void> {
        await fetch(endpoint(`/sessions/${encodeURIComponent(sessionId)}`), {
            method: 'DELETE',
            keepalive: true,
        }).catch(() => undefined);
    },

    async createAttribution(
        sessionId: string,
        layerId: string,
        classId: number,
        signal?: AbortSignal,
    ): Promise<void> {
        const response = await fetch(
            endpoint(`/sessions/${encodeURIComponent(sessionId)}/attribution`),
            {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({layer_id: layerId, class_id: classId}),
                signal,
            },
        );
        await readJson(response);
    },

    mapUrl(
        sessionId: string,
        layerId: string,
        options: {
            kind: HeatmapKind;
            palette: HeatmapPalette;
            channel?: number;
            classId?: number;
            revision?: number;
        },
    ): string {
        const query = new URLSearchParams({kind: options.kind, palette: options.palette});
        if (options.channel !== undefined) query.set('channel', String(options.channel));
        if (options.classId !== undefined) query.set('class_id', String(options.classId));
        if (options.revision !== undefined) query.set('v', String(options.revision));
        return `${endpoint(`/sessions/${encodeURIComponent(sessionId)}/layers/${encodeURIComponent(layerId)}/map`)}?${query.toString()}`;
    },
};
