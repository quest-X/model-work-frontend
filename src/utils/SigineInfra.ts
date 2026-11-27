export type SigineSelection = {source_id: string; model: string};
export const SIGINE_SELECTION_CHANGED = 'opensight:sigine-selection-changed';

export function updateSigineSelection(enabled: boolean, selection?: SigineSelection): void {
    if (selection) localStorage.setItem('opensight.sigineInfraSelection', JSON.stringify(selection));
    localStorage.setItem('opensight.sigineInfra', String(enabled));
    window.dispatchEvent(new Event(SIGINE_SELECTION_CHANGED));
}

export function getSigineSelection(): SigineSelection | undefined {
    try {
        const value = JSON.parse(localStorage.getItem('opensight.sigineInfraSelection') || 'null');
        return value && typeof value.source_id === 'string' && typeof value.model === 'string'
            ? {source_id: value.source_id, model: value.model} : undefined;
    } catch {
        return undefined;
    }
}

/** Human-readable provider label for boxes produced by an external model. */
export function modelSourceLabel(model: string): string {
    const value = model.toLowerCase();
    if (/^gpt(?:-|$)|^o\d(?:-|$)|openai/.test(value)) return 'GPT';
    if (value.includes('deepseek')) return 'DeepSeek';
    if (value.includes('glm')) return 'GLM';
    if (value.includes('kimi')) return 'Kimi';
    if (value.includes('mimo')) return 'MiMo';
    if (value.includes('minimax')) return 'MiniMax';
    if (/^hy\d|hunyuan/.test(value)) return 'Hunyuan';
    if (value.includes('qwen')) return 'Qwen';
    if (value.includes('claude')) return 'Claude';
    return model;
}
