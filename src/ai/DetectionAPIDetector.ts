import axios from 'axios';
import {IRect} from '../interfaces/IRect';
import {ImageData} from '../store/labels/types';
import {ImageRepository} from '../logic/imageRepository/ImageRepository';

export interface DetectionAPIConfig {
    url: string;
    enabled: boolean;
}

export interface DetectionBbox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
    height: number;
}

export interface DetectionObjectInfo {
    id: number;
    name: string;
    confidence: number;
}

export interface DetectionResult {
    info: DetectionObjectInfo;
    bbox: [number, number, number, number]; // [x1, y1, x2, y2]
}

export interface DetectionAPIResponse {
    status: string;
    total: number;
    results: DetectionResult[];
}

export class DetectionAPIDetector {
    private static config: DetectionAPIConfig = {
        url: 'http://localhost:8000/detect', // 默认检测API地址
        enabled: true
    };

    public static setConfig(config: DetectionAPIConfig) {
        this.config = config;
    }

    public static getConfig(): DetectionAPIConfig {
        return this.config;
    }

    public static isEnabled(): boolean {
        return this.config.enabled;
    }

    /**
     * 调用检测API接口
     * @param imageData 当前图片数据
     * @param onSuccess 成功回调
     * @param onFailure 失败回调
     */
    public static async predict(
        imageData: ImageData,
        onSuccess?: (results: DetectionResult[]) => void,
        onFailure?: (error: any) => void
    ): Promise<void> {
        if (!this.config.enabled) {
            console.warn('Detection API is disabled');
            if (onFailure) onFailure(new Error('Detection API is disabled'));
            return;
        }

        try {
            // 准备form-data
            const formData = new FormData();

            // 判断是否为视频文件（视频模式下 fileData 是整个视频文件，不能直接发送）
            const isVideoFile = imageData.fileData && imageData.fileData.type.startsWith('video/');

            if (isVideoFile) {
                // 视频模式：从 ImageRepository 获取当前帧的 HTMLImageElement，转为 Blob 发送
                const frameImage = ImageRepository.getById(imageData.id);
                if (!frameImage) {
                    throw new Error('Video frame image not available. Please wait for the frame to load.');
                }
                const canvas = document.createElement('canvas');
                canvas.width = frameImage.naturalWidth || frameImage.width;
                canvas.height = frameImage.naturalHeight || frameImage.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(frameImage, 0, 0);
                const blob: Blob = await new Promise((resolve, reject) => {
                    canvas.toBlob((b) => {
                        if (b) resolve(b);
                        else reject(new Error('Failed to capture video frame'));
                    }, 'image/jpeg', 0.95);
                });
                formData.append('file', blob, 'video_frame.jpg');
            } else if (imageData.fileData) {
                // 图像模式：直接发送原始文件
                formData.append('file', imageData.fileData, imageData.fileData.name || 'image.jpg');
            } else {
                throw new Error('No image file data available');
            }

            console.log('Calling detection API...');

            // 调用API
            const response = await axios.post<DetectionAPIResponse>(
                this.config.url,
                formData,
                {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                    timeout: 30000, // 30秒超时
                }
            );

            if (response.data.status === 'success' && response.data.results) {
                console.log('Detection API response:', response.data);
                console.log(`检测完成：共检测到 ${response.data.total} 个对象`);
                
                if (onSuccess) {
                    onSuccess(response.data.results);
                }
            } else {
                const error = new Error('Detection failed: ' + response.data.status);
                console.error('Detection API error:', error);
                if (onFailure) onFailure(error);
            }

        } catch (error) {
            console.error('Detection API request failed:', error);
            let errorMessage = 'Network error';
            
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                    errorMessage = 'Cannot connect to detection server. Please check if the server is running.';
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
     * 将检测结果的bbox数组转换为IRect格式
     */
    public static bboxArrayToRect(bbox: [number, number, number, number]): IRect {
        const [x1, y1, x2, y2] = bbox;
        return {
            x: x1,
            y: y1,
            width: x2 - x1,
            height: y2 - y1
        };
    }

    /**
     * 将检测结果转换为统一的推理结果格式（用于兼容现有的渲染逻辑）
     */
    public static convertToSegmentationFormat(detectionResults: DetectionResult[]): any[] {
        return detectionResults.map(result => ({
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
            // 检测结果没有mask数据，设为null
            mask: null
        }));
    }

    /**
     * 测试API连接
     */
    public static async testConnection(): Promise<boolean> {
        try {
            // 创建一个简单的测试请求
            const response = await axios.get(this.config.url.replace('/detect', '/health'), {
                timeout: 5000
            });
            return response.status === 200;
        } catch (error) {
            console.error('Detection API connection test failed:', error);
            return false;
        }
    }
}
