import {useEffect, useRef, useState} from 'react';
import {ACCOUNT_SESSION_CHANGED, currentAccountSession} from '../../services/AccountService';
import {
    ComputeClusterNode, ComputeClusterService, ComputePerformanceDiagnosis,
    ComputeProgramSnapshot, ComputeRuntimeSnapshot, ComputeRuntimeState, isComputeAccessDenied,
} from '../../services/ComputeClusterService';
import type {ProgramLogScope} from './ProgramRunnerPanel';

export type Check<T> = {status: 'pending' | 'unavailable' | 'denied' | 'failed' | 'timed-out' | 'cancelled'}
    | {status: 'ready'; value: T};

type CheckSummaryStatus = 'normal' | 'fault' | 'incomplete' | 'offline' | 'unavailable' | 'cancelled';

export type DeviceCheckSummary = {
    id: string;
    nodeId: string;
    finishedAt: number;
    status: CheckSummaryStatus;
    faults: number;
    log?: ProgramLogScope;
};

export type DeviceCheck = {
    runtime: Check<ComputeRuntimeSnapshot>;
    programs: Check<ComputeProgramSnapshot>;
    performance: Check<ComputePerformanceDiagnosis>;
    summary?: DeviceCheckSummary;
};

export type BatchDeviceCheck = {
    rows: {node: ComputeClusterNode; check?: DeviceCheck}[];
    cancelled: boolean;
};

const CHECK_TIMEOUT_MS = 35000;
const BATCH_CONCURRENCY = 3;
const HISTORY_PER_NODE = 10;
const HISTORY_PER_ACCOUNT = 200;
const ACCOUNT_HISTORY_KEY = 'opensight:device-check:v1:';
const accountId = () => currentAccountSession()?.user.account_id || '';
const historyPrefix = (account: string) => `${ACCOUNT_HISTORY_KEY}${encodeURIComponent(account)}:`;

export const checkMessage = (status: Check<unknown>['status'], zh: boolean) => ({
    pending: zh ? '读取中…' : 'Reading…',
    unavailable: zh ? '当前节点离线或不支持此检查。' : 'The node is offline or does not support this check.',
    denied: zh ? '当前账号无权读取此检查结果。' : 'Your account cannot read this check result.',
    failed: zh ? '读取失败，请重试。' : 'Read failed. Try again.',
    'timed-out': zh ? '读取超时，请重试。' : 'Read timed out. Try again.',
    cancelled: zh ? '已取消读取。' : 'Read cancelled.',
    ready: '',
})[status];

export const checkSummaryLabel = (status: CheckSummaryStatus, zh: boolean) => ({
    normal: zh ? '正常' : 'Normal',
    fault: zh ? '故障' : 'Fault',
    incomplete: zh ? '检查不完整' : 'Incomplete',
    offline: zh ? '离线' : 'Offline',
    unavailable: zh ? '不支持自检' : 'Self-check unavailable',
    cancelled: zh ? '已取消' : 'Cancelled',
})[status];

const summaryStatuses: CheckSummaryStatus[] = ['normal', 'fault', 'incomplete', 'offline', 'unavailable', 'cancelled'];

const validLog = (log?: ProgramLogScope) => !log || (
    (log.kind === 'runtime' || log.kind === 'program')
    && typeof log.id === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(log.id)
    && Number.isFinite(log.checkedAt) && log.checkedAt > 0 && log.checkedAt <= 8.64e12
);

const loadHistory = (account: string): DeviceCheckSummary[] => {
    if (!account) return [];
    const prefix = historyPrefix(account);
    try {
        return Object.keys(window.localStorage)
            .filter(key => key.startsWith(prefix))
            .flatMap(key => {
                try {
                    const item = JSON.parse(window.localStorage.getItem(key) || 'null') as DeviceCheckSummary | null;
                    if (item && typeof item.id === 'string' && key === prefix + item.id && typeof item.nodeId === 'string'
                        && Number.isFinite(item.finishedAt) && item.finishedAt > 0 && item.finishedAt <= 8.64e12
                        && summaryStatuses.includes(item.status) && Number.isInteger(item.faults)
                        && item.faults >= 0 && validLog(item.log)) return [item];
                } catch { /* A malformed record does not hide the other records. */ }
                return [];
            }).sort((left, right) => right.finishedAt - left.finishedAt || right.id.localeCompare(left.id));
    } catch {
        return [];
    }
};

const storeHistory = (account: string, summary: DeviceCheckSummary) => {
    if (!account) return false;
    const prefix = historyPrefix(account);
    try {
        window.localStorage.setItem(prefix + summary.id, JSON.stringify(summary));
        const counts = new Map<string, number>();
        loadHistory(account).forEach((item, index) => {
            const count = (counts.get(item.nodeId) || 0) + 1;
            counts.set(item.nodeId, count);
            if (index >= HISTORY_PER_ACCOUNT || count > HISTORY_PER_NODE) {
                window.localStorage.removeItem(prefix + item.id);
            }
        });
        return true;
    } catch {
        return false;
    }
};

