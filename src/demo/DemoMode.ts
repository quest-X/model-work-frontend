import type {AIModel} from '../store/aimodels/types';

declare const __OPENSIGHT_DEMO__: boolean;

export const isDemoMode = typeof __OPENSIGHT_DEMO__ !== 'undefined' && __OPENSIGHT_DEMO__;
export const DEMO_SESSION_KEY = 'opensight:demo-session';

export const demoEngines = (): AIModel[] => {
    const origin = typeof window === 'undefined' ? 'https://model.work' : window.location.origin;
    const createdAt = new Date('2026-09-07T00:00:00Z');
    return [{
        id: 'demo-core-engine',
        name: 'OpenSight Platform Demo Core',
        url: `${origin}/core_service`,
        modelType: 'core',
        description: '大鹅数据检测与分割演示引擎',
        createdAt,
        isActive: true,
    }, {
        id: 'demo-extension-engine',
        name: 'OpenSight Platform Demo Extension',
        url: `${origin}/extension_service`,
        modelType: 'extension',
        description: '大鹅相似检索与计算集群演示引擎',
        createdAt,
        isActive: true,
    }];
};

export const prepareDemoMode = async (): Promise<boolean> => {
    if (!isDemoMode) return true;
    if (!('serviceWorker' in navigator)) {
        throw new Error('当前浏览器不支持 OpenSight Platform 演示模式');
    }
    await navigator.serviceWorker.register('/demo-sw.js', {scope: '/'});
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return true;

    const controlled = await new Promise<boolean>(resolve => {
        const timer = window.setTimeout(() => resolve(false), 1500);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.clearTimeout(timer);
            resolve(true);
        }, {once: true});
    });
    if (controlled) return true;
    window.location.reload();
    return false;
};
