import React from 'react';
import {fireEvent, render, screen, within} from '@testing-library/react';
import {
    ComputeClusterNode,
    ComputeClusterService,
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

    it('shows programs, endpoint status, previewable results, and structured logs', async () => {
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
                    modified_at: 100,
                }, {
                    artifact_id: 'b'.repeat(32),
                    name: '017.png',
                    relative_path: 'runs/20260918/017/017.png',
                    kind: 'image',
                    content_type: 'image/png',
                    size_bytes: 1024,
                    modified_at: 99,
                }, {
                    artifact_id: 'c'.repeat(32),
                    name: '017.json',
                    relative_path: 'runs/20260918/017/017.json',
                    kind: 'data',
                    content_type: 'application/json; charset=utf-8',
                    size_bytes: 34,
                    modified_at: 98,
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
        const close = jest.fn();
        const toggleMaximized = jest.fn();

        const {unmount} = render(<ProgramRunnerPanel
            node={node}
            zh
            maximized={false}
            onClose={close}
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
        const artifacts = await within(dialog).findByLabelText('程序结果');
        expect(artifacts).toHaveTextContent('017.mp4');
        expect(within(artifacts).getByRole('button', {name: '加载视频预览'})).toBeInTheDocument();
        expect(artifacts.querySelector('video')).not.toBeInTheDocument();
        fireEvent.click(within(artifacts).getByRole('button', {name: '加载视频预览'}));
        const video = artifacts.querySelector('video');
        expect(video?.getAttribute('src')).toContain('/runtime/programs/vision-ocr/artifacts/');
        fireEvent.change(within(artifacts).getByRole('combobox', {name: '筛选结果类型'}), {
            target: {value: 'image'},
        });
        expect(within(artifacts).getByRole('button', {name: /017.png/})).toBeInTheDocument();
        expect(within(artifacts).queryByRole('button', {name: /017.mp4/})).not.toBeInTheDocument();
        fireEvent.change(within(artifacts).getByRole('combobox', {name: '筛选结果类型'}), {
            target: {value: 'all'},
        });
        fireEvent.click(within(artifacts).getByRole('button', {name: /017.png/}));
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

        fireEvent.click(within(dialog).getByRole('button', {name: '放大程序运行器窗口'}));
        expect(toggleMaximized).toHaveBeenCalledTimes(1);
        fireEvent.click(within(dialog).getByRole('button', {name: '关闭程序运行器'}));
        expect(close).toHaveBeenCalledTimes(1);
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
            zh
            maximized={false}
            onClose={jest.fn()}
            onToggleMaximized={jest.fn()}
        />);
        expect((await screen.findAllByText('Cached Service')).length).toBeGreaterThan(0);
        first.unmount();

        runtime.mockImplementation(() => new Promise(() => undefined));
        render(<ProgramRunnerPanel
            node={cachedNode}
            zh
            maximized={false}
            onClose={jest.fn()}
            onToggleMaximized={jest.fn()}
        />);

        expect(screen.getAllByText('Cached Service').length).toBeGreaterThan(0);
        expect(runtime).toHaveBeenCalledTimes(2);
    });
});
