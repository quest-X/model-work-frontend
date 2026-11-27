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

    it('shows programs, endpoint status, previewable results, and structured logs', async () => {
        const today = Math.floor(Date.now() / 1000);
        const todayDate = new Date(today * 1000);
        const todayValue = [
            todayDate.getFullYear(),
            `${todayDate.getMonth() + 1}`.padStart(2, '0'),
            `${todayDate.getDate()}`.padStart(2, '0'),
        ].join('-');
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 206,
            text: async () => '{"overflow_n":3,"label":"倾炉"}',
        } as Response);
        jest.spyOn(ComputeClusterService, 'runtime').mockResolvedValue({
            schema_version: 'runtime.snapshot.v1',
            captured_at: 101,
            summary: {
                total: 2,
                healthy: 2,
                degraded: 0,
                unavailable: 0,
                task_counts: {
                    queued: 0,
                    running: 1,
                    paused: 0,
                    succeeded: 4,
                    failed: 0,
                    cancelled: 0,
                },
            },
            services: [{
                service_id: 'node-service',
                name: 'model-work-node Node Service',
                kind: 'service',
                state: 'healthy',
                version: '1.1.2',
                uptime_seconds: 3600,
                restart_count: 0,
                health: {
                    state: 'healthy',
                    checked_at: 101,
                    status_code: 200,
                    latency_ms: 12,
                },
                process: {pid: 1200, state: 'running'},
            }, {
                service_id: 'task-executor',
                name: 'Task Executor',
                kind: 'worker',
                state: 'healthy',
                version: '1.1.2',
                uptime_seconds: 3500,
                restart_count: null,
                health: {
                    state: 'healthy',
                    checked_at: 101,
                    status_code: 200,
                    latency_ms: null,
                },
                process: {pid: 1201, state: 'running'},
                task_counts: {
                    queued: 0,
                    running: 1,
                    paused: 0,
                    succeeded: 4,
                    failed: 0,
                    cancelled: 0,
                },
            }],
        });
        const inventory = jest.spyOn(ComputeClusterService, 'runtimeInventory')
            .mockRejectedValue(new Error('program runner must not fetch the system process inventory'));
        jest.spyOn(ComputeClusterService, 'programs').mockResolvedValue({
            schema_version: 'runtime.programs.v1',
            captured_at: 101,
            invalid_manifests: 0,
            programs: [{
                program_id: 'vision-ocr',
                name: 'Vision OCR',
                version: '2.1.0',
                root: '/opt/opensight/vision-ocr',
                environment: '/opt/opensight/vision-ocr/.venv',
                mode: 'production',
                encryption: 'encrypted',
                state: 'healthy',
                service: {
                    name: 'opensight-vision-ocr.service',
                    state: 'running',
                    pid: 4321,
                    uptime_seconds: 300,
                },
                health: {
                    state: 'healthy',
                    checked_at: 101,
                    status_code: 200,
                    latency_ms: 3.5,
                },
                interfaces: [{
                    method: 'GET',
                    path: '/health',
                    name: '健康检查',
                    description: '服务存活、推理与处理帧',
                    state: 'healthy',
                    checked_at: 101,
                    status_code: 200,
                    latency_ms: 3.5,
                }, {
                    method: 'GET',
                    path: '/furnace',
                    name: '转炉生产数据',
                    description: '角度、炉次、钢种及车辆位置',
                    state: 'unavailable',
                    checked_at: 101,
                    status_code: 503,
                    latency_ms: 4.2,
                }, {
                    method: 'POST',
                    path: '/display',
                    name: '标注显示开关',
                    description: '持久化修改标注显示',
                    state: 'not_checked',
                    checked_at: null,
                    status_code: null,
                    latency_ms: null,
                }],
                events: [{
                    created_at: 100,
                    level: 'info',
                    event_type: 'started',
                    message: 'Program started',
                }],
                artifacts: [{
                    artifact_id: 'a'.repeat(32),
                    name: '017.mp4',
                    relative_path: 'runs/20260918/017/017.mp4',
                    kind: 'video',
                    content_type: 'video/mp4',
                    size_bytes: 111 * 1024 ** 2,
                    modified_at: today,
                }, {
                    artifact_id: 'b'.repeat(32),
                    name: '017.png',
                    relative_path: 'runs/20260918/017/017.png',
                    kind: 'image',
                    content_type: 'image/png',
                    size_bytes: 1024,
                    modified_at: today - 1,
                }, {
                    artifact_id: 'c'.repeat(32),
                    name: '017.json',
                    relative_path: 'runs/20260918/017/017.json',
                    kind: 'data',
                    content_type: 'application/json; charset=utf-8',
                    size_bytes: 34,
                    modified_at: today - 2,
                }],
            }],
        });
        jest.spyOn(ComputeClusterService, 'runtimeEvents').mockResolvedValue({
            schema_version: 'runtime.events.v1',
            captured_at: 101,
            cursor: 7,
            has_more: false,
            events: [{
                cursor: 7,
                created_at: 101,
                service_id: 'task-executor',
                level: 'info',
                event_type: 'task_started',
                message: 'Task execution started',
                task_id: '00000000-0000-4000-8000-000000000007',
            }],
        });
        const toggleMaximized = jest.fn();

        const {unmount} = render(<ProgramRunnerPanel
            node={node}
            edgeDevices={[]}
            zh
            maximized={false}
            onToggleMaximized={toggleMaximized}
        />);

        const dialog = screen.getByRole('dialog', {name: 'AIPACK-13 程序运行器'});
        const programList = await within(dialog).findByLabelText('程序列表');
        expect(within(programList).getByText('节点服务')).toBeInTheDocument();
        expect(within(dialog).getByLabelText('程序详情')).toHaveTextContent('HTTP 200 · 12 ms');
        expect(within(dialog).getByLabelText('已注册程序')).toHaveTextContent('Vision OCR');
        expect(within(dialog).getByLabelText('已注册程序')).toHaveTextContent('/opt/opensight/vision-ocr/.venv');
        expect(within(dialog).getByText(/启停及模式切换仍需一次性授权接口/))
            .toBeInTheDocument();

        fireEvent.click(within(dialog).getByRole('button', {name: '接口'}));
        const endpoints = await within(dialog).findByLabelText('程序接口');
        expect(endpoints).toHaveTextContent('Vision OCR');
        expect(endpoints).toHaveTextContent('GET');
        expect(endpoints).toHaveTextContent('/health');
        expect(endpoints).toHaveTextContent('健康检查');
        expect(endpoints).toHaveTextContent('HTTP 200');
        expect(endpoints).toHaveTextContent('3.5 ms');
        expect(endpoints).toHaveTextContent('HTTP 503');
        expect(endpoints).toHaveTextContent('POST');
        expect(endpoints).toHaveTextContent('/display');
        expect(endpoints).toHaveTextContent('未检查');
        expect(endpoints).not.toHaveTextContent('节点服务');
        expect(endpoints).not.toHaveTextContent('任务执行器');
        expect(inventory).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', {name: '结果'}));
        expect(within(dialog).getByLabelText('筛选结果日期')).toHaveValue(todayValue);
        const artifacts = await within(dialog).findByLabelText('程序结果');
        expect(artifacts).toHaveTextContent('017.mp4');
        expect(within(artifacts).getByRole('button', {name: '加载视频预览'})).toBeInTheDocument();
        expect(artifacts.querySelector('video')).not.toBeInTheDocument();
        fireEvent.click(within(artifacts).getByRole('button', {name: '加载视频预览'}));
        const video = artifacts.querySelector('video');
        expect(video?.getAttribute('src')).toContain('/runtime/programs/vision-ocr/artifacts/');
        expect(within(artifacts).getByText('正在加载视频预览 0%')).toBeInTheDocument();
        Object.defineProperties(video, {
            duration: {configurable: true, value: 100},
            buffered: {
                configurable: true,
                value: {
                    length: 2,
                    start: (index: number) => index === 0 ? 0 : 50,
                    end: (index: number) => index === 0 ? 10 : 65,
                },
            },
        });
        fireEvent.progress(video as HTMLVideoElement);
        expect(within(artifacts).getByText('正在加载视频预览 25%')).toBeInTheDocument();
        fireEvent.loadedData(video as HTMLVideoElement);
        expect(within(artifacts).getByText('视频加载 25%')).toBeInTheDocument();
        fireEvent.canPlayThrough(video as HTMLVideoElement);
        expect(within(artifacts).queryByText('视频加载 25%')).not.toBeInTheDocument();
        fireEvent.change(within(artifacts).getByRole('combobox', {name: '筛选结果类型'}), {
            target: {value: 'image'},
        });
        expect(within(artifacts).getByRole('button', {name: /017.png/})).toBeInTheDocument();
        expect(within(artifacts).queryByRole('button', {name: /017.mp4/})).not.toBeInTheDocument();
        fireEvent.change(within(artifacts).getByRole('combobox', {name: '筛选结果类型'}), {
            target: {value: 'all'},
        });
        fireEvent.click(within(artifacts).getByRole('button', {name: /017.png/}));
        expect(within(artifacts).getByText('正在加载图片预览…')).toBeInTheDocument();
        fireEvent.load(within(artifacts).getByRole('img', {name: '017.png'}));
        expect(within(artifacts).getByRole('img', {name: '017.png'})).toBeInTheDocument();
        fireEvent.click(within(artifacts).getByRole('button', {name: /017.json/}));
        expect(await within(artifacts).findByLabelText('结果内容预览'))
            .toHaveTextContent('"overflow_n": 3');
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/runtime/programs/vision-ocr/artifacts/'),
            expect.objectContaining({
                headers: {Range: 'bytes=0-262143'},
                signal: expect.any(AbortSignal),
            }),
        );
        expect(within(artifacts).getByText('网页内预览')).toBeInTheDocument();
        expect(within(artifacts).queryByRole('link', {name: '下载原文件'}))
            .not.toBeInTheDocument();

        fireEvent.click(within(dialog).getByRole('button', {name: '日志'}));
        const logs = await within(dialog).findByLabelText('程序日志');
        expect(logs).toHaveTextContent('Task execution started');
        expect(logs).toHaveTextContent('任务执行器');
        expect(logs).toHaveTextContent('Program started');
        expect(logs).toHaveTextContent('Vision OCR');

        const toInput = `${todayValue}T23:59`;
        const fromInput = `${todayValue}T23:00`;
        const fromTime = Date.parse(fromInput) / 1000;
        const toTime = Date.parse(toInput) / 1000;
        const programHistory = jest.spyOn(ComputeClusterService, 'runtimeEventWindow').mockResolvedValue({
            ...windowPage('complete', 9),
            window: {from_time: fromTime, to_time: toTime, coverage: 'complete', retained_from: fromTime},
            snapshot: 'c'.repeat(32),
            events: [{...windowPage('complete', 9).events[0], service_id: 'vision-ocr', created_at: fromTime}],
        });
        fireEvent.change(within(logs).getByRole('combobox'), {target: {value: 'program:vision-ocr'}});
        fireEvent.change(within(logs).getByLabelText('起始时间'), {target: {value: fromInput}});
        fireEvent.change(within(logs).getByLabelText('结束时间（不含）'), {target: {value: toInput}});
        fireEvent.click(within(logs).getByRole('button', {name: '查找历史日志'}));
        expect(await within(logs).findByText('Historical event 9')).toBeInTheDocument();
        expect(logs).not.toHaveTextContent('Task execution started');
        expect(programHistory).toHaveBeenCalledWith(node.node_id, fromTime, toTime, 0, expect.any(AbortSignal),
            {id: 'vision-ocr', snapshot: undefined});

        fireEvent.click(within(dialog).getByRole('button', {name: '放大程序运行器窗口'}));
        expect(toggleMaximized).toHaveBeenCalledTimes(1);
        expect(within(dialog).queryByRole('button', {name: '关闭程序运行器'})).not.toBeInTheDocument();
        unmount();
        expect(jest.mocked(ComputeClusterService.runtime).mock.calls[0][1]?.aborted).toBe(true);
        expect(jest.mocked(ComputeClusterService.programs).mock.calls[0][1]?.aborted).toBe(true);
        expect(jest.mocked(ComputeClusterService.runtimeEvents).mock.calls[0][3]?.aborted).toBe(true);
    });

    it('shows the last node snapshot immediately when reopened', async () => {
        const cachedNode = {...node, node_id: 'aipack-cache'};
        const runtime = jest.spyOn(ComputeClusterService, 'runtime').mockResolvedValue({
            schema_version: 'runtime.snapshot.v1',
            captured_at: 101,
            summary: {
                total: 1, healthy: 1, degraded: 0, unavailable: 0,
                task_counts: {queued: 0, running: 0, paused: 0, succeeded: 0, failed: 0, cancelled: 0},
            },
            services: [{
                service_id: 'cached-service',
                name: 'Cached Service',
                kind: 'service',
                state: 'healthy',
                version: '1.0.0',
                uptime_seconds: 10,
                restart_count: 0,
                health: {state: 'healthy', checked_at: 101, status_code: 200, latency_ms: 1},
                process: {pid: 1, state: 'running'},
            }],
        });
        jest.spyOn(ComputeClusterService, 'programs').mockResolvedValue({
            schema_version: 'runtime.programs.v1',
            captured_at: 101,
            invalid_manifests: 0,
            programs: [],
        });
        jest.spyOn(ComputeClusterService, 'runtimeEvents').mockResolvedValue({
            schema_version: 'runtime.events.v1',
            captured_at: 101,
            cursor: 0,
            has_more: false,
            events: [],
        });

        const first = render(<ProgramRunnerPanel
            node={cachedNode}
            edgeDevices={[]}
            zh
            maximized={false}
            onToggleMaximized={jest.fn()}
        />);
        expect((await screen.findAllByText('Cached Service')).length).toBeGreaterThan(0);
        first.unmount();

        runtime.mockImplementation(() => new Promise(() => undefined));
        render(<ProgramRunnerPanel
            node={cachedNode}
            edgeDevices={[]}
            zh
            maximized={false}
            onToggleMaximized={jest.fn()}
        />);

        expect(screen.getAllByText('Cached Service').length).toBeGreaterThan(0);
        expect(runtime).toHaveBeenCalledTimes(2);
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
