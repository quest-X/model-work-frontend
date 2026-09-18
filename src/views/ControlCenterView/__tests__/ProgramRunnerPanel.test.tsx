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

describe('ProgramRunnerPanel', () => {
    afterEach(() => jest.restoreAllMocks());

    it('shows programs, processes, and structured logs from the node runtime', async () => {
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
        jest.spyOn(ComputeClusterService, 'runtimeInventory').mockResolvedValue({
            schema_version: 'runtime.inventory.v1',
            captured_at: 101,
            processes_available: true,
            processes: [{
                pid: 1200,
                name: 'python3',
                cpu_percent: 7.5,
                memory_bytes: 128 * 1024 ** 2,
                state: 'running',
            }],
            startup_services_available: true,
            startup_services: [],
        });
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
                events: [{
                    created_at: 100,
                    level: 'info',
                    event_type: 'started',
                    message: 'Program started',
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

        fireEvent.click(within(dialog).getByRole('button', {name: '进程'}));
        expect(await within(dialog).findByLabelText('程序运行器进程清单')).toHaveTextContent('python3');
        expect(within(dialog).getByText('128 MB')).toBeInTheDocument();

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
        expect(jest.mocked(ComputeClusterService.runtimeInventory).mock.calls[0][1]?.aborted).toBe(true);
        expect(jest.mocked(ComputeClusterService.programs).mock.calls[0][1]?.aborted).toBe(true);
        expect(jest.mocked(ComputeClusterService.runtimeEvents).mock.calls[0][3]?.aborted).toBe(true);
    });
});
