import {useCallback, useEffect, useRef, useState} from 'react';
import {ACCOUNT_SESSION_CHANGED, currentAccountSession} from '../../services/AccountService';
import type {ComputeClusterNode, ComputeRuntimeState} from '../../services/ComputeClusterService';
import type {DeviceCheck} from './DeviceChecks';
import type {ProgramLogScope} from './ProgramRunnerPanel';

type AlertRule = 'offline' | 'ssh' | 'disk' | 'service' | 'program' | 'performance';
type Severity = 'critical' | 'warning';

type Observation = {
    nodeId: string;
    nodeName: string;
    rule: AlertRule;
    subject: string;
    label: string;
    severity: Severity;
    at: number;
    faulty: boolean;
    log?: ProgramLogScope;
};

export type DeviceAlert = Omit<Observation, 'at' | 'faulty'> & {
    id: string;
    openedAt: number;
    observedAt: number;
    acknowledgedAt?: number;
    recoveredAt?: number;
};

type AlertHistory = {alerts: DeviceAlert[]; healthyAt: Record<string, number>};
const emptyHistory = (): AlertHistory => ({alerts: [], healthyAt: {}});
const STORAGE_PREFIX = 'opensight:device-alerts:v2:';
const LEGACY_STORAGE_PREFIX = 'opensight:device-alerts:v1:';
const RECOVERED_LIMIT = 100;
const MAX_EVIDENCE_AGE = 90;
const rules: AlertRule[] = ['offline', 'ssh', 'disk', 'service', 'program', 'performance'];
const storageKey = (owner: string) => STORAGE_PREFIX + encodeURIComponent(owner);
export const deviceAlertAccount = () => currentAccountSession()?.user.account_id || '';
const validTime = (at: unknown): at is number => typeof at === 'number' && Number.isFinite(at) && at > 0 && at <= 8.64e12;
const fresh = (at: number, now: number) => validTime(at) && Math.abs(now - at) <= MAX_EVIDENCE_AGE;
const fault = (state: ComputeRuntimeState) => state === 'degraded' || state === 'unavailable';
const severity = (state: ComputeRuntimeState) => state === 'degraded' ? 'warning' : 'critical';

export const directoryAlertObservations = (nodes: ComputeClusterNode[], at: number): Observation[] =>
    nodes.flatMap(node => {
        if (!node.enabled) return [];
        const identity = {nodeId: node.node_id, nodeName: node.name, subject: '', label: ''};
        const observations: Observation[] = [{
            ...identity, rule: 'offline', severity: 'critical', at, faulty: !node.online,
        }];
        const ssh = node.network_dependencies.find(item => item.dependency_id === 'control_ssh');
        if (ssh && fresh(ssh.checked_at, at) && ssh.state !== 'unknown') {
            observations.push({
                ...identity, rule: 'ssh', severity: severity(ssh.state), at: ssh.checked_at, faulty: fault(ssh.state),
            });
        }
        const {captured_at: capturedAt, disk_total_bytes: total, disk_free_bytes: free} = node.resources;
        if (node.online && fresh(capturedAt, at) && total > 0 && free >= 0 && free <= total) {
            const ratio = free / total;
            if (ratio <= 0.10 || ratio >= 0.15) {
                observations.push({
                    ...identity, rule: 'disk', severity: 'warning', at: capturedAt, faulty: ratio <= 0.10,
                });
            }
        }
        return observations;
    });

