import axios from 'axios';
import {IRect} from '../interfaces/IRect';
import {ImageData} from '../store/labels/types';
import {EditorModel} from '../staticModels/EditorModel';
import {store} from '../index';
import {AIModelsSelector} from '../store/selectors/AIModelsSelector';
import {getDefaultBackendUrl} from '../utils/DefaultBackendUrl';
import {PipelineStore} from './PipelineStore';

export interface InferenceParams {
    conf: number;
    iou: number;
    imgsz: number;
    max_det: number;
    augment: boolean;
    half: boolean;
    agnostic_nms: boolean;
    classes: string;           // comma-separated class IDs; '' = all classes
    // per-param enabled flags (default true)
    imgsz_enabled: boolean;
    conf_enabled: boolean;
    iou_enabled: boolean;
    max_det_enabled: boolean;
    augment_enabled: boolean;
    half_enabled: boolean;
    agnostic_nms_enabled: boolean;
    classes_enabled: boolean;
}

export interface DetectionPostprocessParams {
    min_bbox_area: number;      // filter boxes below this area (px²); 0 = off
    bbox_padding: number;       // expand each bbox outward by N pixels; 0 = off
    min_bbox_area_enabled: boolean;
    bbox_padding_enabled: boolean;
}

export interface DetectionAPIConfig {
    url: string;
    enabled: boolean;
}

const INFERENCE_PARAMS_STORAGE_KEY = 'detectionAPI.inferenceParams';
const POSTPROCESS_PARAMS_STORAGE_KEY = 'detectionAPI.postprocessParams';

export const DEFAULT_DETECTION_POSTPROCESS_PARAMS: DetectionPostprocessParams = {
    min_bbox_area: 0,
    bbox_padding: 0,
    min_bbox_area_enabled: true,
    bbox_padding_enabled: true,
};

function loadDetectionPostprocessParams(): DetectionPostprocessParams {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(POSTPROCESS_PARAMS_STORAGE_KEY) : null;
        if (!raw) return { ...DEFAULT_DETECTION_POSTPROCESS_PARAMS };
        const p = JSON.parse(raw);
        return {
            min_bbox_area: typeof p.min_bbox_area === 'number' ? p.min_bbox_area : DEFAULT_DETECTION_POSTPROCESS_PARAMS.min_bbox_area,
            bbox_padding: typeof p.bbox_padding === 'number' ? p.bbox_padding : DEFAULT_DETECTION_POSTPROCESS_PARAMS.bbox_padding,
            min_bbox_area_enabled: p.min_bbox_area_enabled !== false,
            bbox_padding_enabled: p.bbox_padding_enabled !== false,
        };
    } catch {
        return { ...DEFAULT_DETECTION_POSTPROCESS_PARAMS };
    }
}

// 默认与 ultralytics v8+ 保持一致(iou=0.7,不是 YOLOv5 的 0.45);
// 前端发 0.45 会让 NMS 比后端原行为更激进,结果更少。
export const DEFAULT_INFERENCE_PARAMS: InferenceParams = {
    conf: 0.25,
    iou: 0.7,
    imgsz: 640,
    max_det: 300,
    augment: false,
    half: false,
    agnostic_nms: false,
    classes: '',
    imgsz_enabled: true,
    conf_enabled: true,
    iou_enabled: true,
    max_det_enabled: true,
    augment_enabled: true,
    half_enabled: true,
    agnostic_nms_enabled: true,
    classes_enabled: true,
};

