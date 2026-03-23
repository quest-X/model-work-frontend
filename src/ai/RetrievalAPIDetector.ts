import axios from 'axios';
import {IRect} from '../interfaces/IRect';
import {ImageData} from '../store/labels/types';

export interface RetrievalAPIConfig {
    url: string;
    enabled: boolean;
}

export interface RetrievalBbox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
    height: number;
}

export interface RetrievalObjectInfo {
    id: number;
    name: string;
    confidence: number;
    img_filename: string;
}

export interface RetrievalResult {
    info: RetrievalObjectInfo;
    bbox: [number, number, number, number]; // [x1, y1, x2, y2]
}

export interface RetrievalAPIResponse {
    status: string;
    total: number;
    results: RetrievalResult[];
}

export class RetrievalAPIDetector {
    private static config: RetrievalAPIConfig = {
        url: 'http://192.168.10.205:8000/retrieve', // 默认检索API地址
        enabled: true
    };

    public static setConfig(config: RetrievalAPIConfig) {
        this.config = config;
    }

    public static getConfig(): RetrievalAPIConfig {
        return this.config;
    }

    public static isEnabled(): boolean {
        return this.config.enabled;
    }

    /**
     * 调用检索API接口
     * @param imageData 当前图片数据
     * @param bbox 用户拉的标注框 [x1, y1, x2, y2]
     * @param onSuccess 成功回调
     * @param onFailure 失败回调
     */
    public static async predict(
        imageData: ImageData,
        bbox: [number, number, number, number],
        onSuccess?: (results: RetrievalResult[]) => void,
        onFailure?: (error: any) => void
    ): Promise<void> {
        if (!this.config.enabled) {
            console.warn('🔍 Retrieval API is disabled');
            if (onFailure) onFailure(new Error('Retrieval API is disabled'));
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

            // 将bbox坐标转换为整数，使用与分割API相同的格式
            const bboxString = `${Math.round(bbox[0])},${Math.round(bbox[1])},${Math.round(bbox[2])},${Math.round(bbox[3])}`;
            
            // 使用与分割API相同的bbox格式
            formData.append('bbox', bboxString);

            console.log('🔍 Calling retrieval API...');
            console.log('🔍 API URL:', this.config.url);
            console.log('🔍 Image file:', imageData.fileData?.name || 'unnamed');
            console.log('🔍 Query bbox:', bbox);
            console.log('🔍 FormData内容:');
            console.log('🔍   - file:', imageData.fileData?.name);
            console.log('🔍   - bbox (字符串格式):', bboxString);

            // 调用API
            const response = await axios.post<RetrievalAPIResponse>(
                this.config.url,
                formData,
                {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                    timeout: 30000, // 30秒超时
                }
            );

            console.log('🔍 Retrieval API response status:', response.status);
            console.log('🔍 Retrieval API response headers:', response.headers);
            console.log('🔍 Retrieval API response data:', response.data);

            if (response.data && response.data.status === 'success' && response.data.results) {
                console.log(`🔍 检索完成：共找到 ${response.data.total} 个相似结果`);
                console.log('🔍 检索结果详情:', response.data.results);
                
                if (onSuccess) {
                    onSuccess(response.data.results);
                }
            } else {
                console.error('🔍 API响应格式错误或状态不是success:');
                console.error('🔍 响应数据:', response.data);
                console.error('🔍 期望格式: {status: "success", total: number, results: array}');
                
                const error = new Error('Retrieval failed: ' + (response.data?.status || 'unknown error'));
                console.error('🔍 Retrieval API error:', error);
                if (onFailure) onFailure(error);
            }

        } catch (error) {
            console.error('🔍 === Retrieval API request failed ===');
            console.error('🔍 Error object:', error);
            let errorMessage = 'Network error';
            
            if (axios.isAxiosError(error)) {
                console.error('🔍 Axios error details:');
                console.error('🔍 Error code:', error.code);
                console.error('🔍 Error message:', error.message);
                
                if (error.response) {
                    console.error('🔍 Response status:', error.response.status);
                    console.error('🔍 Response statusText:', error.response.statusText);
                    console.error('🔍 Response data:', error.response.data);
                    console.error('🔍 Response headers:', error.response.headers);
                    errorMessage = `Server error: ${error.response.status} ${error.response.statusText}`;
                    
                    // 如果服务器返回了错误详情，也打印出来
                    if (error.response.data) {
                        console.error('🔍 Server error details:', error.response.data);
                        if (typeof error.response.data === 'object' && error.response.data.message) {
                            errorMessage += ` - ${error.response.data.message}`;
                        }
                    }
                } else if (error.request) {
                    console.error('🔍 Request details:', error.request);
                    errorMessage = 'No response from server. Please check your network connection.';
                } else {
                    console.error('🔍 Request setup error:', error.message);
                    errorMessage = error.message;
                }
                
                if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                    errorMessage = 'Cannot connect to retrieval server. Please check if the server is running.';
                }
            } else if (error instanceof Error) {
                console.error('🔍 Generic error:', error.message);
                console.error('🔍 Error stack:', error.stack);
                errorMessage = error.message;
            } else {
                console.error('🔍 Unknown error type:', typeof error);
                errorMessage = 'Unknown error occurred';
            }

            console.error('🔍 Final error message:', errorMessage);
            if (onFailure) onFailure(new Error(errorMessage));
        }
    }

    /**
     * 将检索结果的bbox数组转换为IRect格式
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
     * 测试API连接
     */
    public static async testConnection(): Promise<boolean> {
        try {
            // 创建一个简单的测试请求
            const response = await axios.get(this.config.url.replace('/retrieve', '/health'), {
                timeout: 5000
            });
            console.log('🔍 Retrieval API health check:', response.status === 200 ? 'OK' : 'Failed');
            return response.status === 200;
        } catch (error) {
            console.error('🔍 Retrieval API connection test failed:', error);
            return false;
        }
    }
}
