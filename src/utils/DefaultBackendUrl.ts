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
        return `http://localhost:${DEFAULT_BACKEND_PORT}`;
    }
    const hostname = window.location.hostname || 'localhost';
    const isLocal = hostname === 'localhost'
        || hostname === '127.0.0.1'
        || /^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(hostname);
    if (isLocal) {
        const protocol = window.location.protocol || 'http:';
        return `${protocol}//${hostname}:${DEFAULT_BACKEND_PORT}`;
    }
    return `http://localhost:${DEFAULT_BACKEND_PORT}`;
};

/** base + path,例如 getDefaultBackendUrl('/detect') → `http://host:8000/detect`。 */
export const getDefaultBackendUrl = (path: string = ''): string => {
    const base = getDefaultBackendBase();
    if (!path) return base;
    return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
};
