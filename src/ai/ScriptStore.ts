/**
 * 自定义脚本激活状态。
 *
 * preprocess / postprocess 各自独立选择一个脚本，外加共享 params (JSON dict)。
 * 同一份脚本（.py 文件）可同时被 pre 和 post 引用（脚本里两个 hook 都定义即可）。
 *
 * 落盘到 localStorage，刷新后保留选择。
 */
import {getEngineBaseUrl} from '../utils/DefaultBackendUrl';

export interface ScriptInfo {
    name: string;
    has_preprocess: boolean;
    has_postprocess: boolean;
    size: number;
    mtime: number;
    error?: string;
}

export interface ScriptSelection {
    preprocess: string;   // script name (without .py); 空串 = 不启用
    postprocess: string;
    params: string;       // JSON 字符串；空串 = 不传
}

const STORAGE_KEY = 'opensight.script.selection';

const DEFAULT: ScriptSelection = {preprocess: '', postprocess: '', params: ''};

function load(): ScriptSelection {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {...DEFAULT};
        const parsed = JSON.parse(raw);
        return {
            preprocess: typeof parsed.preprocess === 'string' ? parsed.preprocess : '',
            postprocess: typeof parsed.postprocess === 'string' ? parsed.postprocess : '',
            params: typeof parsed.params === 'string' ? parsed.params : '',
        };
    } catch {
        return {...DEFAULT};
    }
}

let _state: ScriptSelection = load();

export const ScriptStore = {
    get(): ScriptSelection {
        return {..._state};
    },
    set(next: Partial<ScriptSelection>) {
        _state = {..._state, ...next};
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
        } catch {/* ignore quota */}
        try {
            window.dispatchEvent(new CustomEvent('opensight:script-changed'));
        } catch {/* SSR / 测试环境无 window */}
    },
    /** 是否当前激活了任何自定义脚本（preprocess 或 postprocess）。 */
    hasActive(): boolean {
        return !!(_state.preprocess || _state.postprocess);
    },
    hasPreprocess(): boolean { return !!_state.preprocess; },
    hasPostprocess(): boolean { return !!_state.postprocess; },
    /** 解析 params 字符串为 dict；非法 JSON 时返回 null。空串返回 {}。 */
    parsedParams(): Record<string, any> | null {
        const s = _state.params.trim();
        if (!s) return {};
        try {
            const v = JSON.parse(s);
            return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
        } catch {
            return null;
        }
    },
};

/** 调用后端 /scripts/list 拉取列表。 */
export async function fetchScripts(): Promise<ScriptInfo[]> {
    const base = getEngineBaseUrl();
    const res = await fetch(`${base}/scripts/list`);
    if (!res.ok) throw new Error(`scripts/list ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.scripts) ? data.scripts : [];
}

/** 上传 .py 文件到后端 /scripts/upload。 */
export async function uploadScript(file: File): Promise<string> {
    const base = getEngineBaseUrl();
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${base}/scripts/upload`, {method: 'POST', body: fd});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `upload ${res.status}`);
    return data.name;
}

/** 删除一个脚本。 */
export async function deleteScript(name: string): Promise<void> {
    const base = getEngineBaseUrl();
    const res = await fetch(`${base}/scripts/${encodeURIComponent(name)}`, {method: 'DELETE'});
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `delete ${res.status}`);
    }
}
