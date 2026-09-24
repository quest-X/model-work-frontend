import {getExtensionEngineBaseUrl} from '../utils/DefaultBackendUrl';

export type MachineHistoryObjectSummary = {
    namespace: string;
    object_key: string;
    version: number;
    created_at: number;
    captured_at: number | null;
    digest: string;
    size_bytes: number;
};

export type MachineHistoryStatus = {
    schema_version: 'machine-history.status.v1';
    encrypted: boolean;
    objects: number;
    versions: number;
    plaintext_bytes: number;
};

export type MachineHistoryObject = MachineHistoryObjectSummary & {
    schema_version: 'machine-history.object.v1';
    payload: Record<string, unknown>;
};

const baseUrl = (): string =>
    `${getExtensionEngineBaseUrl()}/extensions/machine-history`;

const request = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
    const response = await fetch(`${baseUrl()}${path}`, {signal});
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`);
    }
    return response.json();
};

export class MachineHistoryService {
    public static status(nodeId: string, signal?: AbortSignal): Promise<MachineHistoryStatus> {
        return request(`/nodes/${encodeURIComponent(nodeId)}/status`, signal);
    }

    public static objects(
        nodeId: string,
        signal?: AbortSignal,
    ): Promise<{schema_version: 'machine-history.list.v1'; objects: MachineHistoryObjectSummary[]}> {
        return request(`/nodes/${encodeURIComponent(nodeId)}/objects?limit=100`, signal);
    }

    public static object(
        nodeId: string,
        namespace: string,
        objectKey: string,
        signal?: AbortSignal,
    ): Promise<MachineHistoryObject> {
        return request(
            `/nodes/${encodeURIComponent(nodeId)}/objects/${encodeURIComponent(namespace)}/${encodeURIComponent(objectKey)}`,
            signal,
        );
    }
}
