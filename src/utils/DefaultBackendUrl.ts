/**
 * 推导默认 backend 地址 —— 用浏览器当前访问的 host 加后端端口 (默认 8000)。
 *
 * 为什么不是 `http://localhost:8000`:当前端部署在机器 A,用户从机器 B 的浏览器
 * 访问时,硬编码的 `localhost:8000` 会让浏览器打到 **机器 B 自己** 的 8000 端口
 * (浏览器的 localhost 永远是本机),而不是前端所在的机器 A。跨机访问直接失败。
 *
 * 正确行为:以 `window.location.hostname` 为基础,这样:
 *   - 本地开发 (http://localhost:3001)  → http://localhost:8000
 *   - 局域网访问 (http://192.168.1.205:3001) → http://192.168.1.205:8000
 *   - 生产域名 (https://opensight.example.com) → https://opensight.example.com:8000
 *
 * 假设:backend 和 frontend 在同一台机器上,backend 监听 8000。不满足时用户
 * 可以在「模型引擎」popup 里手动填写任意 URL 覆盖默认值。
 */

const DEFAULT_BACKEND_PORT = 58600;

/** 返回不带路径的 backend base URL,例如 `http://192.168.1.205:8000`。 */
export const getDefaultBackendBase = (): string => {
    if (typeof window === 'undefined' || !window.location) {
        return `https://localhost:${DEFAULT_BACKEND_PORT}`;
    }
    const hostname = window.location.hostname || 'localhost';
    const isLocal = hostname === 'localhost'
        || hostname === '127.0.0.1'
        || /^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(hostname);
    if (isLocal) {
        return `https://${hostname}:${DEFAULT_BACKEND_PORT}`;
    }
    return `https://localhost:${DEFAULT_BACKEND_PORT}`;
};

/** Legacy bare-server helper. Service calls should use a service-specific base below. */
export const getDefaultBackendUrl = (path: string = ''): string => {
    const base = getDefaultBackendBase();
    if (!path) return base;
    return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
};

export type ServiceEngineType = 'core' | 'extension';

const SERVICE_PATH_BY_TYPE: Record<ServiceEngineType, string> = {
    core: 'core_service',
    extension: 'extension_service',
};

/** Canonicalise legacy root/capability URLs to the new service boundary. */
export const normalizeEngineBaseUrl = (url: string, type: ServiceEngineType): string => {
    const servicePath = SERVICE_PATH_BY_TYPE[type];
    let base = url.trim().replace(/\/+$/, '');
    if (!base) return base;
    if (base.endsWith(`/${servicePath}`)) return base;
    base = base.replace(/\/(?:core_service|extension_service|core|extension|detect|segment|ocr)$/i, '');
    return `${base}/${servicePath}`;
};

export const getDefaultCoreServiceBase = (): string =>
    normalizeEngineBaseUrl(getDefaultBackendBase(), 'core');

export const getDefaultExtensionServiceBase = (): string =>
    normalizeEngineBaseUrl(getDefaultBackendBase(), 'extension');

export const getDefaultCoreServiceUrl = (path: string = ''): string => {
    const base = getDefaultCoreServiceBase();
    if (!path) return base;
    return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
};

// 由 index.tsx 在 store 初始化后注入,避免循环依赖 + require() 不可用的问题。
let _storeRef: { getState: () => any } | null = null;

/** index.tsx 在 store 创建后调用一次,之后 getEngineBaseUrl() 就能读到正确的 store 状态。 */
export const registerEngineStore = (s: { getState: () => any }): void => {
    _storeRef = s;
};

/**
 * 优先使用用户在「引擎管理」配置的对应引擎地址。
 *
 * 解决"model.work 前端 + 远程/本地后端"场景:getDefaultBackendBase() 在公网域名下
 * 回退到 localhost,但用户手动配的引擎 URL 才是正确的后端地址。
 *
 * Core capabilities call getEngineBaseUrl(); optional services call
 * getExtensionEngineBaseUrl(). The two service boundaries never fall back to
 * each other's registered engine.
 */
const getRegisteredEngineBaseUrl = (type: ServiceEngineType): string | null => {
    try {
        if (_storeRef) {
            const state = _storeRef.getState();
            const models: any[] = state.aimodels?.models ?? [];
            const matchingModels = models.filter((m: any) => m.modelType === type && m.url);
            const activeId = state.aimodels?.activeModelId;
            if (activeId) {
                const active = matchingModels.find((m: any) => m.id === activeId);
                if (active?.url) return normalizeEngineBaseUrl(active.url, type);
            }
            const enabled = matchingModels.find((m: any) => m.isActive);
            if (enabled?.url) return normalizeEngineBaseUrl(enabled.url, type);
            if (matchingModels[0]?.url) return normalizeEngineBaseUrl(matchingModels[0].url, type);
        }
    } catch {
        // store 访问失败
    }
    return null;
};

/** Core engine base used by detection, segmentation, OCR and core services. */
export const getEngineBaseUrl = (): string =>
    getRegisteredEngineBaseUrl('core') ?? getDefaultCoreServiceBase();

/** Extension engine base used by vector search and other optional services. */
export const getExtensionEngineBaseUrl = (): string =>
    getRegisteredEngineBaseUrl('extension') ?? getDefaultExtensionServiceBase();
