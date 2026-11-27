import {act, renderHook, waitFor} from '@testing-library/react';
import {
    ACCOUNT_SESSION_CHANGED, AccountSession, currentAccountSession,
} from '../../../services/AccountService';
import {
    ComputeClusterNode, ComputeClusterRequestError, ComputeClusterService, ComputeProgramSnapshot, ComputeRuntimeSnapshot,
} from '../../../services/ComputeClusterService';
import {runDeviceCheck, useDeviceChecks} from '../DeviceChecks';

jest.mock('../../../services/AccountService', () => ({
    ...jest.requireActual('../../../services/AccountService'),
    currentAccountSession: jest.fn(),
}));

const machine = (nodeId: string, online = true) => ({
    node_id: nodeId, online, capabilities: ['runtime.read.v1'],
}) as ComputeClusterNode;

const session = (id: string) => ({user: {account_id: id}}) as AccountSession;

const runtime = (state: 'healthy' | 'unavailable' = 'healthy'): ComputeRuntimeSnapshot => {
    const now = Date.now() / 1000;
    return {
        schema_version: 'runtime.snapshot.v1', captured_at: now,
        summary: {total: 1, healthy: 0, degraded: 0, unavailable: 0, task_counts: {}},
        services: [{
            service_id: 'task-executor', name: 'Task executor', kind: 'worker',
            state, version: '1', uptime_seconds: 1, restart_count: null,
            health: {state, checked_at: now, status_code: 200, latency_ms: 1},
            process: {pid: 1, state: 'running'},
        }],
    };
};

afterEach(() => {
    window.localStorage.clear();
    jest.mocked(currentAccountSession).mockReset();
    jest.restoreAllMocks();
    jest.useRealTimers();
});

it('restores separate machine summaries for the signed-in account after remount', async () => {
    jest.mocked(currentAccountSession).mockReturnValue(session('fixture-a'));
    jest.spyOn(ComputeClusterService, 'runtime').mockResolvedValue(runtime('unavailable'));
    const first = renderHook(useDeviceChecks);
    act(() => first.result.current.startSingle(machine('a')));
    await waitFor(() => expect(first.result.current.active).toBeUndefined());
    expect(first.result.current.history).toEqual([expect.objectContaining({
        nodeId: 'a', status: 'fault', log: {kind: 'runtime', id: 'task-executor', checkedAt: expect.any(Number)},
    })]);
    first.unmount();

    const restored = renderHook(useDeviceChecks);
    expect(restored.result.current.history).toHaveLength(1);
    expect(restored.result.current.checks).toEqual({});
    jest.mocked(currentAccountSession).mockReturnValue(session('fixture-b'));
    act(() => { window.dispatchEvent(new Event(ACCOUNT_SESSION_CHANGED)); });
    expect(restored.result.current.history).toEqual([]);
    expect(restored.result.current.checks).toEqual({});
});

it('limits concurrent checks, skips an offline machine and cancels queued work', async () => {
    jest.mocked(currentAccountSession).mockReturnValue(session('batch-account'));
    const queued = new Map<string, (value: ComputeRuntimeSnapshot) => void>();
    const read = jest.spyOn(ComputeClusterService, 'runtime').mockImplementation(id => new Promise(resolve => {
        queued.set(id, resolve);
    }));
    const {result} = renderHook(useDeviceChecks);
    act(() => result.current.startBatch([
        machine('offline', false), machine('a'), machine('b'), machine('c'), machine('d'), machine('e'),
    ]));
    await waitFor(() => expect(read.mock.calls.map(args => args[0])).toEqual(['a', 'b', 'c']));
    await act(async () => queued.get('a')?.(runtime()));
    await waitFor(() => expect(read.mock.calls.map(args => args[0])).toEqual(['a', 'b', 'c', 'd']));
    act(() => result.current.cancelBatch());
    await waitFor(() => expect(result.current.active).toBeUndefined());
    expect(read.mock.calls.map(args => args[0])).not.toContain('e');
    expect(result.current.batch?.cancelled).toBe(true);
    expect(result.current.batch?.rows.map(row => row.check?.summary?.status)).toEqual([
        'offline', 'incomplete', 'cancelled', 'cancelled', 'cancelled', undefined,
    ]);
    expect(result.current.history.map(item => item.nodeId).sort()).toEqual(['a', 'offline']);
});