const availableCheck = <T>(node: ComputeClusterNode, capability: string): Check<T> =>
    ({status: node.online && node.capabilities.includes(capability) ? 'pending' : 'unavailable'});

const readCheck = <T>(
    initial: Check<T>, signal: AbortSignal, cancelled: AbortSignal,
    load: () => Promise<T>, publish: (check: Check<T>) => void,
): Promise<void> => {
    if (initial.status !== 'pending') return Promise.resolve();
    return new Promise(resolve => {
        const onAbort = () => {
            publish({status: cancelled.aborted ? 'cancelled' : 'timed-out'});
            resolve();
        };
        const finish = (check: Check<T>) => {
            signal.removeEventListener('abort', onAbort);
            publish(check);
            resolve();
        };
        if (signal.aborted) {
            onAbort();
            return;
        }
        signal.addEventListener('abort', onAbort, {once: true});
        void Promise.resolve().then(() => signal.aborted ? undefined : load()).then(value => {
            if (!signal.aborted) finish(value === undefined ? {status: 'failed'} : {status: 'ready', value});
        }, error => {
            if (!signal.aborted) finish({status: isComputeAccessDenied(error) ? 'denied' : 'failed'});
        });
    });
};

export const isFreshDeviceEvidence = (checkedAt: number, now: number) =>
    checkedAt > 0 && Math.abs(now - checkedAt) <= 90;

const confirmed = (state: ComputeRuntimeState, checkedAt: number, now: number) =>
    state !== 'unknown' && isFreshDeviceEvidence(checkedAt, now);

export const programCheckEvidence = (program: ComputeProgramSnapshot['programs'][number], capturedAt: number):
    {state: ComputeRuntimeState; checkedAt: number} => program.service.state === 'stopped'
    ? {state: 'unavailable', checkedAt: capturedAt}
    : {state: program.health.state, checkedAt: program.health.checked_at};

const fault = (state: ComputeRuntimeState) => state === 'degraded' || state === 'unavailable';

// A historical summary contains only statuses, timestamps and one actionable log reference.
// eslint-disable-next-line complexity
const summarize = (node: ComputeClusterNode, check: DeviceCheck, id: string): DeviceCheckSummary => {
    const finishedAt = Date.now() / 1000;
    const services = check.runtime.status === 'ready' ? check.runtime.value.services : [];
    const snapshot = check.programs.status === 'ready' ? check.programs.value : undefined;
    const programs = snapshot?.programs.map(program => ({
        id: program.program_id, ...programCheckEvidence(program, snapshot.captured_at),
    })) || [];
    const diagnosis = check.performance.status === 'ready' ? check.performance.value : null;
    const failedServices = services.filter(item => confirmed(item.health.state, item.health.checked_at, finishedAt)
        && fault(item.health.state));
    const failedPrograms = programs.filter(item => confirmed(item.state, item.checkedAt, finishedAt) && fault(item.state));
    const faults = failedServices.length + failedPrograms.length + (diagnosis?.findings.length || 0);
    const executor = failedServices.find(item => item.service_id === 'task-executor');
    const program = failedPrograms[0];
    const log: ProgramLogScope | undefined = executor
        ? {kind: 'runtime', id: executor.service_id, checkedAt: executor.health.checked_at}
        : program && {kind: 'program', id: program.id, checkedAt: program.checkedAt};
    const statuses = [check.runtime.status, check.programs.status, check.performance.status];
    const verified = statuses.every(status => status === 'ready') && services.length > 0
        && services.every(item => confirmed(item.health.state, item.health.checked_at, finishedAt))
        && programs.every(item => confirmed(item.state, item.checkedAt, finishedAt))
        && snapshot && isFreshDeviceEvidence(snapshot.captured_at, finishedAt) && snapshot.invalid_manifests === 0
        && diagnosis?.coverage_sufficient;
    const status = statuses.includes('cancelled') ? 'cancelled'
        : !node.online ? 'offline'
            : faults ? 'fault'
                : statuses.every(value => value === 'unavailable') ? 'unavailable'
                    : verified ? 'normal' : 'incomplete';
    return {id, nodeId: node.node_id, finishedAt, faults, status, log};
};

