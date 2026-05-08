import {IPoint} from '../interfaces/IPoint';
import {IRect} from '../interfaces/IRect';

export interface PendingPrompt {
    id: string;
    kind: 'point' | 'bbox';
    point?: IPoint;
    bbox?: IRect;
    pointLabel?: 'positive' | 'negative';
}

/**
 * Pending SAM-prompt indicator state. Lives on `window` so that any copy of
 * this module (or the renderer's module) reads the same array — Vite HMR can
 * otherwise create multiple module instances with divergent state.
 */
interface WindowExt {
    __openSightPendingPrompts?: PendingPrompt[];
    __openSightPendingPromptsRafId?: number | null;
    __openSightPromptInferring?: boolean;
}
const w = window as unknown as WindowExt;

function getPrompts(): PendingPrompt[] {
    if (!w.__openSightPendingPrompts) w.__openSightPendingPrompts = [];
    return w.__openSightPendingPrompts;
}

function setPrompts(next: PendingPrompt[]): void {
    w.__openSightPendingPrompts = next;
}

/** Single render (for static prompts — no continuous animation) */
async function renderOnce(): Promise<void> {
    try {
        const {EditorActions} = await import('../logic/actions/EditorActions');
        EditorActions.fullRender();
    } catch {}
}

/** Continuous rAF loop for blinking animation during inference */
async function tick(): Promise<void> {
    if (getPrompts().length === 0 || !w.__openSightPromptInferring) {
        w.__openSightPendingPromptsRafId = null;
        return;
    }
    try {
        const {EditorActions} = await import('../logic/actions/EditorActions');
        EditorActions.fullRender();
    } catch {}
    if (getPrompts().length > 0 && w.__openSightPromptInferring) {
        w.__openSightPendingPromptsRafId = requestAnimationFrame(() => { void tick(); });
    } else {
        w.__openSightPendingPromptsRafId = null;
    }
}

function startAnimator(): void {
    if (w.__openSightPendingPromptsRafId != null) return;
    w.__openSightPendingPromptsRafId = requestAnimationFrame(() => { void tick(); });
}

export const PendingPromptModel = {
    getAll(): PendingPrompt[] {
        return getPrompts();
    },

    add(prompt: PendingPrompt): void {
        setPrompts([...getPrompts(), prompt]);
        // 静态 prompt → 触发一次重绘；推理中 → 启动持续动画
        if (w.__openSightPromptInferring) {
            startAnimator();
        } else {
            void renderOnce();
        }
    },

    remove(id: string): void {
        setPrompts(getPrompts().filter(p => p.id !== id));
        if (getPrompts().length === 0 && w.__openSightPendingPromptsRafId != null) {
            cancelAnimationFrame(w.__openSightPendingPromptsRafId);
            w.__openSightPendingPromptsRafId = null;
        }
        void renderOnce();
    },

    /** Update a point prompt's position (for drag-to-move) */
    updatePointPosition(id: string, newPoint: {x: number; y: number}): void {
        const all = getPrompts();
        const idx = all.findIndex(p => p.id === id);
        if (idx < 0) return;
        const updated = [...all];
        updated[idx] = { ...updated[idx], point: newPoint };
        setPrompts(updated);
        // 不调用 renderOnce —— mousemove 期间 fullRender 由 Editor 自动触发
    },

    /** Update a bbox prompt's position (for drag-to-move) */
    updateBboxPosition(id: string, newBbox: {x: number; y: number; width: number; height: number}): void {
        const all = getPrompts();
        const idx = all.findIndex(p => p.id === id);
        if (idx < 0) return;
        const updated = [...all];
        updated[idx] = { ...updated[idx], bbox: newBbox };
        setPrompts(updated);
    },

    clear(): void {
        setPrompts([]);
        if (w.__openSightPendingPromptsRafId != null) {
            cancelAnimationFrame(w.__openSightPendingPromptsRafId);
            w.__openSightPendingPromptsRafId = null;
        }
        void renderOnce();
    },

    /** Called when inference starts to begin the blinking animation */
    startBlinking(): void {
        startAnimator();
    },
};