const checkAlertObservations = (node: ComputeClusterNode, check: DeviceCheck): Observation[] => {
    if (!check.summary || check.summary.status === 'cancelled' || !node.online) return [];
    const at = check.summary.finishedAt;
    const identity = {nodeId: node.node_id, nodeName: node.name};
    const serviceObservations = check.runtime.status === 'ready'
        ? check.runtime.value.services.flatMap((service): Observation[] => {
            const {state, checked_at: checkedAt} = service.health;
            if (!fresh(checkedAt, at) || state === 'unknown') return [];
            return [{
                ...identity, rule: 'service', subject: service.service_id, label: service.name,
                severity: severity(state), at: checkedAt, faulty: fault(state),
                log: service.service_id === 'task-executor'
                    ? {kind: 'runtime', id: service.service_id, checkedAt} : undefined,
            }];
        }) : [];
    const programObservations = check.programs.status === 'ready'
        ? check.programs.value.programs.flatMap((program): Observation[] => {
            const stopped = program.service.state === 'stopped';
            const {state, checked_at: checkedAt} = program.health;
            const observedAt = stopped && check.programs.status === 'ready'
                ? check.programs.value.captured_at : checkedAt;
            if (!fresh(observedAt, at) || (!stopped && state === 'unknown')) return [];
            if (state === 'healthy' && !stopped && program.service.state !== 'running') return [];
            return [{
                ...identity, rule: 'program', subject: program.program_id, label: program.name,
                severity: stopped ? 'critical' : severity(state), at: observedAt, faulty: stopped || fault(state),
                log: {kind: 'program', id: program.program_id, checkedAt: observedAt},
            }];
        }) : [];
    const performanceObservations = check.performance.status === 'ready' && check.performance.value.coverage_sufficient
        ? check.performance.value.evidence.filter(item => item.sufficient).map((item): Observation => ({
            ...identity, rule: 'performance', subject: item.metric, label: '',
            severity: 'warning', at, faulty: item.sustained,
        })) : [];
    return [...serviceObservations, ...programObservations, ...performanceObservations];
};

const ruleKey = (item: Pick<DeviceAlert, 'nodeId' | 'rule' | 'subject'>) =>
    JSON.stringify([item.nodeId, item.rule, item.subject]);

const newestFirst = (left: DeviceAlert, right: DeviceAlert) => right.openedAt - left.openedAt;

const latestIncidents = (alerts: DeviceAlert[]) => {
    const latest = new Map<string, DeviceAlert>();
    for (const alert of alerts) {
        const key = ruleKey(alert);
        if (alert.openedAt > (latest.get(key)?.openedAt ?? 0)) latest.set(key, alert);
    }
    return latest;
};

// Keep recent healthy evidence even when there is no incident to show.
export const recordAlertObservations = (
    previous: AlertHistory, observations: Observation[], now: number,
): AlertHistory => {
    const healthyAt = Object.fromEntries(Object.entries(previous.healthyAt)
        .filter(([, at]) => at >= now - 2 * MAX_EVIDENCE_AGE));
    let healthyChanged = Object.keys(healthyAt).length !== Object.keys(previous.healthyAt).length;
    const latest = latestIncidents(previous.alerts);
    const changes = new Map<string, DeviceAlert>();
    for (const {at, faulty, ...observation} of observations) {
        const key = ruleKey(observation);
        const current = latest.get(key);
        if (!fresh(at, now) || at <= Math.max(current?.observedAt || 0, healthyAt[key] || 0)) continue;
        let next: DeviceAlert;
        if (faulty) {
            next = current && !current.recoveredAt
                ? {...current, ...observation, observedAt: at}
                : {...observation, id: JSON.stringify([key, at]), openedAt: at, observedAt: at};
        } else {
            healthyAt[key] = at;
            healthyChanged = true;
            if (!current || current.recoveredAt) continue;
            next = {...current, observedAt: at, recoveredAt: at};
        }
        changes.set(next.id, next);
        latest.set(key, next);
    }
    if (!changes.size) return healthyChanged ? {...previous, healthyAt} : previous;
    const rows = [...previous.alerts.filter(row => !changes.has(row.id)), ...changes.values()].sort(newestFirst);
    return {
        alerts: rows.filter(row => !row.recoveredAt).concat(rows.filter(row => row.recoveredAt).slice(0, RECOVERED_LIMIT)),
        healthyAt,
    };
};

const validLog = (log: DeviceAlert['log']) => !log || (
    (log.kind === 'runtime' || log.kind === 'program')
    && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(log.id) && validTime(log.checkedAt)
);

// Storage is untrusted and may contain records from older builds.
// eslint-disable-next-line complexity
const validAlert = (row: DeviceAlert | null): row is DeviceAlert => Boolean(row
    && typeof row.id === 'string' && typeof row.nodeId === 'string' && typeof row.nodeName === 'string'
    && rules.includes(row.rule) && typeof row.subject === 'string' && typeof row.label === 'string'
    && (row.severity === 'critical' || row.severity === 'warning')
    && validTime(row.openedAt) && validTime(row.observedAt) && row.observedAt >= row.openedAt
    && (row.recoveredAt === undefined || validTime(row.recoveredAt))
    && (row.acknowledgedAt === undefined || validTime(row.acknowledgedAt)) && validLog(row.log));

