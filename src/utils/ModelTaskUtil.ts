export type ModelTask = 'detect' | 'segment';

const MODEL_EXT_RE = /\.(pt|onnx|mlpackage|mlmodel)$/i;
const SEGMENT_TASK_TOKENS = new Set([
    'seg',
    'segment',
    'segmentation',
    'sam',
    'sam2',
    'sam3',
    'fastsam',
]);

/**
 * Infer the inference task from a model filename when an older backend does
 * not provide model_tasks/service metadata.
 *
 * Task markers are matched as delimiter-separated tokens, so production names
 * such as `260529_SEG_DLK_...pt` work without treating an unrelated substring
 * such as `consecutive` as a segmentation marker.
 */
export const inferModelTaskFromName = (modelPath: string): ModelTask => {
    const filename = modelPath.split(/[\\/]/).pop() || '';
    const stem = filename.replace(MODEL_EXT_RE, '').toLowerCase();
    const tokens = stem.split(/[^a-z0-9]+/).filter(Boolean);
    return tokens.some(token => SEGMENT_TASK_TOKENS.has(token))
        ? 'segment'
        : 'detect';
};
