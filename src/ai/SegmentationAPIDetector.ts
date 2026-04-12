import axios from 'axios';

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
        url: 'http://localhost:8000/segment',
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
     * 从预先捕获的 Blob 调用分割 API（批量分割用）
     */
    public static async predictFromBlob(blob: Blob, filename: string = 'frame.jpg'): Promise<SegmentationResult[]> {
        if (!this.config.enabled) {
            throw new Error('Segmentation API is disabled');
        }

        const formData = new FormData();
        formData.append('file', blob, filename);

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
