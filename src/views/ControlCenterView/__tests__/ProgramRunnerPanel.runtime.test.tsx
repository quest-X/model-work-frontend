import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {
    ComputeClusterNode,
    ComputeClusterRequestError,
    ComputeClusterService,
    ComputeLanAsset,
    ComputeProgramSnapshot,
    ComputeRuntimeEvent,
    ComputeRuntimeEventWindow,
} from '../../../services/ComputeClusterService';
import {ProgramRunnerPanel} from '../ProgramRunnerPanel';

const node: ComputeClusterNode = {
    node_id: 'aipack-13',
    installation_id: 'aipack-13-installation',
    name: 'AIPACK-13',
    agent_version: '1.1.2',
    capabilities: ['runtime.read.v1', 'runtime.inventory.v1', 'runtime.programs.read.v1'],
    control_transport: 'lan',
    network: {
        provider: 'tailscale',
        installed: true,
        online: true,
        ssh_available: true,
        lan_ssh_available: true,
        tailscale_ssh_available: false,
        addresses: ['10.168.10.10'],
    },
    network_dependencies: [],
    resources: {
        captured_at: 100,
        platform: 'linux',
        architecture: 'aarch64',
        hardware_model: 'Jetson AGX Orin Developer Kit',
        cpu_logical: 8,
        load_average_1m: 1,
        memory_total_bytes: 32 * 1024 ** 3,
        memory_available_bytes: 24 * 1024 ** 3,
        disk_total_bytes: 64 * 1024 ** 3,
        disk_free_bytes: 20 * 1024 ** 3,
        gpus: [],
    },
    device_inventory: {state: 'ready', devices: []},
    enrolled_at: 1,
    last_seen_at: 100,
    enabled: true,
    online: true,
    heartbeat_age_seconds: 2,
};

const originalFetch = global.fetch;

