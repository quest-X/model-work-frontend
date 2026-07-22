export type HostSystem = 'macos' | 'windows' | 'linux' | 'unknown';

declare const __OPENSIGHT_HOST_SYSTEM__: string;

/** Normalize Console / browser platform labels into one stable frontend value. */
export const normalizeHostSystem = (value: string | null | undefined): HostSystem => {
    const normalized = (value || '').trim().toLowerCase();
    if (!normalized) return 'unknown';
    if (normalized.includes('mac') || normalized.includes('darwin')) return 'macos';
    if (normalized.includes('win')) return 'windows';
    if (normalized.includes('linux')) return 'linux';
    return 'unknown';
};

/**
 * The Console-provided host system is authoritative because inference runs on
 * that host, which can differ from the computer running the browser. Older
 * launch paths that do not inject it fall back to the browser platform.
 */
export const getHostSystem = (): HostSystem => {
    const consoleSystem = typeof __OPENSIGHT_HOST_SYSTEM__ === 'undefined'
        ? ''
        : __OPENSIGHT_HOST_SYSTEM__;
    const browserSystem = typeof navigator === 'undefined'
        ? ''
        : navigator.platform || navigator.userAgent;
    return normalizeHostSystem(consoleSystem || browserSystem);
};

export const supportsCoreML = (system: HostSystem): boolean => system === 'macos';

export const showsTensorRTPlaceholder = (system: HostSystem): boolean => (
    system === 'windows' || system === 'linux'
);
