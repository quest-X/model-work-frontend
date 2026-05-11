/**
 * 全局当前激活模型缓存。EditorTopNavigationBar 在 /health poll 里写入；
 * 非 React 模块（SmartAnnotationActions / ObjectTrackingActions）通过 getter 读取，
 * 避免每个模块自己再 fetch 一次。
 */

let _segmentation: string = '';
let _detection: string = '';

export const ActiveModel = {
    setSegmentation(name: string) { _segmentation = name; },
    setDetection(name: string) { _detection = name; },
    getSegmentation(): string { return _segmentation; },
    getDetection(): string { return _detection; },
};

/**
 * 把后端模型文件名格式化为"系列 (具体名)"友好展示。
 *   sam3.pt           → "SAM 3 (sam3)"
 *   sam3.1_multiplex  → "SAM 3 (sam3.1_multiplex)"
 *   sam2.1_b.pt       → "SAM 2 (sam2.1_b)"
 *   yolov8n.pt        → "yolov8n"
 *   ""                → "推理"  (兜底，避免空串显示)
 */
export function formatModelDisplay(modelName: string): string {
    if (!modelName) return '推理';
    const bare = modelName.replace(/\.(pt|onnx|pth)$/i, '');
    const lower = bare.toLowerCase();
    if (lower.startsWith('sam3')) return `SAM 3 (${bare})`;
    if (lower.startsWith('sam2') || lower.startsWith('sam_')) return `SAM 2 (${bare})`;
    return bare;
}
