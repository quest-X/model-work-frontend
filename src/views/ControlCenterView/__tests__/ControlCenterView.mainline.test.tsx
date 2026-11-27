import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {Language} from '../../../data/LanguageConfig';
import {ComputeClusterNode, ComputeClusterService, ComputeProgramSnapshot, ComputeResourceGraph} from '../../../services/ComputeClusterService';
import {ClusterGeographicMap} from '../ClusterGeographicMap';
import {ControlCenterView} from '../ControlCenterView';

const originalFetch = global.fetch;

jest.mock('../../PopupView/ComputeClusterPopup/ComputeClusterPopup', () => ({
    ComputeClusterPopup: ({initialWorkspace}: {initialWorkspace: string}) => <section>
        <h3>{initialWorkspace === 'network' ? '节点局域网资产' : initialWorkspace}</h3>
    </section>,
}));

const node = (
    name: string,
    online: boolean,
    withCamera = false,
    hardwareModel?: string | null,
    platform = 'Windows',
    controlTransport: ComputeClusterNode['control_transport'] = online ? 'lan' : null,
): ComputeClusterNode => ({
    node_id: `${name}-id`,
    installation_id: `${name}-installation`,
    name,
    agent_version: '0.7.0',
    capabilities: ['system.health.v1'],
    control_transport: controlTransport,
    network: {
        provider: 'tailscale',
        installed: true,
        online,
        ssh_available: online,
        lan_ssh_available: online && controlTransport === 'lan',
        tailscale_ssh_available: online,
        addresses: [],
    },
    network_dependencies: [
        {
            dependency_id: 'tailscale',
            kind: 'overlay_network',
            state: online ? 'healthy' : 'unavailable',
            checked_at: 1,
            required_for: [],
        },
        {
            dependency_id: 'control_ssh',
            kind: 'control_transport',
            state: online ? 'healthy' : 'unavailable',
            checked_at: 1,
            required_for: [],
        },
    ],
    resources: {
        captured_at: 1,
        platform,
        architecture: 'AMD64',
        ...(hardwareModel === undefined ? {} : {hardware_model: hardwareModel}),
        cpu_logical: 16,
        load_average_1m: null,
        memory_total_bytes: 32 * 1024 ** 3,
        memory_available_bytes: 16 * 1024 ** 3,
        disk_total_bytes: 1024 ** 4,
        disk_free_bytes: 512 * 1024 ** 3,
        disk_read_bytes_per_second: 8 * 1024 ** 2,
        disk_write_bytes_per_second: 2 * 1024 ** 2,
        network_receive_bytes_per_second: 4 * 1024 ** 2,
        network_send_bytes_per_second: 1024 ** 2,
        gpus: [],
    },
    device_inventory: {
        state: 'ready',
        devices: withCamera ? [{
            device_id: 'camera-1',
            kind: 'camera',
            provider: 'camera-connect',
            name: '车间相机',
            model: 'DS-2CD2686FWDA2-IZS',
            status: 'registered',
            channels: 2,
            capabilities: [],
        }] : [],
    },
    enrolled_at: 1,
    last_seen_at: 1,
    enabled: true,
    online,
    heartbeat_age_seconds: online ? 2 : 120,
});

const runtimeNode = (name: string, online = true): ComputeClusterNode => {
    const value = node(name, online);
    return {...value, capabilities: [...value.capabilities, 'runtime.read.v1', 'runtime.inventory.v1']};
};

const programSnapshot = (
    state: 'healthy' | 'degraded' | 'unavailable',
    service: 'running' | 'stopped',
    programId = 'dlk-overflow',
    name = 'DLK Overflow',
): ComputeProgramSnapshot => ({
    schema_version: 'runtime.programs.v1',
    captured_at: 1,
    invalid_manifests: 0,
    programs: [{
        program_id: programId,
        name,
        version: '1.0.0',
        root: '/opt/dlk-overflow',
        environment: '/opt/dlk-overflow/.venv',
        mode: 'production',
        encryption: 'plain',
        state,
        service: {name: 'dlk-overflow.service', state: service, pid: 1, uptime_seconds: 60},
        health: {state, checked_at: 1, status_code: state === 'healthy' ? 200 : 503, latency_ms: 1},
        interfaces: [],
        events: [],
        artifacts: [],
    }],
});

