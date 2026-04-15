import axios from 'axios';
import {store} from '../index';
import {AIModelsSelector} from '../store/selectors/AIModelsSelector';
import {getDefaultBackendUrl} from '../utils/DefaultBackendUrl';

export interface SegmentationObjectInfo {
    id: number;
    name: string;
    confidence: number;
}

export interface SegmentationResult {
    info: SegmentationObjectInfo;
    bbox: [number, number, number, number]; // [x1, y1, x2, y2]
    mask: [number, number][]; // polygon vertices [[x,y], ...]
}

export interface SegmentationAPIResponse {
    status: string;
    total: number;
    results: SegmentationResult[];
}

export class SegmentationAPIDetector {
    private static config = {
        // 默认分割 API:跟随 window.location.hostname,支持局域网跨机访问
        url: getDefaultBackendUrl('/segment'),
        enabled: true
    };

    public static setConfig(config: { url: string; enabled: boolean }) {
        this.config = config;
    }

    public static getConfig() {
        return this.config;
    }

    public static isEnabled(): boolean {
        return this.config.enabled;
    }

    /**
     * 从 store 读取 activeModel 并同步到 config。
     * 要求 active model 的 modelType === 'segmentation'。
     */
    private static syncFromActiveModel(): { ok: boolean; reason?: string } {
        try {
            const state = store.getState();
            const active = AIModelsSelector.getActiveAIModel(state);
            if (active) {
                if (active.modelType !== 'segmentation') {
                    return { ok: false, reason: `Active model "${active.name}" is ${active.modelType}, not segmentation` };
                }
                if (!active.url) {
                    return { ok: false, reason: `Active model "${active.name}" has no url` };
                }
                this.config = { url: active.url, enabled: true };
                return { ok: true };
            }
            if (this.config.enabled && this.config.url) return { ok: true };
            return { ok: false, reason: 'No active AI model and segmentation API not configured' };
        } catch {
            return this.config.enabled ? { ok: true } : { ok: false, reason: 'Segmentation API disabled' };
        }
    }

    /**
     * 从预先捕获的 Blob 调用分割 API
     * - 不传 prompt：全图分割（批量推理路径，原有行为）
     * - prompt.point：SAM 单点前景 prompt（智能标注 click）
     * - prompt.bbox：SAM bbox prompt（智能标注 drag）
     */
    public static async predictFromBlob(
        blob: Blob,
        filename: string = 'frame.jpg',
        prompt?: { bbox?: [number, number, number, number]; point?: [number, number] }
    ): Promise<SegmentationResult[]> {
        // 当没有 prompt 时(批量分割路径)才从 store 同步 activeModel;
        // 带 prompt 的 SAM 智能标注保持走 config(由 LoadDetectionModelPopup 设置)。
        if (!prompt) {
            const sync = this.syncFromActiveModel();
            if (!sync.ok) {
                throw new Error(sync.reason || 'Segmentation API is disabled');
            }
        } else if (!this.config.enabled) {
            throw new Error('Segmentation API is disabled');
        }

        const formData = new FormData();
        formData.append('file', blob, filename);
        if (prompt?.point) {
            formData.append('point', `${Math.round(prompt.point[0])},${Math.round(prompt.point[1])}`);
        } else if (prompt?.bbox) {
            const [x1, y1, x2, y2] = prompt.bbox;
            formData.append('bbox', `${Math.round(x1)},${Math.round(y1)},${Math.round(x2)},${Math.round(y2)}`);
        }

        const response = await axios.post<SegmentationAPIResponse>(
            this.config.url,
            formData,
            {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 60000, // 分割比检测慢，给 60s
            }
        );

        if (response.data.status === 'success' && response.data.results) {
            return response.data.results;
        }
        throw new Error('Segmentation failed: ' + response.data.status);
    }

    /**
     * 将分割结果转换为统一的推理结果格式
     */
    public static convertToUnifiedFormat(results: SegmentationResult[]): any[] {
        return results.map(result => ({
            class_id: result.info.id,
            class_name: result.info.name,
            confidence: result.info.confidence,
            bbox: {
                x1: result.bbox[0],
                y1: result.bbox[1],
                x2: result.bbox[2],
                y2: result.bbox[3],
                width: result.bbox[2] - result.bbox[0],
                height: result.bbox[3] - result.bbox[1]
            },
            mask: {
                area: 0, // 后续可从多边形面积计算
                mask_data: result.mask
            }
        }));
    }

    public static async testConnection(): Promise<boolean> {
        try {
            const response = await axios.get(this.config.url.replace('/segment', '/health'), {
                timeout: 5000
            });
            return response.status === 200;
        } catch {
            return false;
        }
    }
}