describe('ProgramRunnerPanel', () => {
    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    const windowPage = (
        coverage: ComputeRuntimeEventWindow['window']['coverage'],
        cursor = 0,
        hasMore = false,
    ): ComputeRuntimeEventWindow => ({
        schema_version: 'runtime.events.v1',
        captured_at: 600,
        cursor,
        has_more: hasMore,
        window: {from_time: 200, to_time: 501, coverage, retained_from: coverage === 'complete' ? 100 : 250},
        events: cursor ? [{
            cursor, created_at: 300 + cursor, service_id: 'task-executor',
            level: 'info', event_type: 'task_started', message: `Historical event ${cursor}`, task_id: null,
        }] : [],
    });

    const renderHistoricalLogs = (events: ComputeRuntimeEvent[] = []) => {
        jest.spyOn(ComputeClusterService, 'runtime').mockRejectedValue(new Error('no snapshot'));
        jest.spyOn(ComputeClusterService, 'runtimeEvents').mockResolvedValue({
            schema_version: 'runtime.events.v1', captured_at: 600, cursor: events.length, has_more: false, events,
        });
        return render(<ProgramRunnerPanel
            node={{...node, node_id: 'window-node', capabilities: ['runtime.read.v1']}}
            initialView='logs'
            logScope={{kind: 'runtime', id: 'task-executor', checkedAt: 500}}
            edgeDevices={[]}
            zh
            maximized={false}
            onToggleMaximized={jest.fn()}
        />);
    };

    it('retries a historical request and appends the next page without losing loaded events', async () => {
        const query = jest.spyOn(ComputeClusterService, 'runtimeEventWindow')
            .mockRejectedValueOnce(new Error('temporarily unavailable'))
            .mockResolvedValueOnce(windowPage('complete', 1, true))
            .mockResolvedValueOnce(windowPage('complete', 2));
        renderHistoricalLogs();

        fireEvent.click(await screen.findByRole('button', {name: '重试读取历史日志'}));
        expect(await screen.findByText('Historical event 1')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '加载更多日志'}));
        expect(await screen.findByText('Historical event 2')).toBeInTheDocument();
        expect(screen.getByText('Historical event 1')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '加载更多日志'})).not.toBeInTheDocument();
        expect(query.mock.calls.map(args => args.slice(0, 4))).toEqual([
            ['window-node', 200, 501, 0],
            ['window-node', 200, 501, 0],
            ['window-node', 200, 501, 1],
        ]);
    });

    it('shows recent matching events only after the historical request fails', async () => {
        let rejectWindow: (error: Error) => void = () => undefined;
        jest.spyOn(ComputeClusterService, 'runtimeEventWindow').mockImplementation(() => new Promise((_, reject) => {
            rejectWindow = reject;
        }));
        renderHistoricalLogs(windowPage('complete', 1).events);
        await screen.findByText('正在读取历史日志…');
        expect(screen.queryByText('Historical event 1')).not.toBeInTheDocument();
        await act(async () => rejectWindow(new Error('unsupported')));
        expect(await screen.findByText('Historical event 1')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '重试读取历史日志'})).toBeInTheDocument();
    });

    it('distinguishes a recent-only response from time-window results and retries history', async () => {
        const fetchedEvent = windowPage('complete', 2).events[0];
        const legacyResponse = {
            schema_version: 'runtime.events.v1', captured_at: 600, cursor: 2, has_more: false, events: [fetchedEvent],
        };
        global.fetch = jest.fn()
            .mockResolvedValueOnce({ok: true, json: async () => legacyResponse})
            .mockResolvedValueOnce({ok: true, json: async () => windowPage('complete')});
        renderHistoricalLogs(windowPage('complete', 1).events);

        const notice = await screen.findByText('接口只返回近期日志，无法确认所选时段的覆盖情况。已读取的日志仍可查看。');
        expect(notice).toHaveAttribute('role', 'status');
        expect(await screen.findByText('Historical event 1')).toBeInTheDocument();
        expect(screen.queryByText('Historical event 2')).not.toBeInTheDocument();
        expect(screen.queryByText('该时段无日志')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '重试读取历史日志'}));
        expect(await screen.findByText('该时段无日志')).toBeInTheDocument();
        expect(notice).not.toBeInTheDocument();
        expect(screen.queryByText('Historical event 1')).not.toBeInTheDocument();
    });

    it('filters a manual history window across pages and switches back to recent logs', async () => {
        const fromInput = '2026-11-10T09:00';
        const toInput = '2026-11-10T09:30';
        const from = Date.parse(fromInput) / 1000;
        const to = Date.parse(toInput) / 1000;
        const page = (cursor: number, hasMore: boolean, message: string) => ({
            ...windowPage('complete', cursor, hasMore),
            window: {from_time: from, to_time: to, coverage: 'complete' as const, retained_from: from - 60},
            events: [{...windowPage('complete', cursor).events[0], created_at: from + cursor, message}],
        });
        jest.spyOn(ComputeClusterService, 'runtime').mockResolvedValue({
            schema_version: 'runtime.snapshot.v1',
            captured_at: to,
            summary: {
                total: 1, healthy: 1, degraded: 0, unavailable: 0,
                task_counts: {queued: 0, running: 0, paused: 0, succeeded: 0, failed: 0, cancelled: 0},
            },
            services: [{
                service_id: 'task-executor', name: 'Task Executor', kind: 'worker', state: 'healthy',
                version: '1.2.0', uptime_seconds: 60, restart_count: 0,
                health: {state: 'healthy', checked_at: to, status_code: 200, latency_ms: 1},
                process: {pid: 1, state: 'running'},
            }],
        });
        jest.spyOn(ComputeClusterService, 'runtimeEvents').mockResolvedValue({
            schema_version: 'runtime.events.v1', captured_at: to, cursor: 9, has_more: false,
            events: page(9, false, 'Recent process event').events,
        });
        const query = jest.spyOn(ComputeClusterService, 'runtimeEventWindow')
            .mockResolvedValueOnce(page(1, true, 'Task started'))
            .mockResolvedValueOnce(page(2, false, 'Request timed out'))
            .mockResolvedValueOnce(page(3, false, 'New history query'));
        render(<ProgramRunnerPanel
            node={{...node, node_id: 'manual-history-node', capabilities: ['runtime.read.v1']}}
            initialView='logs'
            edgeDevices={[]}
            zh
            maximized={false}
            onToggleMaximized={jest.fn()}
        />);

        expect(await screen.findByText('Recent process event')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox', {name: '筛选日志程序'}), {target: {value: 'runtime:task-executor'}});
        fireEvent.change(screen.getByLabelText('起始时间'), {target: {value: fromInput}});
        fireEvent.change(screen.getByLabelText('结束时间（不含）'), {target: {value: '2026-11-10T11:00'}});
        fireEvent.click(screen.getByRole('button', {name: '查找历史日志'}));
        expect(screen.getByText(/间隔最长 1 小时/)).toBeInTheDocument();
        expect(query).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('结束时间（不含）'), {target: {value: toInput}});
        fireEvent.change(screen.getByRole('searchbox', {name: '日志关键词'}), {target: {value: '  TIMED OUT  '}});
        fireEvent.click(screen.getByRole('button', {name: '查找历史日志'}));
        expect(await screen.findByText('已读范围暂无匹配记录，可继续读取')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '加载更多日志'}));
        expect(await screen.findByText('Request timed out')).toBeInTheDocument();
        expect(screen.queryByText('Task started')).not.toBeInTheDocument();
        expect(query.mock.calls.map(args => args.slice(0, 4))).toEqual([
            ['manual-history-node', from, to, 0],
            ['manual-history-node', from, to, 1],
        ]);

        fireEvent.change(screen.getByRole('searchbox', {name: '日志关键词'}), {target: {value: 'no match'}});
        expect(screen.getByText('该时段无匹配记录')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '返回最近日志'}));
        fireEvent.change(screen.getByRole('searchbox', {name: '日志关键词'}), {target: {value: ''}});
        expect(screen.getByText('Recent process event')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '查找历史日志'}));
        expect(await screen.findByText('New history query')).toBeInTheDocument();
        expect(query.mock.calls[2].slice(0, 4)).toEqual(['manual-history-node', from, to, 0]);
    });

    it('clears loaded pages when historical access is denied and restarts from the first page', async () => {
        const query = jest.spyOn(ComputeClusterService, 'runtimeEventWindow')
            .mockResolvedValueOnce(windowPage('complete', 1, true))
            .mockRejectedValueOnce(new ComputeClusterRequestError(403, 'forbidden'))
            .mockResolvedValueOnce(windowPage('complete'));
        const recent = {...windowPage('complete', 2).events[0], message: 'Recent sample'};
        renderHistoricalLogs([recent]);

        expect(await screen.findByText('Historical event 1')).toBeInTheDocument();
        expect(screen.queryByLabelText('起始时间')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '加载更多日志'}));
        expect(await screen.findByText('当前账号无权读取该来源的历史日志。')).toBeInTheDocument();
        expect(screen.queryByText('Historical event 1')).not.toBeInTheDocument();
        expect(screen.queryByText('Recent sample')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: '重试读取历史日志'}));
        expect(await screen.findByText('该时段无日志')).toBeInTheDocument();
        expect(query.mock.calls.map(args => args.slice(0, 4))).toEqual([
            ['window-node', 200, 501, 0],
            ['window-node', 200, 501, 1],
            ['window-node', 200, 501, 0],
        ]);
    });

    it.each([
        ['complete', '该时段无日志'],
        ['partial', '该时段的日志覆盖未确认'],
    ] as const)('shows the correct empty state for %s historical coverage', async (coverage, title) => {
        jest.spyOn(ComputeClusterService, 'runtimeEventWindow').mockResolvedValue(windowPage(coverage));
        renderHistoricalLogs();
        expect(await screen.findByText(title)).toBeInTheDocument();
    });

    it('continues an empty program history page and restarts when the snapshot changes', async () => {
        const snapshot = 'a'.repeat(32);
        const first = {
            ...windowPage('partial', 7, true), events: [], snapshot,
            window: {...windowPage('partial').window, reason: 'scan_pending' as const},
        };
        const completed = windowPage('complete', 1);
        const query = jest.spyOn(ComputeClusterService, 'runtimeEventWindow')
            .mockResolvedValueOnce(first)
            .mockRejectedValueOnce(new Error('program_history_snapshot_changed'))
            .mockResolvedValueOnce({
                ...completed, snapshot: 'b'.repeat(32),
                events: completed.events.map(event => ({...event, service_id: 'vision'})),
            });
        jest.spyOn(ComputeClusterService, 'programs').mockResolvedValue({
            schema_version: 'runtime.programs.v1', captured_at: 600, invalid_manifests: 0, programs: [],
        });
        render(<ProgramRunnerPanel
            node={{...node, node_id: 'program-history-node', capabilities: ['runtime.programs.read.v1']}}
            initialView='logs'
            logScope={{kind: 'program', id: 'vision', checkedAt: 500}}
            edgeDevices={[]}
            zh
            maximized={false}
            onToggleMaximized={jest.fn()}
        />);

        expect(await screen.findByText('已读范围暂无匹配记录，可继续读取')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '加载更多日志'}));
        fireEvent.click(await screen.findByRole('button', {name: '重新查询历史日志'}));
        expect(await screen.findByText('Historical event 1')).toBeInTheDocument();
        expect(query.mock.calls.map(args => [args[3], args[5]])).toEqual([
            [0, {id: 'vision', snapshot: undefined}],
            [7, {id: 'vision', snapshot}],
            [0, {id: 'vision', snapshot: undefined}],
        ]);
    });

    it('switches from a main node to an attached edge program runtime', async () => {
        const parent = {
            ...node,
            node_id: 'baosight-02',
            name: 'baosight-02',
            capabilities: [
                ...node.capabilities,
                'runtime.edge-programs.read.v1',
            ],
        };
        const edge: ComputeLanAsset = {
            asset_id: `lan-${'a'.repeat(32)}`,
            node_id: parent.node_id,
            node_name: parent.name,
            cidr: '10.168.10.0/24',
            address: '10.168.10.24',
            hostname: 'AIPACK-05',
            mac: '',
            device_kind: 'edge_compute',
            display_name: 'AIPACK-05',
            device_model: 'Orin',
            ssh_username: 'nvidia',
            ports: [{port: 22, service: 'ssh'}],
            online: true,
            first_seen_at: 1,
            last_seen_at: 101,
            last_changed_at: 101,
            change_type: 'unchanged',
        };
        const runtime = jest.spyOn(ComputeClusterService, 'runtime').mockResolvedValue({
            schema_version: 'runtime.snapshot.v1',
            captured_at: 101,
            summary: {
                total: 0, healthy: 0, degraded: 0, unavailable: 0,
                task_counts: {queued: 0, running: 0, paused: 0, succeeded: 0, failed: 0, cancelled: 0},
            },
            services: [],
        });
        jest.spyOn(ComputeClusterService, 'programs').mockResolvedValue({
            schema_version: 'runtime.programs.v1',
            captured_at: 101,
            invalid_manifests: 0,
            programs: [],
        });
        const runtimeEvents = jest.spyOn(ComputeClusterService, 'runtimeEvents').mockResolvedValue({
            schema_version: 'runtime.events.v1',
            captured_at: 101,
            cursor: 0,
            has_more: false,
            events: [],
        });
        const edgePayload: ComputeProgramSnapshot = {
            schema_version: 'runtime.programs.v1',
            captured_at: 102,
            invalid_manifests: 0,
            programs: [{
                program_id: 'dlk-overflow',
                name: 'DLK Overflow',
                version: '1.0.0',
                root: '/opt/dlk-overflow',
                environment: '/opt/dlk-overflow/.venv',
                mode: 'production',
                encryption: 'unknown',
                state: 'healthy',
                service: {
                    name: 'dlk-overflow.service',
                    state: 'running',
                    pid: 42,
                    uptime_seconds: 60,
                },
                health: {
                    state: 'healthy',
                    checked_at: 102,
                    status_code: 200,
                    latency_ms: 3,
                },
                interfaces: [],
                artifacts: [],
                events: [{
                    created_at: 102,
                    level: 'info',
                    event_type: 'classification',
                    message: 'DLK-02 overflow level 3',
                }],
            }],
        };
        let finishEdgeLoad = () => undefined;
        const edgePrograms = jest.spyOn(ComputeClusterService, 'edgePrograms').mockImplementation(
            () => new Promise(resolve => {
                finishEdgeLoad = () => resolve(edgePayload);
            }),
        );

        const rendered = render(<ProgramRunnerPanel
            node={parent}
            edgeDevices={[edge]}
            zh
            maximized={false}
            onToggleMaximized={jest.fn()}
        />);
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await waitFor(() => expect(runtime).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole('button', {name: '刷新程序运行器'})).not.toBeInTheDocument();
        expect(await screen.findByText('节点尚未注册部署程序。')).toBeInTheDocument();
        runtime.mockClear();
        runtimeEvents.mockClear();

        await act(async () => {
            fireEvent.change(screen.getByRole('combobox', {name: '选择程序运行设备'}), {
                target: {value: edge.asset_id},
            });
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        const dialog = await screen.findByRole('dialog', {name: 'AIPACK-05 程序运行器'});
        await waitFor(() => expect(edgePrograms).toHaveBeenCalledWith(
            edge.asset_id,
            expect.any(AbortSignal),
        ));
        rendered.rerender(<ProgramRunnerPanel
            node={parent}
            edgeDevices={[{...edge}]}
            zh
            maximized={false}
            onToggleMaximized={jest.fn()}
        />);
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        expect(edgePrograms).toHaveBeenCalledTimes(1);
        finishEdgeLoad();
        fireEvent.click(within(dialog).getByRole('button', {name: '日志'}));
        expect(await within(dialog).findByText('DLK-02 overflow level 3')).toBeInTheDocument();
        expect(runtime).not.toHaveBeenCalled();
        expect(runtimeEvents).not.toHaveBeenCalled();
    });
});