export const runDeviceCheck = async (
    node: ComputeClusterNode, cancelled: AbortSignal, publish: (check: DeviceCheck) => void,
): Promise<DeviceCheck> => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    cancelled.addEventListener('abort', abort, {once: true});
    if (cancelled.aborted) abort();
    const timeout = window.setTimeout(abort, CHECK_TIMEOUT_MS);
    const {signal} = controller;
    let current: DeviceCheck = {
        runtime: availableCheck(node, 'runtime.read.v1'),
        programs: availableCheck(node, 'runtime.programs.read.v1'),
        performance: availableCheck(node, 'runtime.performance.diagnose.v1'),
    };
    const update = (change: Partial<DeviceCheck>) => {
        current = {...current, ...change};
        publish(current);
    };
    publish(current);
    try {
        await Promise.all([
            readCheck(current.runtime, signal, cancelled, async () => {
                const result = await ComputeClusterService.runtime(node.node_id, signal);
                if (result.schema_version !== 'runtime.snapshot.v1' || !Array.isArray(result.services)) {
                    throw new Error('runtime_snapshot_invalid');
                }
                return result;
            }, runtime => update({runtime})),
            readCheck(current.programs, signal, cancelled, async () => {
                const result = await ComputeClusterService.programs(node.node_id, signal);
                if (result.schema_version !== 'runtime.programs.v1' || !Array.isArray(result.programs)) {
                    throw new Error('program_snapshot_invalid');
                }
                return result;
            }, programs => update({programs})),
            readCheck(current.performance, signal, cancelled, async () => {
                const result = await ComputeClusterService.performanceDiagnosis(node.node_id, 300, signal);
                if (result.schema_version !== 'performance.diagnosis-result.v1' || result.window_seconds !== 300
                    || !Array.isArray(result.evidence) || !Array.isArray(result.findings)) {
                    throw new Error('performance_diagnosis_invalid');
                }
                return result;
            }, performance => update({performance})),
        ]);
        update({summary: summarize(node, current, id)});
        return current;
    } finally {
        window.clearTimeout(timeout);
        cancelled.removeEventListener('abort', abort);
    }
};

export const useDeviceChecks = (onCompleted?: (owner: string, node: ComputeClusterNode, check: DeviceCheck) => void) => {
    const [history, setHistory] = useState(() => loadHistory(accountId()));
    const [storageFailed, setStorageFailed] = useState(false);
    const [checks, setChecks] = useState<Record<string, DeviceCheck>>({});
    const [batch, setBatch] = useState<BatchDeviceCheck>();
    const [active, setActive] = useState<'single' | 'batch'>();
    const run = useRef<AbortController>();
    const account = useRef(accountId());

    useEffect(() => {
        const updateAccount = () => {
            const next = accountId();
            if (next === account.current) return;
            run.current?.abort();
            run.current = undefined;
            account.current = next;
            setActive(undefined);
            setChecks({});
            setBatch(undefined);
            setStorageFailed(false);
            setHistory(loadHistory(next));
        };
        const updateHistory = (event: StorageEvent) => {
            if (account.current && (event.key === null || event.key.startsWith(historyPrefix(account.current)))) {
                setHistory(loadHistory(account.current));
            }
        };
        window.addEventListener(ACCOUNT_SESSION_CHANGED, updateAccount);
        window.addEventListener('storage', updateHistory);
        return () => {
            const controller = run.current;
            run.current = undefined;
            controller?.abort();
            window.removeEventListener(ACCOUNT_SESSION_CHANGED, updateAccount);
            window.removeEventListener('storage', updateHistory);
        };
    }, []);

    const start = async (nodes: ComputeClusterNode[], mode: 'single' | 'batch') => {
        if (run.current || !nodes.length) return;
        const controller = new AbortController();
        const owner = account.current;
        run.current = controller;
        setActive(mode);
        if (mode === 'batch') setBatch({rows: nodes.map(node => ({node})), cancelled: false});
        const current = () => run.current === controller && accountId() === owner;
        let index = 0;
        const worker = async () => {
            while (index < nodes.length && !controller.signal.aborted && current()) {
                const node = nodes[index++];
                const publish = (check: DeviceCheck) => {
                    if (!current()) return;
                    setChecks(previous => ({...previous, [node.node_id]: check}));
                    if (mode === 'batch') setBatch(previous => previous && ({
                        ...previous,
                        rows: previous.rows.map(row => row.node.node_id === node.node_id ? {...row, check} : row),
                    }));
                };
                const result = await runDeviceCheck(node, controller.signal, publish);
                const {summary} = result;
                if (current() && summary && summary.status !== 'cancelled') {
                    onCompleted?.(owner, node, result);
                    const stored = storeHistory(owner, summary);
                    if (owner && !stored) setStorageFailed(true);
                    setHistory(previous => {
                        const rows = stored ? loadHistory(owner) : [summary, ...previous];
                        return rows.filter(item => item.nodeId === node.node_id).slice(0, HISTORY_PER_NODE)
                            .concat(rows.filter(item => item.nodeId !== node.node_id)).slice(0, HISTORY_PER_ACCOUNT);
                    });
                }
            }
        };
        try {
            await Promise.all(Array.from({length: Math.min(BATCH_CONCURRENCY, nodes.length)}, worker));
        } finally {
            if (current()) {
                if (mode === 'batch' && controller.signal.aborted) setBatch(previous => previous && ({
                    ...previous, cancelled: true,
                }));
                run.current = undefined;
                setActive(undefined);
            }
        }
    };

    return {
        checks, history, batch, active, storageFailed,
        startSingle: (node: ComputeClusterNode) => void start([node], 'single'),
        startBatch: (nodes: ComputeClusterNode[]) => void start(nodes, 'batch'),
        cancelBatch: () => { if (active === 'batch') run.current?.abort(); },
    };
};
