import {IPoint} from '../interfaces/IPoint';
import {IRect} from '../interfaces/IRect';

export interface PendingPrompt {
    id: string;
    kind: 'point' | 'bbox';
    point?: IPoint;
    bbox?: IRect;
}

/**
 * Pending SAM-prompt indicator state. Lives on `window` so that any copy of
 * this module (or the renderer's module) reads the same array — Vite HMR can
 * otherwise create multiple module instances with divergent state.
 */
interface WindowExt {
    __openSightPendingPrompts?: PendingPrompt[];
    __openSightPendingPromptsRafId?: number | null;
}
const w = window as unknown as WindowExt;

function getPrompts(): PendingPrompt[] {
    if (!w.__openSightPendingPrompts) w.__openSightPendingPrompts = [];
    return w.__openSightPendingPrompts;
}

function setPrompts(next: PendingPrompt[]): void {
    w.__openSightPendingPrompts = next;
}

async function tick(): Promise<void> {
    if (getPrompts().length === 0) {
        w.__openSightPendingPromptsRafId = null;
        return;
    }
    try {
        const {EditorActions} = await import('../logic/actions/EditorActions');
        EditorActions.fullRender();
    } catch {}
    if (getPrompts().length > 0) {
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
        if (getPrompts().length === 1) {
            startAnimator();
        }
    },

    remove(id: string): void {
        setPrompts(getPrompts().filter(p => p.id !== id));
        if (getPrompts().length === 0 && w.__openSightPendingPromptsRafId != null) {
            cancelAnimationFrame(w.__openSightPendingPromptsRafId);
            w.__openSightPendingPromptsRafId = null;
            // Final render to erase the indicator
            void (async () => {
                try {
                    const {EditorActions} = await import('../logic/actions/EditorActions');
                    EditorActions.fullRender();
                } catch {}
            })();
        }
    },

    clear(): void {
        setPrompts([]);
        if (w.__openSightPendingPromptsRafId != null) {
            cancelAnimationFrame(w.__openSightPendingPromptsRafId);
            w.__openSightPendingPromptsRafId = null;
        }
    },
};
