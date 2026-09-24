import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {
    ComputeClusterNode,
    ComputeClusterService,
    ComputeProgramOverflowStatistics,
} from '../../../services/ComputeClusterService';
import {MachineHistoryService} from '../../../services/MachineHistoryService';
import {ProgramRunnerPanel} from '../ProgramRunnerPanel';

const node: ComputeClusterNode = {
    node_id: 'aipack-13',
    installation_id: 'aipack-13-installation',
    name: 'AIPACK-13',
    agent_version: '1.1.2',
    capabilities: [
        'runtime.read.v1',
        'runtime.inventory.v1',
        'runtime.programs.read.v1',
        'machine.history.read.v1',
    ],
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
    beforeEach(() => {
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            beginPath: jest.fn(),
            clearRect: jest.fn(),
            closePath: jest.fn(),
            fill: jest.fn(),
            fillRect: jest.fn(),
            fillText: jest.fn(),
            lineTo: jest.fn(),
            moveTo: jest.fn(),
            stroke: jest.fn(),
        } as unknown as CanvasRenderingContext2D);
    });

    afterEach(() => {
        jest.useRealTimers();
        global.fetch = originalFetch;
        jest.restoreAllMocks();
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
                    path: '/rtsp',
                    name: 'WebRTC 兼容入口',
                    description: '跳转到 MediaMTX WebRTC',
                    state: 'healthy',
                    checked_at: 101,
                    status_code: 200,
                    latency_ms: 7.7,
                }, {
                    method: 'GET',
                    path: '/stream.mjpeg',
                    name: '实时标注画面',
                    description: 'MJPEG 视频流',
                    state: 'healthy',
                    checked_at: 101,
                    status_code: 200,
                    latency_ms: 7.7,
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
                }, {
                    created_at: 101,
                    level: 'info',
                    event_type: 'frame',
                    message: '{"src":"ixcom","dir":"out","payload":"LK2"}',
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
                    modified_at: today + 1,
                }, {
                    artifact_id: 'd'.repeat(32),
                    name: 'ixcom.jsonl',
                    relative_path: 'runs/20260918/017/ixcom.jsonl',
                    kind: 'data',
                    content_type: 'application/x-ndjson',
                    size_bytes: 128,
                    modified_at: today - 3,
                }, {
                    artifact_id: 'e'.repeat(32),
                    name: 'session.jsonl',
                    relative_path: 'runs/20260918/017/internal/session.jsonl',
                    kind: 'data',
                    content_type: 'application/x-ndjson',
                    size_bytes: 64,
                    modified_at: today - 4,
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
        const statistics = jest.spyOn(ComputeClusterService, 'programOverflowStatistics').mockResolvedValue({
            schema_version: 'runtime.program-overflow-statistics.v1',
            captured_at: today,
            program_id: 'vision-ocr',
            date: todayValue,
            timezone_offset_minutes: -new Date().getTimezoneOffset(),
            total_frames: 100,
            overflow_frames: 12,
            episodes: {small: 1, medium: 2, large: 1, unknown: 0},
            hourly: [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            latest_overflow_at: today,
            heats: [{
                heat_id: '026_1559_1604_5m07s',
                sequence: 26,
                label: '倾炉',
                start_at: today - 307,
                end_at: today,
                duration_seconds: 307,
                overflow_events: 2,
                levels: {small: 1, medium: 0, large: 1, unknown: 0},
                total_overflow_duration_seconds: 3.5,
                max_event_duration_seconds: 2.5,
                avg_overflow_intensity: 1.2,
                max_overflow_intensity: 2.4,
                camera_drops: 0,
                result_folder: 'runs/20260922/026_1559_1604_5m07s',
                events: [{
                    start_at: today - 100,
                    end_at: today - 99,
                    duration_seconds: 1,
                    level: 'small',
                    max_intensity: 0.4,
                    overflow_ratio: 1,
                }, {
                    start_at: today - 50,
                    end_at: today - 47.5,
                    duration_seconds: 2.5,
                    level: 'large',
                    max_intensity: 2.4,
                    overflow_ratio: 1,
                }],
            }],
        });
        jest.spyOn(MachineHistoryService, 'status').mockResolvedValue({
            schema_version: 'machine-history.status.v1',
            encrypted: true,
            objects: 2,
            versions: 4,
            plaintext_bytes: 2048,
        });
        jest.spyOn(MachineHistoryService, 'objects').mockResolvedValue({
            schema_version: 'machine-history.list.v1',
            objects: [{
                namespace: 'program-overflow',
                object_key: `vision-ocr:${todayValue}:480`,
                version: 2,
                created_at: today,
                captured_at: today,
                digest: 'a'.repeat(64),
                size_bytes: 1024,
            }],
        });
        jest.spyOn(MachineHistoryService, 'object').mockResolvedValue({
            schema_version: 'machine-history.object.v1',
            namespace: 'program-overflow',
            object_key: `vision-ocr:${todayValue}:480`,
            version: 2,
            created_at: today,
            captured_at: today,
            digest: 'a'.repeat(64),
            size_bytes: 1024,
            payload: {date: todayValue, overflow_frames: 12},
        });
        const toggleMaximized = jest.fn();

        const {unmount} = render(<ProgramRunnerPanel
            node={node}
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

        fireEvent.click(within(dialog).getByRole('button', {name: '预览'}));
        const preview = await within(dialog).findByLabelText('程序预览');
        const previewImage = within(preview).getByRole('img', {name: 'Vision OCR 现场实时画面'});
        expect(previewImage)
            .toHaveAttribute(
                'src',
                expect.stringContaining(
                    '/runtime/programs/vision-ocr/interfaces/stream?path=%2Fstream.mjpeg',
                ),
            );
        expect(preview).toHaveTextContent('正在建立实时画面');
        expect(within(preview).getByLabelText('全天直播时间轴 00:00 至 24:00'))
            .toBeInTheDocument();
        expect(preview).toHaveTextContent('当前时间');
        expect(preview).toHaveTextContent(/今日进度 \d+\.\d{2}%/);
        expect(preview).not.toHaveTextContent('直播会话进度');
        fireEvent.load(previewImage);
        expect(preview).toHaveTextContent('LIVE');
        expect(within(preview).queryByRole('button', {name: /播放|暂停|静音/}))
            .not.toBeInTheDocument();
        fireEvent.click(within(preview).getByRole('button', {name: '重新连接'}));
        expect(preview).toHaveTextContent('连接中');

        fireEvent.click(within(dialog).getByRole('button', {name: '接口'}));
        const endpoints = await within(dialog).findByLabelText('程序接口');
        expect(within(endpoints).getAllByRole('columnheader').map(header => header.textContent))
            .toEqual(['提交方式', '原始地址', '用途', '状态', '最近检查']);
        expect(endpoints).toHaveTextContent('5 个接口');
        expect(endpoints).toHaveTextContent('GET');
        expect(endpoints).toHaveTextContent('健康检查');
        expect(endpoints).toHaveTextContent('HTTP 200');
        expect(endpoints).toHaveTextContent('3.5 ms');
        expect(endpoints).toHaveTextContent('HTTP 503');
        expect(endpoints).toHaveTextContent('POST');
        expect(endpoints).toHaveTextContent('未检查');
        expect(within(endpoints).queryByRole('img')).not.toBeInTheDocument();
        const healthUrl = ComputeClusterService.programInterfaceUrl(
            node.node_id,
            'vision-ocr',
            '/health',
        );
        expect(endpoints).toHaveTextContent('/display');
        expect(within(endpoints).getByRole('link', {name: '/health'})).toHaveAttribute(
            'href',
            healthUrl,
        );
        expect(within(endpoints).getByRole('link', {name: '/health'}))
            .toHaveAttribute('target', '_blank');
        expect(within(endpoints).queryByRole('link', {name: '/display'}))
            .not.toBeInTheDocument();
        expect(endpoints).not.toHaveTextContent('节点服务');
        expect(endpoints).not.toHaveTextContent('任务执行器');
        expect(inventory).not.toHaveBeenCalled();
        expect(jest.mocked(global.fetch).mock.calls.some(([url]) =>
            String(url).includes('/artifacts/')
        )).toBe(false);

        fireEvent.click(within(dialog).getByRole('button', {name: '结果'}));
        expect(within(dialog).getByLabelText('筛选结果日期')).toHaveValue(todayValue);
        const artifacts = await within(dialog).findByLabelText('程序结果');
        fireEvent.click(within(artifacts).getByRole('button', {name: /017.mp4/}));
        const resultFolder = within(artifacts).getByLabelText('结果文件夹 017');
        expect(resultFolder.parentElement).toHaveAttribute('open');
        expect(resultFolder.parentElement).toHaveTextContent('5 个文件');
        fireEvent.click(resultFolder);
        expect(resultFolder.parentElement).not.toHaveAttribute('open');
        fireEvent.click(resultFolder);
        expect(resultFolder.parentElement).toHaveAttribute('open');
        expect(artifacts).toHaveTextContent('017.mp4');
        expect(within(dialog).getByRole('status', {name: '在线 · 状态刷新已暂停'}))
            .toBeInTheDocument();
        expect(jest.mocked(ComputeClusterService.runtime).mock.calls[0][1]?.aborted).toBe(true);
        expect(jest.mocked(ComputeClusterService.programs).mock.calls[0][1]?.aborted).toBe(true);
        expect(ComputeClusterService.runtimeEvents).not.toHaveBeenCalled();
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
            target: {value: 'telegram'},
        });
        expect(within(artifacts).getByRole('option', {name: '电文'})).toBeInTheDocument();
        expect(within(artifacts).getByRole('button', {name: /ixcom.jsonl/})).toBeInTheDocument();
        expect(within(artifacts).queryByRole('button', {name: /017.json/})).not.toBeInTheDocument();
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
        expect(within(artifacts).getByText('下载')).toBeVisible();
        expect(within(artifacts).getByRole('link', {name: '下载原文件'}))
            .toHaveAttribute('download', '017.json');
        expect(within(artifacts).getByRole('link', {name: '下载原文件'}))
            .toHaveAttribute('href', expect.stringContaining('/runtime/programs/vision-ocr/artifacts/'));

        expect(within(dialog).queryByRole('button', {name: '刷新程序运行器'})).not.toBeInTheDocument();

        const previewFetches = jest.mocked(global.fetch).mock.calls.length;
        const previewSignal = jest.mocked(global.fetch).mock.calls[previewFetches - 1][1]?.signal;
        fireEvent.click(within(dialog).getByRole('button', {name: '电文'}));
        expect(previewSignal?.aborted).toBe(true);
        const telegrams = await within(dialog).findByLabelText('程序电文');
        expect(telegrams).not.toHaveTextContent('Task execution started');
        expect(telegrams).not.toHaveTextContent('Program started');
        expect(within(telegrams).getByRole('button', {name: '美化格式'})).toHaveAttribute('aria-pressed', 'true');
        expect(within(telegrams).getByLabelText('电文内容').textContent)
            .toBe('{\n  "src": "ixcom",\n  "dir": "out",\n  "payload": "LK2"\n}');
        fireEvent.click(within(telegrams).getByRole('button', {name: '原始格式'}));
        expect(within(telegrams).getByRole('button', {name: '原始格式'})).toHaveAttribute('aria-pressed', 'true');
        expect(within(telegrams).getByLabelText('电文内容').textContent)
            .toBe('{"src":"ixcom","dir":"out","payload":"LK2"}');

        fireEvent.click(within(dialog).getByRole('button', {name: '日志'}));
        const logs = await within(dialog).findByLabelText('程序日志');
        expect(await within(logs).findByText('Task execution started')).toBeInTheDocument();
        expect(logs).toHaveTextContent('任务执行器');
        expect(logs).toHaveTextContent('Program started');
        expect(logs).toHaveTextContent('Vision OCR');
        const logFilter = within(logs).getByRole('combobox', {name: '筛选日志程序'});
        expect(within(logFilter).queryByRole('option', {name: '电文'})).not.toBeInTheDocument();

        fireEvent.click(within(dialog).getByRole('button', {name: '统计'}));
        const statisticsView = await within(dialog).findByLabelText('大炉口溢渣统计');
        expect(await within(statisticsView).findAllByText('溢渣次数')).toHaveLength(2);
        expect(within(statisticsView).queryByLabelText('统计日历')).not.toBeInTheDocument();
        fireEvent.click(within(statisticsView).getByRole('button', {
            name: `选择统计日期 ${todayValue}`,
        }));
        const calendar = await within(statisticsView).findByLabelText('统计日历');
        const selectedDate = await within(calendar).findByRole('button', {
            name: new RegExp(`统计日期 ${todayValue}，4 次溢渣`),
        });
        expect(selectedDate).toHaveAttribute('aria-pressed', 'true');
        expect(within(calendar).getByRole('button', {name: '下个月'})).toBeDisabled();
        fireEvent.click(selectedDate);
        expect(within(statisticsView).queryByLabelText('统计日历')).not.toBeInTheDocument();
        expect(statisticsView).toHaveTextContent('小溢渣1');
        expect(statisticsView).toHaveTextContent('中溢渣2');
        expect(statisticsView).toHaveTextContent('大溢渣1');
        expect(statisticsView).toHaveTextContent('12 / 100 · 12.0%');
        expect(within(statisticsView).getByLabelText('炉次列表')).toHaveTextContent('第 026 次');
        const heatReport = within(statisticsView).getByLabelText('炉次详细报告');
        expect(heatReport).toHaveTextContent('溢渣次数2');
        expect(heatReport).toHaveTextContent('小溢渣');
        expect(heatReport).toHaveTextContent('大溢渣');
        expect(heatReport).toHaveTextContent('最大强度2.400');
        expect(statistics).toHaveBeenCalledWith(
            node.node_id,
            'vision-ocr',
            todayValue,
            -new Date().getTimezoneOffset(),
            expect.any(AbortSignal),
        );
        fireEvent.click(within(statisticsView).getByRole('button', {name: '导出统计'}));
        expect(screen.getByLabelText('开始日期')).toHaveValue(todayValue);
        expect(screen.getByLabelText('结束日期')).toHaveValue(todayValue);
        fireEvent.click(screen.getByRole('button', {name: '取消'}));
        await within(dialog).findByRole('button', {name: '历史'});
        jest.useFakeTimers();
        const programCalls = jest.mocked(ComputeClusterService.programs).mock.calls.length;
        const runtimeCalls = jest.mocked(ComputeClusterService.runtime).mock.calls.length;
        await act(async () => { jest.advanceTimersByTime(15000); });
        expect(ComputeClusterService.programs).toHaveBeenCalledTimes(programCalls);
        expect(ComputeClusterService.runtime).toHaveBeenCalledTimes(runtimeCalls);

        fireEvent.click(within(dialog).getByRole('button', {name: '历史'}));
        const history = await within(dialog).findByLabelText('机器历史');
        expect(await within(history).findByText('已加密')).toBeInTheDocument();
        expect(history).toHaveTextContent('vision-ocr');
        expect(history).toHaveTextContent('"overflow_frames": 12');
        expect(MachineHistoryService.status).toHaveBeenCalledWith(
            node.node_id,
            expect.any(AbortSignal),
        );
        expect(global.fetch).toHaveBeenCalledTimes(previewFetches);
        await act(async () => { jest.advanceTimersByTime(15000); });
        expect(ComputeClusterService.programs).toHaveBeenCalledTimes(programCalls);
        expect(ComputeClusterService.runtime).toHaveBeenCalledTimes(runtimeCalls);

        statistics.mockImplementation(() => new Promise(() => undefined));
        fireEvent.click(within(dialog).getByRole('button', {name: '统计'}));
        expect(within(dialog).getByLabelText('大炉口溢渣统计')).toHaveTextContent('12 / 100');
        expect(within(dialog).queryByText('正在统计当日溢渣…')).not.toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', {name: `选择统计日期 ${todayValue}`}));
        const previousMonth = within(dialog).getByRole('button', {name: '上个月'});
        fireEvent.click(previousMonth);
        const anotherDate = within(dialog).getAllByRole('button', {name: /^统计日期 /})[0];
        fireEvent.click(anotherDate);
        expect(within(dialog).getByText('正在统计当日溢渣…')).toBeInTheDocument();
        expect(within(dialog).getByLabelText('大炉口溢渣统计')).not.toHaveTextContent('12 / 100');
        fireEvent.click(within(dialog).getByRole('button', {name: '程序', exact: true}));
        expect(ComputeClusterService.programs).toHaveBeenCalledTimes(programCalls + 1);
        expect(ComputeClusterService.runtime).toHaveBeenCalledTimes(runtimeCalls + 1);

        fireEvent.click(within(dialog).getByRole('button', {name: '放大程序运行器窗口'}));
        expect(toggleMaximized).toHaveBeenCalledTimes(1);
        expect(within(dialog).queryByRole('button', {name: '关闭程序运行器'})).not.toBeInTheDocument();
        unmount();
        expect(jest.mocked(ComputeClusterService.runtime).mock.calls[0][1]?.aborted).toBe(true);
        expect(jest.mocked(ComputeClusterService.programs).mock.calls[0][1]?.aborted).toBe(true);
        expect(jest.mocked(ComputeClusterService.runtimeEvents).mock.calls[0][3]?.aborted).toBe(true);
    });

    it('preloads recent calendar days before opening and retains results when collapsed', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 8, 25, 12).getTime());
        jest.spyOn(ComputeClusterService, 'runtime').mockResolvedValue({
            schema_version: 'runtime.snapshot.v1', captured_at: 101,
            summary: {total: 0, healthy: 0, degraded: 0, unavailable: 0, task_counts: {}}, services: [],
        });
        jest.spyOn(ComputeClusterService, 'programs').mockResolvedValue({
            schema_version: 'runtime.programs.v1', captured_at: 101, invalid_manifests: 0,
            programs: [{
                program_id: 'dlk-overflow', name: 'DLK', version: '1', root: '/dlk', environment: '/dlk',
                mode: 'production', encryption: 'plain', state: 'healthy',
                service: {name: 'dlk', state: 'running', pid: 1, uptime_seconds: 1},
                health: {state: 'healthy', checked_at: 101, status_code: 200, latency_ms: 1},
                interfaces: [], events: [], artifacts: [],
            }],
        });
        const day = (date: string, offset: number): ComputeProgramOverflowStatistics => ({
            schema_version: 'runtime.program-overflow-statistics.v1', captured_at: 101,
            program_id: 'dlk-overflow', date, timezone_offset_minutes: offset,
            total_frames: date.endsWith('-24') ? 0 : 100, overflow_frames: 0,
            episodes: {small: 0, medium: 0, large: 0, unknown: 0},
            hourly: Array(24).fill(0), latest_overflow_at: null, heats: [],
        });
        let resolveRecent: () => void;
        let rejectOlder: () => void;
        let olderAttempts = 0;
        let active = 0;
        let maxActive = 0;
        const statistics = jest.spyOn(ComputeClusterService, 'programOverflowStatistics')
            .mockImplementation((nodeId, _, date, offset) => {
                if (nodeId === 'calendar-other-node') return new Promise(() => undefined);
                if (date === '2026-09-25') return Promise.resolve(day(date, offset));
                active += 1;
                maxActive = Math.max(active, maxActive);
                const result = date === '2026-09-24'
                    ? new Promise<ComputeProgramOverflowStatistics>(resolve => {
                        resolveRecent = () => resolve(day(date, offset));
                    })
                    : date === '2026-09-23' && olderAttempts++ === 0
                        ? new Promise<ComputeProgramOverflowStatistics>((resolve, reject) => {
                            rejectOlder = () => reject(new Error('HTTP 503'));
                        })
                        : Promise.resolve(day(date, offset));
                return result.finally(() => { active -= 1; });
            });
        const calendarNode = {...node, node_id: 'calendar-preload'};
        const props = {node: calendarNode, zh: true, maximized: false, onToggleMaximized: jest.fn()};
        const panel = render(<ProgramRunnerPanel {...props}/>);
        await screen.findByText('暂无程序状态');
        fireEvent.click(screen.getByRole('button', {name: '统计'}));
        await waitFor(() => expect(statistics).toHaveBeenCalledTimes(3));
        expect(statistics.mock.calls.map(call => call[2])).toEqual(['2026-09-25', '2026-09-24', '2026-09-23']);
        expect(screen.queryByLabelText('统计日历')).not.toBeInTheDocument();

        const calendarButton = screen.getByRole('button', {name: '选择统计日期 2026-09-25'});
        fireEvent.click(calendarButton);
        let calendar = screen.getByLabelText('统计日历');
        expect(within(calendar).getByRole('button', {name: '统计日期 2026-09-24，待读取'})).toHaveClass('pending');
        expect(within(calendar).getByRole('button', {name: '统计日期 2026-09-26，未来日期'})).toBeDisabled();
        fireEvent.click(calendarButton);
        expect(statistics.mock.calls[1][4].aborted).toBe(false);
        expect(statistics.mock.calls[2][4].aborted).toBe(false);
        await act(async () => resolveRecent());
        await waitFor(() => expect(statistics).toHaveBeenCalledTimes(25));
        expect(maxActive).toBe(2);

        fireEvent.click(calendarButton);
        calendar = screen.getByLabelText('统计日历');
        expect(within(calendar).getByRole('button', {name: '统计日期 2026-09-24，无记录'})).toHaveClass('empty');
        expect(within(calendar).getByRole('button', {name: '统计日期 2026-09-22，0 次溢渣'})).toHaveClass('recorded');
        expect(within(calendar).getByRole('status')).toHaveTextContent('当月读取 24 / 25');
        await act(async () => rejectOlder());
        expect(within(calendar).getByRole('button', {name: '统计日期 2026-09-23，读取失败'})).toHaveClass('failed');
        expect(within(calendar).getByRole('status')).toHaveTextContent('25 / 25 · 1 天失败');
        fireEvent.click(within(calendar).getByRole('button', {name: '重试失败日期'}));
        await within(calendar).findByRole('button', {name: '统计日期 2026-09-23，0 次溢渣'});
        expect(statistics.mock.calls.filter(call => call[2] === '2026-09-24')).toHaveLength(1);
        expect(within(calendar).queryByRole('button', {name: '重试失败日期'})).not.toBeInTheDocument();

        panel.rerender(<ProgramRunnerPanel {...props} node={{...calendarNode, node_id: 'calendar-other-node'}}/>);
        fireEvent.click(screen.getByRole('button', {name: '统计'}));
        fireEvent.click(await screen.findByRole('button', {name: '选择统计日期 2026-09-25'}));
        calendar = screen.getByLabelText('统计日历');
        expect(within(calendar).getByRole('button', {name: '统计日期 2026-09-24，待读取'})).toHaveClass('pending');
        panel.unmount();
        expect(statistics.mock.calls.filter(call => call[0] === 'calendar-other-node')
            .every(call => call[4].aborted)).toBe(true);
    });

    it('renders history status without waiting for the object list', async () => {
        jest.spyOn(MachineHistoryService, 'status').mockResolvedValue({
            schema_version: 'machine-history.status.v1',
            encrypted: true, objects: 2, versions: 4, plaintext_bytes: 2048,
        });
        jest.spyOn(MachineHistoryService, 'objects').mockImplementation(() => new Promise(() => undefined));
        render(<ProgramRunnerPanel
            node={{...node, node_id: 'history-pending-list', capabilities: ['machine.history.read.v1']}}
            zh
            maximized={false}
            onToggleMaximized={jest.fn()}
        />);
        fireEvent.click(screen.getByRole('button', {name: '历史'}));
        expect(await screen.findByText('已加密')).toBeInTheDocument();
        expect(screen.queryByText('正在读取机器历史…')).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: '刷新机器历史'})).toBeDisabled();
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
            onToggleMaximized={jest.fn()}
        />);
        expect((await screen.findAllByText('Cached Service')).length).toBeGreaterThan(0);
        first.unmount();

        runtime.mockImplementation(() => new Promise(() => undefined));
        const reopened = render(<ProgramRunnerPanel
            node={cachedNode}
            zh
            maximized={false}
            onToggleMaximized={jest.fn()}
        />);

        expect(screen.getAllByText('Cached Service').length).toBeGreaterThan(0);
        expect(runtime).toHaveBeenCalledTimes(2);
        const reopenedDialog = screen.getByRole('dialog', {name: 'AIPACK-13 程序运行器'});
        fireEvent.click(within(reopenedDialog).getByRole('button', {name: '结果'}));
        expect(within(reopenedDialog).getByText('暂无录像、图片或数据文件')).toBeInTheDocument();
        expect(within(reopenedDialog).queryByText(/正在读取程序结果/)).not.toBeInTheDocument();
        reopened.unmount();

        render(<ProgramRunnerPanel
            node={{...cachedNode, online: false}}
            zh
            maximized={false}
            onToggleMaximized={jest.fn()}
        />);

        const offlineDialog = screen.getByRole('dialog', {name: 'AIPACK-13 程序运行器'});
        const offlineStatus = within(offlineDialog).getByRole('status', {name: /离线 · 显示最后缓存/});
        expect(offlineStatus.querySelector('.ControlStatusDot')).toHaveClass('offline');
        expect(within(offlineDialog).getAllByText('Cached Service').length).toBeGreaterThan(0);
        fireEvent.click(within(offlineDialog).getByRole('button', {name: '日志'}));
        expect(within(offlineDialog).getByLabelText('程序日志')).toBeInTheDocument();
        expect(runtime).toHaveBeenCalledTimes(2);
    });

    it('shows request completion progress while results are loading', async () => {
        let resolveRuntime!: (value: Awaited<ReturnType<typeof ComputeClusterService.runtime>>) => void;
        let resolvePrograms!: (value: Awaited<ReturnType<typeof ComputeClusterService.programs>>) => void;
        jest.spyOn(ComputeClusterService, 'runtime').mockImplementation(() =>
            new Promise(resolve => { resolveRuntime = resolve; })
        );
        jest.spyOn(ComputeClusterService, 'programs').mockImplementation(() =>
            new Promise(resolve => { resolvePrograms = resolve; })
        );
        const runtimeEvents = jest.spyOn(ComputeClusterService, 'runtimeEvents')
            .mockImplementation(() => new Promise(() => undefined));

        render(<ProgramRunnerPanel
            node={{...node, node_id: 'aipack-progress'}}
            zh
            maximized={false}
            onToggleMaximized={jest.fn()}
        />);
        const dialog = screen.getByRole('dialog', {name: 'AIPACK-13 程序运行器'});
        expect(await within(dialog).findByText('正在读取程序状态… 0%')).toBeInTheDocument();

        resolveRuntime({
            schema_version: 'runtime.snapshot.v1',
            captured_at: 101,
            summary: {
                total: 1, healthy: 1, degraded: 0, unavailable: 0,
                task_counts: {queued: 0, running: 0, paused: 0, succeeded: 0, failed: 0, cancelled: 0},
            },
            services: [{
                service_id: 'fast-service',
                name: 'Fast Service',
                kind: 'service',
                state: 'healthy',
                version: '1.0.0',
                uptime_seconds: 10,
                restart_count: 0,
                health: {state: 'healthy', checked_at: 101, status_code: 200, latency_ms: 1},
                process: {pid: 1, state: 'running'},
            }],
        });
        expect((await within(dialog).findAllByText('Fast Service')).length).toBeGreaterThan(0);
        expect(within(dialog).getByText('正在读取受控程序目录… 50%')).toBeInTheDocument();
        expect(runtimeEvents).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', {name: '结果'}));
        expect(await within(dialog).findByText('正在读取程序结果… 50%')).toBeInTheDocument();

        resolvePrograms({
            schema_version: 'runtime.programs.v1',
            captured_at: 101,
            invalid_manifests: 0,
            programs: [],
        });
        expect(await within(dialog).findByText('暂无录像、图片或数据文件')).toBeInTheDocument();
        expect(runtimeEvents).not.toHaveBeenCalled();
    });
});