const graph = (clusterNode: ComputeClusterNode): ComputeResourceGraph => ({
    schema_version: 'resource-knowledge-graph.v3',
    group_id: 'group-1',
    generated_at: 1,
    summary: {
        entities: 2,
        relations: 1,
        online_nodes: Number(clusterNode.online),
        regions: 1,
        compute_resources: 0,
        managed_devices: 0,
        network_dependencies: 0,
        healthy_network_dependencies: 0,
        work_agents: 0,
        callable_work_agents: 0,
        interactive_work_agents: 0,
    },
    entities: [{
        entity_id: 'region:test',
        kind: 'compute_region',
        label: '测试地域',
        state: clusterNode.online ? 'available' : 'unavailable',
        callable: true,
        modes: [],
        region_id: 'test',
        region_name: '测试地域',
        member_count: 1,
        online_member_count: Number(clusterNode.online),
    }, {
        entity_id: `node:${clusterNode.node_id}`,
        kind: 'compute_node',
        label: clusterNode.name,
        state: clusterNode.online ? 'available' : 'unavailable',
        callable: true,
        modes: [],
        node_id: clusterNode.node_id,
        region_id: 'test',
        region_name: '测试地域',
    }],
    relations: [{
        relation_id: 'contains:test',
        kind: 'contains',
        source_id: 'region:test',
        target_id: `node:${clusterNode.node_id}`,
        active: clusterNode.online,
        reason: clusterNode.online ? 'available' : 'node_offline',
    }],
});

const selectMachine = async (name: string, language = Language.CHINESE): Promise<HTMLElement> => {
    const machines = screen.getByRole('complementary', {name: language === Language.CHINESE ? '机器列表' : 'Machine list'});
    fireEvent.click(await within(machines).findByRole('button', {name: new RegExp(name)}));
    return screen.findByRole('heading', {name});
};

