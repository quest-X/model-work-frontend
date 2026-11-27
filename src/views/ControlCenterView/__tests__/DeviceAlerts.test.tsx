import {act, renderHook} from '@testing-library/react';
import {ACCOUNT_SESSION_CHANGED, AccountSession, currentAccountSession} from '../../../services/AccountService';
import type {ComputeClusterNode} from '../../../services/ComputeClusterService';
import {
    DeviceAlert, directoryAlertObservations, recordAlertObservations, useDeviceAlerts,
} from '../DeviceAlerts';

jest.mock('../../../services/AccountService', () => ({
    ...jest.requireActual('../../../services/AccountService'),
    currentAccountSession: jest.fn(),
}));

const node = (at: number, free: number, online = true): ComputeClusterNode => ({
    node_id: 'test-node', name: 'Test node', enabled: true, online,
    network_dependencies: [],
    resources: {captured_at: at, disk_total_bytes: 100, disk_free_bytes: free},
} as ComputeClusterNode);

const account = (id: string) => ({user: {account_id: id}}) as AccountSession;

afterEach(() => {
    window.localStorage.clear();
    jest.mocked(currentAccountSession).mockReset();
});

it('keeps incidents open for stale or borderline readings and reopens only on fresh evidence', () => {
    let rows: DeviceAlert[] = [];
    let history = {alerts: rows, healthyAt: {}};
    const observe = (sample: number, now: number, free: number) => {
        history = recordAlertObservations(history, directoryAlertObservations([node(sample, free)], now), now);
        rows = history.alerts;
    };

    observe(1000, 1000, 10);
    const incident = rows[0].id;
    observe(1000, 1000, 10);
    expect(rows).toHaveLength(1);
    observe(1005, 1005, 14);
    observe(1008, 1100, 16);
    expect(rows[0]).toMatchObject({id: incident, rule: 'disk', observedAt: 1000});
    expect(rows[0].recoveredAt).toBeUndefined();

    observe(1101, 1101, 15);
    expect(rows[0].recoveredAt).toBe(1101);
    observe(1100, 1102, 9);
    expect(rows).toHaveLength(1);
    observe(1103, 1103, 9);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(incident);
    expect(rows[0].recoveredAt).toBeUndefined();
});

it('preserves legacy incidents, acknowledgement and recovery for the same account', () => {
    jest.mocked(currentAccountSession).mockReturnValue(account('alert-owner'));
    const start = Date.now() / 1000 - 30;
    const legacy = recordAlertObservations(
        {alerts: [], healthyAt: {}}, directoryAlertObservations([node(start, 90, false)], start), start,
    ).alerts;
    window.localStorage.setItem('opensight:device-alerts:v1:alert-owner', JSON.stringify(legacy));
    const first = renderHook(useDeviceAlerts);
    const incident = first.result.current.alerts[0];
    expect(incident).toEqual(legacy[0]);
    act(() => first.result.current.acknowledge(incident.id));
    expect(first.result.current.alerts[0].acknowledgedAt).toBeGreaterThan(start);
    expect(first.result.current.alerts[0].recoveredAt).toBeUndefined();
    first.unmount();

    const restored = renderHook(useDeviceAlerts);
    expect(restored.result.current.alerts[0].acknowledgedAt).toBeGreaterThan(start);
    act(() => restored.result.current.observeDirectory('alert-owner', [node(start + 1, 90)], start + 1));
    expect(restored.result.current.alerts[0].recoveredAt).toBe(start + 1);

    jest.mocked(currentAccountSession).mockReturnValue(account('other-owner'));
    act(() => { window.dispatchEvent(new Event(ACCOUNT_SESSION_CHANGED)); });
    act(() => restored.result.current.observeDirectory('alert-owner', [node(start + 2, 90, false)], start + 2));
    expect(restored.result.current.alerts).toEqual([]);
});

it('keeps older evidence from opening an incident after a newer healthy reading', () => {
    const owner = 'ordered-alerts';
    jest.mocked(currentAccountSession).mockReturnValue(account(owner));
    const now = Date.now() / 1000 - 10;
    const first = renderHook(useDeviceAlerts);
    act(() => first.result.current.observeDirectory(owner, [node(now, 25)], now));
    first.unmount();

    const restored = renderHook(useDeviceAlerts);
    const observe = (sampleAt: number, free: number) => {
        act(() => restored.result.current.observeDirectory(owner, [node(sampleAt, free)], now + 5));
    };
    observe(now - 1, 5);
    expect(restored.result.current.alerts).toEqual([]);

    observe(now + 1, 5);
    expect(restored.result.current.alerts).toHaveLength(1);
    observe(now + 2, 20);
    observe(now + 4, 20);
    observe(now + 3, 5);
    expect(restored.result.current.alerts).toHaveLength(1);
    expect(restored.result.current.alerts[0].recoveredAt).toBe(now + 2);
});
