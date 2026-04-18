/**
 * 流水线激活状态 —— 单一真相源。
 *
 * 用户在「调用模型」的"流程参数"画布中把模块（前处理/推理/后处理）拖入
 * 画布代表激活；没拖的模块在推理时不参与参数下发，由后端使用默认值。
 *
 * 存储：localStorage，键 `pipeline.activatedStages`。
 * 默认：三个阶段都未激活 —— 新用户沿用后端默认行为，不受前端 UI 改动影响。
 */

export type PipelineStage = 'preprocess' | 'inference' | 'postprocess';

export interface PipelineActivation {
    preprocess: boolean;
    inference: boolean;
    postprocess: boolean;
}

const STORAGE_KEY = 'pipeline.activatedStages';

// 默认全激活 —— 新用户默认三阶段都走"下发前端参数",
// 与老行为一致（popup 保存的值会被发到后端）。用户可主动移除阶段退到后端默认。
export const DEFAULT_ACTIVATION: PipelineActivation = {
    preprocess: true,
    inference: true,
    postprocess: true,
};

type Listener = (next: PipelineActivation) => void;
const listeners = new Set<Listener>();

function loadActivation(): PipelineActivation {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        if (!raw) return { ...DEFAULT_ACTIVATION };
        const parsed = JSON.parse(raw);
        return {
            preprocess: !!parsed.preprocess,
            inference: !!parsed.inference,
            postprocess: !!parsed.postprocess,
        };
    } catch {
        return { ...DEFAULT_ACTIVATION };
    }
}

let _activation: PipelineActivation = loadActivation();

function persist() {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_activation));
        }
    } catch { /* ignore */ }
}

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
        persist();
        listeners.forEach((l) => l(_activation));
    },

    subscribe(listener: Listener): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};