describe('ControlCenterView', () => {
    beforeEach(() => {
        jest.spyOn(ComputeClusterService, 'groups').mockResolvedValue({
            schema_version: 'group-memberships.v1',
            group_count: 0,
            groups: [],
        });
        jest.spyOn(ComputeClusterService, 'group').mockRejectedValue(new Error('field group not found'));
        jest.spyOn(ComputeClusterService, 'groupResources').mockRejectedValue(new Error('field resources not found'));
        jest.spyOn(ComputeClusterService, 'joinCode').mockResolvedValue({
            schema_version: 'join-code.v1',
            configured: false,
        });
        jest.spyOn(ComputeClusterService, 'joinRequests').mockResolvedValue({
            schema_version: 'join-request-list.v1',
            requests: [],
            pending_count: 0,
        });
        jest.spyOn(ComputeClusterService, 'terminalTargets').mockResolvedValue({
            version: 1,
            enabled: true,
            targets: [],
        });
        jest.spyOn(ComputeClusterService, 'runtime').mockImplementation(() => new Promise(() => undefined));
        jest.spyOn(ComputeClusterService, 'runtimeInventory').mockImplementation(() => new Promise(() => undefined));
        jest.spyOn(ComputeClusterService, 'runtimeEvents').mockImplementation(() => new Promise(() => undefined));
        jest.spyOn(ComputeClusterService, 'lanAssets').mockResolvedValue({
            version: 1,
            group_id: 'group-1',
            summary: {total: 0, online: 0, offline: 0, new: 0, changed: 0, networks: 0},
            latest_scans: [],
            assets: [],
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        Object.defineProperty(global, 'fetch', {configurable: true, writable: true, value: originalFetch});
        window.localStorage.clear();
    });

    it('uses Shandong as the highest map level in the restricted commercial build', () => {
        const shandong = node('山东节点', true);
        shandong.labels = {
            region: '370000',
            region_name: '山东省',
            city: '371100',
            city_name: '日照市',
        };
        const regionGraph = graph(shandong);
        regionGraph.entities.forEach(entity => {
            entity.region_id = '370000';
            entity.region_name = '山东省';
        });

        render(<ClusterGeographicMap
            graph={regionGraph}
            nodes={[shandong]}
            zh
            commercialRestricted
        />);

        expect(screen.getByText('山东省市级地图')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: '山东省'})).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByRole('button', {name: '全球'})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '中国'})).not.toBeInTheDocument();
        expect(screen.getByRole('img', {name: '可交互山东省市级节点地图'})).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '缩小地图'}));
        expect(screen.getByText('山东省市级地图')).toBeInTheDocument();
    });
    it('shows only camera connections below an AIPACK node', async () => {
        const aipack = node('AIPACK-05', true, true, 'NVIDIA Jetson AGX Orin');
        aipack.network.tailscale_ssh_available = false;
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([aipack]);
        const {container} = render(<ControlCenterView language={Language.CHINESE}/>);

        expect(await selectMachine('AIPACK-05')).toBeInTheDocument();
        expect(screen.queryByText('边缘计算设备', {selector: 'strong'})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '发现并添加局域网边缘计算设备'}))
            .not.toBeInTheDocument();
        expect(screen.getByText('SSH 局域网')).toBeInTheDocument();
        expect(screen.getByText('Tailscale 远程')).toBeInTheDocument();
        expect(within(screen.getByRole('button', {name: '打开资源监视器'})).getByText('正常'))
            .toBeInTheDocument();
        expect(screen.getByText('摄像头')).toBeInTheDocument();
        expect(container.querySelector('.ControlRelatedDeviceGrid')).toHaveClass('camera-only');
    });

    it('bounds fleet reads and publishes each result without restarting on directory refresh', async () => {
        jest.useFakeTimers();
        const machines = Array.from({length: 5}, (_, index) => {
            const machine = runtimeNode(`AIPACK-${index}`);
            machine.capabilities.push('runtime.programs.read.v1');
            return machine;
        });
        const directory = jest.spyOn(ComputeClusterService, 'nodes')
            .mockImplementation(async () => machines.map(machine => ({...machine})));
        jest.spyOn(ComputeClusterService, 'resourceGraph').mockResolvedValue(graph(machines[0]));
        let resolveFirst!: (value: ReturnType<typeof programSnapshot>) => void;
        const programs = jest.spyOn(ComputeClusterService, 'programs').mockImplementation(id =>
            new Promise(resolve => {
                if (id === machines[0].node_id) resolveFirst = resolve;
            })
        );
        const {unmount} = render(<ControlCenterView language={Language.CHINESE}/>);
        await waitFor(() => expect(programs).toHaveBeenCalledTimes(3));
        const firstSignal = programs.mock.calls[0][1];
        await selectMachine(machines[0].name);
        await act(async () => { resolveFirst(programSnapshot('healthy', 'running')); });
        expect(screen.getByRole('button', {name: '打开程序运行器'})).toBeInTheDocument();
        expect(programs).toHaveBeenCalledTimes(4);
        const directoryCalls = directory.mock.calls.length;
        await act(async () => { jest.advanceTimersByTime(15000); });
        expect(directory.mock.calls.length).toBeGreaterThan(directoryCalls);
        expect(programs).toHaveBeenCalledTimes(4);
        expect(firstSignal.aborted).toBe(false);
        unmount();
        expect(firstSignal.aborted).toBe(true);
    });

    it('releases fleet polling while the runner is open or the page is hidden', async () => {
        jest.useFakeTimers();
        const hidden = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false);
        const selected = runtimeNode('AIPACK-07');
        const other = runtimeNode('AIPACK-08');
        for (const machine of [selected, other]) machine.capabilities.push('runtime.programs.read.v1');
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([selected, other]);
        jest.spyOn(ComputeClusterService, 'resourceGraph').mockResolvedValue(graph(selected));
        const programs = jest.spyOn(ComputeClusterService, 'programs')
            .mockResolvedValue(programSnapshot('healthy', 'running'));
        const otherCalls = () => programs.mock.calls.filter(([id]) => id === other.node_id);
        render(<ControlCenterView language={Language.CHINESE}/>);
        await waitFor(() => expect(otherCalls()).toHaveLength(1));
        const firstSignal = otherCalls()[0][1];
        await selectMachine(selected.name);
        fireEvent.click(screen.getByRole('button', {name: '打开程序运行器'}));
        expect(firstSignal.aborted).toBe(true);
        await act(async () => { jest.advanceTimersByTime(30000); });
        expect(otherCalls()).toHaveLength(1);
        expect(programs).toHaveBeenCalledWith(selected.node_id, expect.any(AbortSignal));
        expect(ComputeClusterService.runtimeInventory).not.toHaveBeenCalled();

        fireEvent.keyDown(document, {key: 'Escape'});
        await waitFor(() => expect(otherCalls()).toHaveLength(2));
        const resumedSignal = otherCalls()[1][1];
        hidden.mockReturnValue(true);
        fireEvent(document, new Event('visibilitychange'));
        expect(resumedSignal.aborted).toBe(true);
        const nodeCalls = jest.mocked(ComputeClusterService.nodes).mock.calls.length;
        await act(async () => { jest.advanceTimersByTime(30000); });
        expect(otherCalls()).toHaveLength(2);
        expect(ComputeClusterService.nodes).toHaveBeenCalledTimes(nodeCalls);

        hidden.mockReturnValue(false);
        fireEvent(document, new Event('visibilitychange'));
        await waitFor(() => expect(otherCalls()).toHaveLength(3));
        expect(otherCalls()[2][1].aborted).toBe(false);
    });

    it('shows work areas alongside regions and keeps the AIPACK camera hierarchy', async () => {
        const main = {...node('01 笔记本', true), role: 'main' as const};
        const worker = {...node('02 笔记本', true, true), role: 'node' as const};
        worker.device_inventory.devices[0] = {
            ...worker.device_inventory.devices[0],
            name: 'yy-camera',
            capabilities: ['camera.stream.v1'],
        };
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([main, worker]);
        jest.mocked(ComputeClusterService.lanAssets).mockResolvedValue({
            version: 1,
            group_id: 'group-1',
            summary: {total: 2, online: 2, offline: 0, new: 0, changed: 0, networks: 1},
            latest_scans: [],
            assets: [{
                asset_id: 'edge-1',
                node_id: worker.node_id,
                node_name: worker.name,
                cidr: '10.168.10.0/24',
                address: '10.168.10.10',
                hostname: 'aipack-01',
                mac: '00:04:4b:00:00:01',
                device_kind: 'edge_compute',
                display_name: 'AIPACK-13',
                device_model: 'Orin',
                ssh_username: 'nvidia',
                ports: [{port: 22, service: 'ssh'}],
                online: true,
                first_seen_at: 1,
                last_seen_at: 1,
                last_changed_at: 1,
                change_type: 'unchanged',
            }, {
                asset_id: 'camera-1',
                node_id: worker.node_id,
                node_name: worker.name,
                cidr: '10.168.10.0/24',
                address: '10.168.10.30',
                hostname: 'yy-camera',
                mac: '00:04:4b:00:00:30',
                device_kind: 'camera',
                display_name: 'yy-camera',
                parent_asset_id: 'edge-1',
                ports: [],
                online: true,
                first_seen_at: 1,
                last_seen_at: 1,
                last_changed_at: 1,
                change_type: 'unchanged',
            }],
        });
        render(<ControlCenterView language={Language.CHINESE}/>);

        await selectMachine('01 笔记本');
        const list = screen.getByRole('complementary', {name: '机器列表'});
        expect(Array.from(list.querySelectorAll('.ControlMachineItem strong')).map(item => item.textContent))
            .toEqual(['总览', '01 笔记本', '02 笔记本', 'AIPACK-13', 'yy-camera']);
        expect(Array.from(list.querySelectorAll('.ControlMachineGroupHeading strong')).map(item => item.textContent))
            .toContain('废钢作业区');
        expect(within(list).getByRole('button', {name: /02 笔记本/})).not.toHaveClass('tree-child');
        expect(within(list).getByRole('button', {name: '打开 AIPACK-13 边缘设备终端'}))
            .toHaveClass('tree-depth-0');
        const areaToggle = within(list).getByRole('button', {name: '收起废钢作业区'});
        const areaHeading = areaToggle.closest('.ControlMachineGroupHeading') as HTMLElement;
        expect(areaHeading.querySelector('strong')?.nextElementSibling).toHaveTextContent('1');
        expect(areaToggle).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(within(areaToggle).getByText('废钢作业区'));
        expect(areaToggle).toHaveAttribute('aria-expanded', 'false');
        expect(within(list).queryByRole('button', {name: '打开 AIPACK-13 边缘设备终端'}))
            .not.toBeInTheDocument();
        expect(within(list).queryByRole('button', {name: '打开 yy-camera 实时画面'})).not.toBeInTheDocument();
        expect(within(list).getByRole('button', {name: /02 笔记本/})).toBeInTheDocument();
        fireEvent.click(within(list).getByRole('button', {name: '展开废钢作业区'}));
        expect(within(list).getByRole('button', {name: '打开 AIPACK-13 边缘设备终端'}))
            .toBeInTheDocument();
        const camera = within(list).getByRole('button', {name: '打开 yy-camera 实时画面'});
        expect(camera).toHaveClass('tree-depth-1');
        expect(camera.querySelector('img')).toHaveAttribute('src', '/ico/camera.png');

        fireEvent.click(camera);
        expect(camera).toHaveClass('selected');
        expect(within(list).getByRole('button', {name: /02 笔记本/}))
            .toHaveAttribute('aria-pressed', 'false');
        expect(within(list).getByRole('button', {name: /02 笔记本/}))
            .not.toHaveClass('selected');
        expect(await screen.findByRole('heading', {name: '02 笔记本'})).toBeInTheDocument();
        expect(await screen.findByRole('dialog', {name: '相机实时画面'})).toBeInTheDocument();
    });

    it('moves installed AIPACK nodes into their work area without losing the node page', async () => {
        const main = {...node('baosight-01', true, true), role: 'main' as const};
        main.device_inventory.devices[0].capabilities = ['camera.stream.v1'];
        const aipack = {
            ...node('AIPACK-05', true, false, 'Jetson AGX Orin Developer Kit', 'Linux'),
            role: 'node' as const,
        };
        aipack.network.lan_address = '10.168.10.24';
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([main, aipack]);
        const lanAssets = jest.mocked(ComputeClusterService.lanAssets).mockResolvedValueOnce({
            version: 1,
            group_id: 'group-1',
            summary: {total: 2, online: 2, offline: 0, new: 0, changed: 0, networks: 1},
            latest_scans: [],
            assets: [{
                asset_id: 'edge-05',
                node_id: 'retired-scanner',
                node_name: 'shangang-aipac-02',
                cidr: '10.168.10.0/24',
                address: '10.168.10.24',
                hostname: 'aipack-05',
                mac: '00:04:4b:00:00:05',
                device_kind: 'edge_compute',
                display_name: 'AIPACK-05',
                device_model: 'Orin',
                ssh_username: 'nvidia',
                ports: [{port: 22, service: 'ssh'}],
                online: true,
                first_seen_at: 1,
                last_seen_at: 1,
                last_changed_at: 1,
                change_type: 'unchanged',
            }, {
                asset_id: 'camera-1',
                node_id: 'retired-scanner',
                node_name: 'shangang-aipac-02',
                cidr: '10.168.10.0/24',
                address: '10.168.10.30',
                hostname: 'camera-1',
                mac: '00:04:4b:00:00:30',
                device_kind: 'camera',
                display_name: '车间相机',
                parent_asset_id: 'edge-05',
                ports: [],
                online: true,
                first_seen_at: 1,
                last_seen_at: 1,
                last_changed_at: 1,
                change_type: 'unchanged',
            }],
        }).mockRejectedValue(new Error('temporary asset failure'));
        render(<ControlCenterView language={Language.CHINESE}/>);

        const list = screen.getByRole('complementary', {name: '机器列表'});
        const installed = await within(list).findByRole('button', {name: /查看 AIPACK-05 节点信息/});
        expect(installed).toHaveClass('edge-device', 'tree-depth-0');
        expect(installed.querySelector('img')).toHaveAttribute('src', '/ico/jetson-agx-orin.png');
        expect(within(list).getAllByText('AIPACK-05')).toHaveLength(1);
        expect(within(list).getByText('炉后作业区')).toBeInTheDocument();
        expect(within(list).queryByRole('button', {name: '打开 AIPACK-05 边缘设备终端'}))
            .not.toBeInTheDocument();

        fireEvent(window, new CustomEvent('opensight:edge-device-updated'));
        await waitFor(() => expect(lanAssets).toHaveBeenCalledTimes(2));
        expect(within(list).getByRole('button', {name: /查看 AIPACK-05 节点信息/}))
            .toBeInTheDocument();

        fireEvent.click(installed);
        expect(await screen.findByRole('heading', {name: 'AIPACK-05'})).toBeInTheDocument();
        fireEvent.click(within(list).getByRole('button', {name: '收起炉后作业区'}));
        expect(within(list).queryByRole('button', {name: /查看 AIPACK-05 节点信息/}))
            .not.toBeInTheDocument();
        expect(screen.getByRole('heading', {name: 'AIPACK-05'})).toBeInTheDocument();
        fireEvent.click(within(list).getByRole('button', {name: '展开炉后作业区'}));
        expect(within(list).getByRole('button', {name: /查看 AIPACK-05 节点信息/}))
            .toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByLabelText('1 个相关设备')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '打开车间相机实时画面'}));
        expect(await screen.findByRole('dialog', {name: '相机实时画面'})).toHaveTextContent('baosight-01');
        expect(screen.getByAltText('车间相机 实时画面')).toHaveAttribute(
            'src',
            expect.stringContaining('/nodes/baosight-01-id/cameras/camera-1/mjpeg'),
        );
    });

    it('opens fleet performance mode inspection from related features', async () => {
        const machine = node('在线节点', true);
        machine.capabilities.push('runtime.performance.mode.read.v1');
        const unsupported = node('旧版节点', true);
        jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([machine, unsupported]);
        jest.spyOn(ComputeClusterService, 'resourceGraph').mockResolvedValue(graph(machine));
        const inspect = jest.spyOn(ComputeClusterService, 'performanceMode').mockResolvedValue({
            schema_version: 'performance.mode-result.v1',
            captured_at: 1,
            platform: 'windows',
            available: true,
            compliant: true,
            current_mode: 'high_performance',
            target_mode: 'high_performance',
            checks: [{
                code: 'windows_power_scheme',
                passed: true,
                observed: 'high_performance',
                expected: 'high_performance',
            }],
        });
        render(<ControlCenterView language={Language.CHINESE}/>);

        await selectMachine('在线节点');
        fireEvent.click(screen.getByText('设备管家'));
        const performanceMode = within(screen.getByLabelText('设备管家列表'))
            .getByRole('button', {name: /性能模式/});
        expect(within(performanceMode).getByText('故障')).toHaveClass('warning');
        fireEvent.click(performanceMode);

        expect(screen.getByRole('heading', {name: '性能模式'})).toBeInTheDocument();
        expect(screen.getByText('尚未扫描')).toBeInTheDocument();
        expect(inspect).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: '开始扫描'}));
        expect(await screen.findByText('1 / 2 正常')).toBeInTheDocument();
    });
});