function loadInferenceParams(): InferenceParams {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(INFERENCE_PARAMS_STORAGE_KEY) : null;
        if (!raw) return { ...DEFAULT_INFERENCE_PARAMS };
        const parsed = JSON.parse(raw);
        return {
            conf: typeof parsed.conf === 'number' ? parsed.conf : DEFAULT_INFERENCE_PARAMS.conf,
            iou: typeof parsed.iou === 'number' ? parsed.iou : DEFAULT_INFERENCE_PARAMS.iou,
            imgsz: typeof parsed.imgsz === 'number' ? parsed.imgsz : DEFAULT_INFERENCE_PARAMS.imgsz,
            max_det: typeof parsed.max_det === 'number' ? parsed.max_det : DEFAULT_INFERENCE_PARAMS.max_det,
            augment: typeof parsed.augment === 'boolean' ? parsed.augment : DEFAULT_INFERENCE_PARAMS.augment,
            half: typeof parsed.half === 'boolean' ? parsed.half : DEFAULT_INFERENCE_PARAMS.half,
            agnostic_nms: typeof parsed.agnostic_nms === 'boolean' ? parsed.agnostic_nms : DEFAULT_INFERENCE_PARAMS.agnostic_nms,
            classes: typeof parsed.classes === 'string' ? parsed.classes : DEFAULT_INFERENCE_PARAMS.classes,
            imgsz_enabled: parsed.imgsz_enabled !== false,
            conf_enabled: parsed.conf_enabled !== false,
            iou_enabled: parsed.iou_enabled !== false,
            max_det_enabled: parsed.max_det_enabled !== false,
            augment_enabled: parsed.augment_enabled !== false,
            agnostic_nms_enabled: parsed.agnostic_nms_enabled !== false,
            classes_enabled: parsed.classes_enabled !== false,
        };
    } catch {
        return { ...DEFAULT_INFERENCE_PARAMS };
    }
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
        // 默认检测 API:跟随 window.location.hostname,支持局域网跨机访问
        url: getDefaultBackendUrl('/detect'),
        enabled: true
    };

    private static inferenceParams: InferenceParams = loadInferenceParams();
    private static postprocessParams: DetectionPostprocessParams = loadDetectionPostprocessParams();

    public static setConfig(config: DetectionAPIConfig) {
        this.config = config;
    }

    public static getConfig(): DetectionAPIConfig {
        return this.config;
    }

    public static isEnabled(): boolean {
        return this.config.enabled;
    }

    public static getInferenceParams(): InferenceParams {
        return { ...this.inferenceParams };
    }

    public static setInferenceParams(params: Partial<InferenceParams>) {
        this.inferenceParams = {
            ...this.inferenceParams,
            ...params
        };
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(INFERENCE_PARAMS_STORAGE_KEY, JSON.stringify(this.inferenceParams));
            }
        } catch { /* ignore */ }
    }

    public static getPostprocessParams(): DetectionPostprocessParams {
        return { ...this.postprocessParams };
    }

    public static setPostprocessParams(partial: Partial<DetectionPostprocessParams>) {
        this.postprocessParams = { ...this.postprocessParams, ...partial };
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(POSTPROCESS_PARAMS_STORAGE_KEY, JSON.stringify(this.postprocessParams));
            }
        } catch { /* ignore */ }
    }

    /**
     * 从 store 里拉最新的 activeModel,同步到静态 config。
     * 返回 true 表示可以继续推理(有可用 detection 模型或 config 仍有效),false 表示应中止。
     */
    private static syncFromActiveModel(): { ok: boolean; reason?: string } {
        try {
            const state = store.getState();
            const active = AIModelsSelector.getActiveAIModel(state);
            if (active) {
                if (active.modelType !== 'detection' && active.modelType !== 'custom') {
                    return { ok: false, reason: `Active model "${active.name}" is ${active.modelType}, not detection/custom` };
                }
                if (!active.url) {
                    return { ok: false, reason: `Active model "${active.name}" has no url` };
                }
                this.config = { url: active.url, enabled: true };
                return { ok: true };
            }
            // 没有 activeModel 时回退到 config(由老弹窗设置的 URL)
            if (this.config.enabled && this.config.url) return { ok: true };
            return { ok: false, reason: 'No active AI model and detection API not configured' };
        } catch (e) {
            // store 读取失败不阻塞,沿用 config
            return this.config.enabled ? { ok: true } : { ok: false, reason: 'Detection API disabled' };
        }
    }

    private static appendInferenceParams(formData: FormData) {
        // 按 PipelineStore 阶段激活 + 各参数独立 enabled 标志双重过滤。
        const p = this.inferenceParams;
        if (PipelineStore.isActivated('preprocess')) {
            if (p.imgsz_enabled !== false)   formData.append('imgsz', String(p.imgsz));
            if (p.augment_enabled !== false)  formData.append('augment', p.augment ? '1' : '0');
        }
        if (PipelineStore.isActivated('inference')) {
            if (p.conf_enabled !== false)         formData.append('conf',         String(p.conf));
            if (p.iou_enabled !== false)          formData.append('iou',          String(p.iou));
            if (p.max_det_enabled !== false)      formData.append('max_det',      String(p.max_det));
            if (p.agnostic_nms_enabled !== false) formData.append('agnostic_nms', p.agnostic_nms ? '1' : '0');
            if (p.classes_enabled !== false && p.classes.trim())
                formData.append('classes', p.classes.trim());
        }
        if (PipelineStore.isActivated('postprocess')) {
            const pp = this.postprocessParams;
            if (pp.min_bbox_area_enabled !== false && pp.min_bbox_area > 0)
                formData.append('min_bbox_area', String(pp.min_bbox_area));
            if (pp.bbox_padding_enabled !== false && pp.bbox_padding > 0)
                formData.append('bbox_padding', String(pp.bbox_padding));
        }
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
        const sync = this.syncFromActiveModel();
        if (!sync.ok) {
            console.warn('Detection API unavailable:', sync.reason);
            if (onFailure) onFailure(new Error(sync.reason || 'Detection API is disabled'));
            return;
        }

        try {
            // 准备form-data
            const formData = new FormData();

            // Determine capture strategy based on the active playback mode.
            // In raw_browser_mode the fileData is the entire video file (cannot send directly);
            // in fast_ffmpeg_mode the decoded frame Image is available via EditorModel.videoFrameImage.
            const isVideoFile = imageData.fileData && imageData.fileData.type.startsWith('video/');

            if (isVideoFile) {
                // raw_browser_mode: capture current frame at full resolution from <video> element
                const video = EditorModel.videoElement;
                if (!video || video.readyState < 2) {
                    throw new Error('Video not ready. Please wait for the video to load.');
                }
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const blob: Blob = await new Promise((resolve, reject) => {
                    canvas.toBlob((b) => {
                        if (b) resolve(b);
                        else reject(new Error('Failed to capture video frame'));
                    }, 'image/png');
                });
                formData.append('file', blob, 'video_frame.png');
            } else if (EditorModel.videoFrameImage) {
                // fast_ffmpeg_mode (full-load or on-demand): capture pixels from the decoded frame Image
                const img = EditorModel.videoFrameImage;
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const blob: Blob = await new Promise((resolve, reject) => {
                    canvas.toBlob((b) => {
                        if (b) resolve(b);
                        else reject(new Error('Failed to capture frame image'));
                    }, 'image/png');
                });
                formData.append('file', blob, 'frame.png');
            } else if (imageData.fileData && imageData.fileData.size > 0) {
                // 图像模式：直接发送原始文件
                formData.append('file', imageData.fileData, imageData.fileData.name || 'image.jpg');
            } else {
                throw new Error('No image file data available');
            }

            this.appendInferenceParams(formData);

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
     * 从预先捕获的 Blob 调用检测API（批量检测用）
     * @param blob 预捕获的图像 Blob
     * @param filename 文件名
     */
    public static async predictFromBlob(blob: Blob, filename: string = 'frame.jpg'): Promise<DetectionResult[]> {
        const sync = this.syncFromActiveModel();
        if (!sync.ok) {
            throw new Error(sync.reason || 'Detection API is disabled');
        }

        const formData = new FormData();
        formData.append('file', blob, filename);
        this.appendInferenceParams(formData);

        const response = await axios.post<DetectionAPIResponse>(
            this.config.url,
            formData,
            {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 30000,
            }
        );

        if (response.data.status === 'success' && response.data.results) {
            return response.data.results;
        }
        throw new Error('Detection failed: ' + response.data.status);
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