it('uses one read of each supported evidence source for the same machine', async () => {
    const item = machine('performance');
    item.capabilities.push('runtime.programs.read.v1', 'runtime.performance.diagnose.v1');
    const runtimeRead = jest.spyOn(ComputeClusterService, 'runtime').mockResolvedValue(runtime());
    const programs = jest.spyOn(ComputeClusterService, 'programs').mockResolvedValue({
        schema_version: 'runtime.programs.v1', captured_at: Date.now() / 1000, invalid_manifests: 0, programs: [],
    });
    const performance = jest.spyOn(ComputeClusterService, 'performanceDiagnosis').mockResolvedValue({
        schema_version: 'performance.diagnosis-result.v1', window_seconds: 300, observed_seconds: 300,
        sample_count: 10, coverage_sufficient: true, evidence: [],
        findings: [{code: 'sustained_high_cpu', severity: 'warning', metric: 'cpu_percent', evidence_index: 0}],
    });
    const check = await runDeviceCheck(item, new AbortController().signal, jest.fn());
    expect(check.summary).toMatchObject({nodeId: item.node_id, status: 'fault', faults: 1});
    expect(runtimeRead).toHaveBeenCalledTimes(1);
    expect(programs).toHaveBeenCalledTimes(1);
    expect(performance).toHaveBeenCalledTimes(1);
    expect(performance).toHaveBeenCalledWith(item.node_id, 300, expect.any(AbortSignal));
});

it('preserves independently verified results when one check is denied', async () => {
    const item = machine('limited');
    item.capabilities.push('runtime.programs.read.v1', 'runtime.performance.diagnose.v1');
    jest.spyOn(ComputeClusterService, 'runtime').mockResolvedValue(runtime());
    jest.spyOn(ComputeClusterService, 'programs').mockRejectedValue(new ComputeClusterRequestError(403, 'forbidden'));
    jest.spyOn(ComputeClusterService, 'performanceDiagnosis').mockRejectedValue(new Error('network error'));
    const result = await runDeviceCheck(item, new AbortController().signal, jest.fn());
    expect(result).toMatchObject({
        runtime: {status: 'ready'},
        programs: {status: 'denied'},
        performance: {status: 'failed'},
        summary: {status: 'incomplete', faults: 0},
    });
});

it('links a stopped program to its observed snapshot time when no health probe has run', async () => {
    const item = machine('stopped');
    item.capabilities.push('runtime.programs.read.v1');
    const captured = Date.now() / 1000;
    jest.spyOn(ComputeClusterService, 'runtime').mockResolvedValue(runtime());
    jest.spyOn(ComputeClusterService, 'programs').mockResolvedValue({
        schema_version: 'runtime.programs.v1', captured_at: captured, invalid_manifests: 0,
        programs: [{
            program_id: 'vision', service: {state: 'stopped'}, health: {state: 'unknown', checked_at: 0},
        } as ComputeProgramSnapshot['programs'][number]],
    });
    const result = await runDeviceCheck(item, new AbortController().signal, jest.fn());
    expect(result.summary).toMatchObject({
        status: 'fault', faults: 1, log: {kind: 'program', id: 'vision', checkedAt: captured},
    });
});

it('times out an unresponsive read and completes without waiting for its promise', async () => {
    jest.useFakeTimers();
    const fetchRuntime = jest.spyOn(ComputeClusterService, 'runtime').mockReturnValue(new Promise(() => undefined));
    const result = runDeviceCheck(machine('slow'), new AbortController().signal, jest.fn());
    await Promise.resolve();
    jest.advanceTimersByTime(35000);
    expect(await result).toMatchObject({runtime: {status: 'timed-out'}, summary: {status: 'incomplete'}});
    expect(fetchRuntime.mock.calls[0][1]?.aborted).toBe(true);
});

it('aborts an outstanding check when the signed-in account changes', async () => {
    jest.mocked(currentAccountSession).mockReturnValue(session('fixture-a'));
    const read = jest.spyOn(ComputeClusterService, 'runtime').mockReturnValue(new Promise(() => undefined));
    const {result} = renderHook(useDeviceChecks);
    act(() => result.current.startSingle(machine('a')));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    jest.mocked(currentAccountSession).mockReturnValue(session('fixture-b'));
    act(() => { window.dispatchEvent(new Event(ACCOUNT_SESSION_CHANGED)); });
    expect(read.mock.calls[0][1]?.aborted).toBe(true);
    expect(result.current.active).toBeUndefined();
    expect(result.current.checks).toEqual({});
    expect(window.localStorage.length).toBe(0);
});
