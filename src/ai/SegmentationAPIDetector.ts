import axios from 'axios';
import {IRect} from '../interfaces/IRect';
import {ImageData} from '../store/labels/types';
import {FileUtil} from '../utils/FileUtil';

export interface SegmentationAPIConfig {
    url: string;
    enabled: boolean;
}

// 新的分割结果格式，匹配您的JSON结构
export interface SegmentationObjectInfo {
    id: number;
    name: string;
    confidence: number;
}

export interface SegmentationResult {
    info: SegmentationObjectInfo;
    bbox: [number, number, number, number]; // [x1, y1, x2, y2]
    mask: [number, number][]; // 多边形顶点坐标数组
}

export interface SegmentationAPIResponse {
    status: string;
    total: number;
    results: SegmentationResult[];
}

// 保留旧格式的接口用于兼容性
export interface LegacySegmentationBbox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
    height: number;
}

export interface LegacySegmentationMask {
    mask_data: [number, number][];
    area: number;
}

export interface LegacySegmentationResult {
    class_id: number;
    class_name: string;
    confidence: number;
    bbox: LegacySegmentationBbox;
    mask: LegacySegmentationMask;
}

export class SegmentationAPIDetector {
    private static config: SegmentationAPIConfig = {
        url: 'http://192.168.10.205:8000/segment',
        enabled: true
    };

    public static setConfig(config: SegmentationAPIConfig) {
        this.config = config;
    }

    public static getConfig(): SegmentationAPIConfig {
        return this.config;
    }

    public static isEnabled(): boolean {
        return this.config.enabled;
    }

    /**
     * 调用分割推理接口
     * @param imageData 当前图片数据
     * @param bbox 标注框坐标，格式为 IRect
     * @param onSuccess 成功回调
     * @param onFailure 失败回调
     */
    public static async predict(
        imageData: ImageData,
        bbox: IRect,
        onSuccess?: (results: SegmentationResult[]) => void,
        onFailure?: (error: any) => void
    ): Promise<void> {
        if (!this.config.enabled) {
            console.warn('Segmentation API is disabled');
            if (onFailure) onFailure(new Error('Segmentation API is disabled'));
            return;
        }

        try {
            // 准备form-data
            const formData = new FormData();
            
            // 添加图片文件
            if (imageData.fileData) {
                formData.append('file', imageData.fileData, imageData.fileData.name || 'image.jpg');
            } else {
                throw new Error('No image file data available');
            }

            // 添加bbox参数，格式为 "x,y,x2,y2"
            const bboxString = `${Math.round(bbox.x)},${Math.round(bbox.y)},${Math.round(bbox.x + bbox.width)},${Math.round(bbox.y + bbox.height)}`;
            formData.append('bbox', bboxString);

            console.log('Calling segmentation API with bbox:', bboxString);

            // 调用API
            const response = await axios.post<SegmentationAPIResponse>(
                this.config.url,
                formData,
                {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                    timeout: 30000, // 30秒超时
                }
            );

            // 支持新的JSON格式：{status: "success", total: number, results: [...]}
            if (response.data.status === 'success' && response.data.results) {
                console.log('分割完成：共分割出', response.data.total, '个对象');
                if (onSuccess) {
                    onSuccess(response.data.results);
                }
            } else {
                const error = new Error('Segmentation failed: ' + response.data.status);
                console.error('Segmentation API error:', error);
                if (onFailure) onFailure(error);
            }

        } catch (error) {
            console.error('Segmentation API request failed:', error);
            let errorMessage = 'Network error';
            
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                    errorMessage = 'Cannot connect to segmentation server. Please check if the server is running.';
                } else if (error.response) {
                    errorMessage = `Server error: ${error.response.status} ${error.response.statusText}`;
                } else if (error.request) {
                    errorMessage = 'No response from server. Please check your network connection.';
                }
            } else if (error instanceof Error) {
                errorMessage = error.message;
            }

            if (onFailure) onFailure(new Error(errorMessage));
        }
    }

    /**
     * 将IRect转换为bbox字符串格式
     */
    public static rectToBboxString(rect: IRect): string {
        return `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.x + rect.width)},${Math.round(rect.y + rect.height)}`;
    }

    /**
     * 测试API连接
     */
    public static async testConnection(): Promise<boolean> {
        try {
            // 创建一个简单的测试请求
            const response = await axios.get(this.config.url.replace('/segment', '/health'), {
                timeout: 5000
            });
            return response.status === 200;
        } catch (error) {
            console.error('API connection test failed:', error);
            return false;
        }
    }
}
