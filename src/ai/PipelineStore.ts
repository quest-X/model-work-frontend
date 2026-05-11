/**
 * 流水线激活状态 —— 单一真相源。
 *
 * 默认三阶段全部激活（不过滤），用户可在「调用模型」画布中拖出阶段来
 * 临时跳过参数下发；状态不持久化，刷新后恢复默认全激活。
 */

export type PipelineStage = 'preprocess' | 'inference' | 'postprocess';

export interface PipelineActivation {
    preprocess: boolean;
    inference: boolean;
    postprocess: boolean;
}

export const DEFAULT_ACTIVATION: PipelineActivation = {
    preprocess: false,
    inference: false,
    postprocess: false,
};

type Listener = (next: PipelineActivation) => void;
const listeners = new Set<Listener>();

let _activation: PipelineActivation = { ...DEFAULT_ACTIVATION };

export const PipelineStore = {
    getActivation(): PipelineActivation {
        return { ..._activation };
    },

    isActivated(stage: PipelineStage): boolean {
        return _activation[stage];
    },

    setStage(stage: PipelineStage, active: boolean) {
        if (_activation[stage] === active) return;
        _activation = { ..._activation, [stage]: active };
        listeners.forEach((l) => l(_activation));
    },

    subscribe(listener: Listener): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};