const readAlertHistory = (owner: string): AlertHistory => {
    const raw = window.localStorage.getItem(storageKey(owner))
        ?? window.localStorage.getItem(LEGACY_STORAGE_PREFIX + encodeURIComponent(owner));
    try {
        const saved = JSON.parse(raw || 'null') as Partial<AlertHistory> | DeviceAlert[] | null;
        const alerts = Array.isArray(saved) ? saved : saved?.alerts;
        const healthyAt = Array.isArray(saved) ? {} : saved?.healthyAt;
        return {
            alerts: Array.isArray(alerts) ? alerts.filter(validAlert).sort(newestFirst) : [],
            healthyAt: Object.fromEntries(Object.entries(healthyAt || {}).filter(([, at]) => validTime(at))),
        };
    } catch {
        return emptyHistory();
    }
};

const loadLedger = (owner: string) => {
    try {
        return {owner, history: owner ? readAlertHistory(owner) : emptyHistory(), volatile: false};
    } catch {
        return {owner, history: emptyHistory(), volatile: true};
    }
};

export const useDeviceAlerts = () => {
    const [ledger, setLedger] = useState(() => loadLedger(deviceAlertAccount()));
    const current = useRef(ledger);

    useEffect(() => {
        const selectAccount = () => {
            const owner = deviceAlertAccount();
            if (current.current.owner === owner) return;
            current.current = loadLedger(owner);
            setLedger(current.current);
        };
        const sync = (event: StorageEvent) => {
            const {owner, volatile} = current.current;
            if (!owner || volatile || (event.key !== null && event.key !== storageKey(owner))) return;
            const saved = loadLedger(owner);
            current.current = saved.volatile ? {...current.current, volatile: true} : saved;
            setLedger(current.current);
        };
        window.addEventListener(ACCOUNT_SESSION_CHANGED, selectAccount);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(ACCOUNT_SESSION_CHANGED, selectAccount);
            window.removeEventListener('storage', sync);
        };
    }, []);

    const commit = useCallback((owner: string, update: (history: AlertHistory) => AlertHistory) => {
        const apply = () => {
            const active = current.current;
            if (active.owner !== owner || deviceAlertAccount() !== owner) return;
            let history = active.history;
            let volatile = active.volatile;
            if (owner && !volatile) {
                try {
                    history = readAlertHistory(owner);
                } catch {
                    volatile = true;
                }
            }
            const next = update(history);
            if (owner && !volatile && next !== history) {
                try {
                    window.localStorage.setItem(storageKey(owner), JSON.stringify(next));
                } catch {
                    volatile = true;
                }
            }
            if (next !== history || volatile !== active.volatile) {
                current.current = {owner, history: next, volatile};
                setLedger(current.current);
            }
        };
        if (owner && navigator.locks) {
            void navigator.locks.request(storageKey(owner), apply).catch(() => apply());
        } else {
            apply();
        }
    }, []);

    const observeDirectory = useCallback((owner: string, nodes: ComputeClusterNode[], at: number) => {
        const observations = directoryAlertObservations(nodes, at);
        if (observations.length) commit(owner, history => recordAlertObservations(history, observations, Date.now() / 1000));
    }, [commit]);
    const observeCheck = useCallback((owner: string, node: ComputeClusterNode, check: DeviceCheck) => {
        const observations = checkAlertObservations(node, check);
        if (observations.length) commit(owner, history => recordAlertObservations(history, observations, Date.now() / 1000));
    }, [commit]);
    const acknowledge = (id: string) => {
        const at = Date.now() / 1000;
        commit(ledger.owner, history => {
            const row = history.alerts.find(item => item.id === id);
            if (!row || row.acknowledgedAt || row.recoveredAt) return history;
            return {...history, alerts: history.alerts.map(item => item.id === id ? {...item, acknowledgedAt: at} : item)};
        });
    };
    return {alerts: ledger.history.alerts, persistent: Boolean(ledger.owner && !ledger.volatile), observeDirectory, observeCheck, acknowledge};
};
