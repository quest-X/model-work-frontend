import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {Language} from '../../../../data/LanguageConfig';
import {ComputeClusterRequestError, ComputeClusterService} from '../../../../services/ComputeClusterService';
import {ComputeClusterPopup} from '../ComputeClusterPopup';
import {ComputeTerminalPanel} from '../ComputeTerminalPanel';
import {ResourceKnowledgeGraph} from '../ResourceKnowledgeGraph';
import {Terminal} from '@xterm/xterm';

jest.mock('@xterm/xterm');
jest.mock('@xterm/addon-fit');
jest.mock('../../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));
jest.mock('../../../../services/ComputeClusterService', () => ({
    ...jest.requireActual('../../../../services/ComputeClusterService'),
    ComputeClusterService: {
        status: jest.fn(), nodes: jest.fn(), tasks: jest.fn(), scheduler: jest.fn(),
        resourceGraph: jest.fn(), lanScanTargets: jest.fn(), lanAssets: jest.fn(),
        connectJetson: jest.fn(),
        lanSchedules: jest.fn(), createLanSchedule: jest.fn(), controlLanSchedule: jest.fn(),
        terminalTargets: jest.fn(), startTerminal: jest.fn(), terminal: jest.fn(),
        terminalInput: jest.fn(), terminalResize: jest.fn(), terminalControl: jest.fn(),
        upgradeReleases: jest.fn(), createMainUpgradeBatch: jest.fn(), createUpgradeBatch: jest.fn(), upgradeBatch: jest.fn(), refreshUpgradeBatch: jest.fn(),
        approveUpgradeBatch: jest.fn(), rejectUpgradeBatch: jest.fn(),
        submitTask: jest.fn(), controlTask: jest.fn(),
    },
}));

const service = ComputeClusterService as jest.Mocked<typeof ComputeClusterService>;

describe('ComputeClusterPopup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        service.upgradeReleases.mockResolvedValue({source: 'main', releases: []});
        service.status.mockResolvedValue({
            state: 'ready', version: '9.9.9', protocol_version: 1,
            admin_configured: true, nodes: {total: 1, online: 1, gpu_total: 1, device_total: 1},
        });
        service.nodes.mockResolvedValue([{
            node_id: 'node-12345678', installation_id: 'install-1', name: 'edge-01',
            agent_version: '0.1.0', capabilities: ['system.health.v1', 'control.node.upgrade.v1'],
            network: {
                provider: 'tailscale', installed: true, online: true, ssh_available: true,
                lan_ssh_available: true, tailscale_ssh_available: true,
                addresses: ['100.64.0.1'],
            },
            network_dependencies: [{
                dependency_id: 'tailscale', kind: 'overlay_network', state: 'healthy',
                checked_at: 1, required_for: ['system.wait', 'information.web_fetch'],
            }, {
                dependency_id: 'control_ssh', kind: 'control_transport', state: 'healthy',
                checked_at: 1, required_for: ['system.wait', 'information.web_fetch'],
            }, {
                dependency_id: 'public_http', kind: 'internet_egress', state: 'healthy',
                checked_at: 1, required_for: ['information.web_fetch'],
            }],
            resources: {
                captured_at: 1, platform: 'linux', architecture: 'x86_64', cpu_logical: 16,
                load_average_1m: 0.5, memory_total_bytes: 64 * 1024 ** 3,
                memory_available_bytes: 48 * 1024 ** 3, disk_total_bytes: 1024 ** 4,
                disk_free_bytes: 700 * 1024 ** 3,
                gpus: [{index: 0, uuid: 'GPU-1', name: 'NVIDIA RTX 4090', memory_total_mb: 24564, memory_used_mb: 1024, utilization_percent: 20}],
            },
            device_inventory: {
                state: 'ready', error: null,
                devices: [{
                    device_id: 'camera-1', kind: 'camera', provider: 'camera-connect',
                    name: 'IP CAMERA', model: 'DS-2CD2686FWDA2-IZS', status: 'registered',
                    channels: 2, capabilities: ['camera.registry.v1', 'camera.stream.v1'],
                }],
            },
            enrolled_at: 1, last_seen_at: 1, enabled: true, online: true, heartbeat_age_seconds: 2,
        }]);
        service.tasks.mockResolvedValue({
            version: 1, group_id: 'group-1', total: 0, counts: {}, nodes: [], tasks: [],
        });
        service.scheduler.mockResolvedValue({
            version: 1, group_id: 'group-1', policy: 'most-available-v1', online_nodes: 1,
            totals: {cpu_cores: 16, memory_bytes: 48 * 1024 ** 3, disk_bytes: 700 * 1024 ** 3, gpu_count: 1, gpu_memory_mb: 23540},
            reserved: {cpu_cores: 0, memory_bytes: 0, disk_bytes: 0, gpu_count: 0, gpu_memory_mb: 0},
            available: {cpu_cores: 16, memory_bytes: 48 * 1024 ** 3, disk_bytes: 700 * 1024 ** 3, gpu_count: 1, gpu_memory_mb: 23540},
            active_allocations: 0, allocations: [],
        });
        service.resourceGraph.mockResolvedValue({
            schema_version: 'resource-knowledge-graph.v3', group_id: 'group-1', generated_at: 1,
            summary: {
                entities: 10, relations: 9, online_nodes: 1, regions: 1, compute_resources: 1,
                managed_devices: 1, network_dependencies: 3, healthy_network_dependencies: 3,
                work_agents: 2, callable_work_agents: 2, interactive_work_agents: 2,
            },
            entities: [{
                entity_id: 'group:group-1', kind: 'compute_group', label: 'cross-region-lab',
                state: 'available', callable: true, modes: [],
            }, {
                entity_id: 'region:shanghai', kind: 'compute_region', label: '上海',
                state: 'available', callable: true, modes: [], region_id: 'shanghai',
                region_name: '上海', region_source: 'region_label', member_count: 1,
                online_member_count: 1,
            }, {
                entity_id: 'node:node-12345678', kind: 'compute_node', label: 'edge-01',
                state: 'available', callable: true, node_id: 'node-12345678', modes: [],
                region_id: 'shanghai', region_name: '上海', region_source: 'region_label',
            }, {
                entity_id: 'compute-resource:node-12345678', kind: 'compute_resource', label: 'edge-01 compute',
                state: 'available', callable: true, node_id: 'node-12345678', modes: [],
                platform: 'linux', architecture: 'x86_64', cpu_logical: 16,
                memory_available_bytes: 48 * 1024 ** 3, disk_free_bytes: 700 * 1024 ** 3, gpu_count: 1,
            }, {
                entity_id: 'work-agent:system.wait', kind: 'work_agent', label: 'system.wait',
                state: 'available', callable: true, task_type: 'system.wait',
                capability: 'task.system.wait.v1', category: 'diagnostic',
                modes: ['online', 'background'], available_node_count: 1,
                required_network_dependencies: ['tailscale', 'control_ssh'],
                recommended_resources: {
                    cpu_cores: 0.1, memory_bytes: 64 * 1024 ** 2, disk_bytes: 0,
                    gpu_count: 0, gpu_memory_mb: 0,
                },
            }, {
                entity_id: 'work-agent:information.web_fetch', kind: 'work_agent', label: 'information.web_fetch',
                state: 'available', callable: true, task_type: 'information.web_fetch',
                capability: 'task.information.web_fetch.v1', category: 'information',
                modes: ['background'], available_node_count: 1,
                required_network_dependencies: ['tailscale', 'control_ssh', 'public_http'],
                recommended_resources: {
                    cpu_cores: 0.5, memory_bytes: 256 * 1024 ** 2, disk_bytes: 64 * 1024 ** 2,
                    gpu_count: 0, gpu_memory_mb: 0,
                },
            }, ...(['tailscale', 'control_ssh', 'public_http'] as const).map(dependencyId => ({
                entity_id: `network-dependency:node-12345678:${dependencyId}`,
                kind: 'network_dependency' as const,
                label: dependencyId,
                state: 'available' as const,
                callable: true,
                node_id: 'node-12345678',
                modes: [],
                dependency_id: dependencyId,
                dependency_kind: dependencyId === 'tailscale'
                    ? 'overlay_network'
                    : dependencyId === 'control_ssh' ? 'control_transport' : 'internet_egress',
                checked_at: 1,
                required_for: dependencyId === 'public_http'
                    ? ['information.web_fetch' as const]
                    : ['system.wait' as const, 'information.web_fetch' as const],
            })), {
                entity_id: 'managed-device:node-12345678:camera-1', kind: 'managed_device',
                label: 'IP CAMERA', state: 'available', callable: false,
                node_id: 'node-12345678', modes: [], provider: 'camera-connect',
                device_kind: 'camera', device_status: 'registered', channels: 2,
                device_model: 'DS-2CD2686FWDA2-IZS',
                device_capabilities: ['camera.registry.v1', 'camera.stream.v1'],
            }],
            relations: [{
                relation_id: 'contains:1', kind: 'contains', source_id: 'group:group-1',
                target_id: 'region:shanghai', active: true, reason: 'available',
            }, {
                relation_id: 'contains:region:1', kind: 'contains', source_id: 'region:shanghai',
                target_id: 'node:node-12345678', active: true, reason: 'available',
            }, {
                relation_id: 'provides:1', kind: 'provides', source_id: 'node:node-12345678',
                target_id: 'compute-resource:node-12345678', active: true, reason: 'available',
            }, {
                relation_id: 'can-execute:1', kind: 'can_execute', source_id: 'node:node-12345678',
                target_id: 'work-agent:system.wait', active: true, reason: 'available',
            }, {
                relation_id: 'can-execute:2', kind: 'can_execute', source_id: 'node:node-12345678',
                target_id: 'work-agent:information.web_fetch', active: true, reason: 'available',
            }, ...(['tailscale', 'control_ssh', 'public_http'] as const).map(dependencyId => ({
                relation_id: `depends-on:${dependencyId}`,
                kind: 'depends_on' as const,
                source_id: 'node:node-12345678',
                target_id: `network-dependency:node-12345678:${dependencyId}`,
                active: true,
                reason: 'available' as const,
            })), {
                relation_id: 'manages:camera-1', kind: 'manages',
                source_id: 'node:node-12345678',
                target_id: 'managed-device:node-12345678:camera-1',
                active: false, reason: 'not_console_allowlisted',
            }],
        });
        service.lanScanTargets.mockResolvedValue({
            version: 1,
            group_id: 'group-1',
            nodes: [{
                node_id: 'node-12345678',
                node_name: 'edge-01',
                targets: [{
                    interface: 'eth0', address: '192.168.50.20', cidr: '192.168.50.0/24',
                    prefix_length: 24, interface_cidr: '192.168.50.0/24',
                    narrowed: false, address_count: 254,
                }],
            }],
        });
        service.lanAssets.mockResolvedValue({
            version: 1, group_id: 'group-1',
            summary: {total: 1, online: 1, offline: 0, new: 1, changed: 0, networks: 1},
            latest_scans: [],
            assets: [{
                asset_id: 'lan-1', node_id: 'node-12345678', node_name: 'edge-01',
                cidr: '192.168.50.0/24', address: '192.168.50.30', hostname: 'camera.local',
                mac: '00:11:22:33:44:55', ports: [{port: 554, service: 'rtsp'}], online: true,
                first_seen_at: 1, last_seen_at: 1, last_changed_at: 1, change_type: 'new',
            }],
        });
        service.connectJetson.mockResolvedValue({} as never);
        service.lanSchedules.mockResolvedValue({
            version: 1, group_id: 'group-1',
            summary: {total: 1, enabled: 1, paused: 0, failed: 0},
            schedules: [{
                schedule_id: 'schedule-1', node_id: 'node-12345678', node_name: 'edge-01',
                cidr: '192.168.50.0/24', interval_minutes: 60, enabled: true,
                created_at: 1, updated_at: 1, next_run_at: 9999999999,
                last_run_at: null, last_task_id: null, last_error: null, run_count: 2,
            }],
        });
        service.terminalTargets.mockResolvedValue({
            version: 1, enabled: true,
            targets: [{
                node_id: 'node-12345678', node_name: 'edge-01', platform: 'linux',
                online: true, available: true, active_session_id: null, reason: 'available',
            }],
        });
        const terminalSession = {
            version: 1 as const, session_id: 'terminal-session-1', node_id: 'node-12345678',
            node_name: 'edge-01', transport: 'lan' as const, state: 'running' as const, created_at: 1,
            last_activity_at: 1, cursor: 0, output: '', output_truncated: false,
            exit_code: null, error: null,
        };
        service.startTerminal.mockResolvedValue({
            ...terminalSession,
            output: `prompt>\r\n${'\n'.repeat(90)}model-work-node-backups\r\n`,
        });
        service.terminal.mockResolvedValue(terminalSession);
        service.terminalInput.mockResolvedValue(terminalSession);
        service.terminalResize.mockResolvedValue(terminalSession);
        service.terminalControl.mockResolvedValue({...terminalSession, state: 'closed'});
    });

    it('does not report an empty cluster when StrictMode cancels the initial read', async () => {
        service.nodes.mockImplementationOnce(signal => new Promise((_, reject) => {
            signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once: true});
        }));
        render(<React.StrictMode><ComputeClusterPopup language={Language.CHINESE} embedded initialWorkspace='network'/></React.StrictMode>);
        await act(async () => undefined);
        expect(screen.getByText(/正在读取节点…/)).toBeInTheDocument();
        expect(screen.queryByText('尚未注册计算节点')).not.toBeInTheDocument();
    });

    it('keeps the network inventory visible when task and schedule reads fail', async () => {
        const user = userEvent.setup();
        const base = await service.status();
        service.status.mockResolvedValue({
            ...base,
            task_control: {
                enabled: true, allowed_task_types: ['network.lan_discovery'],
                lan_discovery: true, lan_asset_inventory: true, lan_discovery_schedules: true,
            },
        });
        service.tasks.mockRejectedValueOnce(new Error('task list unavailable'));
        let rejectSchedules: (reason: Error) => void = () => undefined;
        service.lanSchedules.mockReturnValueOnce(new Promise((_, reject) => {
            rejectSchedules = reject;
        }));
        render(<ComputeClusterPopup language={Language.CHINESE}/>);

        await user.click(await screen.findByRole('button', {name: '网络资产 1'}));
        expect(screen.getByText('camera.local')).toBeInTheDocument();
        const schedules = screen.getByRole('heading', {name: '局域网扫描计划'}).closest('section');
        const schedulesView = within(schedules as HTMLElement);
        expect(schedulesView.getByRole('status')).toHaveTextContent('正在读取');
        await act(async () => rejectSchedules(new ComputeClusterRequestError(403, 'Forbidden')));
        expect(await schedulesView.findByRole('alert')).toHaveTextContent('当前账号没有读取权限');
        expect(screen.queryByText('尚无定时计划。')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '创建计划'})).not.toBeInTheDocument();
    });

    it('aligns a direct camera and its owning node in the expanded ring', async () => {
        const base = await service.resourceGraph();
        const main = base.entities.find(entity => entity.kind === 'compute_node');
        const region = base.entities.find(entity => entity.kind === 'compute_region');
        if (!main || !region) throw new Error('direct camera fixture needs one main node and one region');
        const precedingNodes = ['before-1', 'before-2'].map(nodeId => ({
            ...main,
            entity_id: `node:${nodeId}`,
            node_id: nodeId,
            label: nodeId,
        }));
        render(<ResourceKnowledgeGraph
            graph={{
                ...base,
                entities: [
                    region,
                    ...precedingNodes,
                    main,
                    ...base.entities.filter(entity => entity !== region && entity !== main),
                ],
                relations: [
                    ...base.relations,
                    ...precedingNodes.map(node => ({
                        relation_id: `contains:${node.node_id}`,
                        kind: 'contains' as const,
                        source_id: region.entity_id,
                        target_id: node.entity_id,
                        active: true,
                        reason: 'available' as const,
                    })),
                ],
            }}
            nodes={await service.nodes()}
            zh={true}
            onSelectWorkAgent={jest.fn()}
        />);

        const camera = screen.getByRole('button', {name: '查看 IP CAMERA 设备信息'});
        const owner = screen.getByRole('button', {name: '查看 edge-01 节点信息'});
        const clockwiseNext = screen.getByRole('button', {name: '查看 before-1 节点信息'});
        expect(camera).toHaveStyle({top: '12%'});
        expect(owner.style.left).toBe(camera.style.left);
        expect(Number.parseFloat(clockwiseNext.style.left)).toBeLessThan(Number.parseFloat(owner.style.left));
    });

    it('keeps the requested node and failed route visible across target refreshes', async () => {
        jest.useFakeTimers();
        try {
            const targets = await service.terminalTargets();
            const other = {...targets.targets[0], node_id: 'other-node', node_name: 'Other'};
            service.terminalTargets
                .mockRejectedValueOnce(new ComputeClusterRequestError(403, 'Forbidden'))
                .mockResolvedValueOnce({...targets, targets: [other]});
            service.startTerminal.mockRejectedValueOnce(new Error('LAN SSH is unavailable for this node'));

            render(<ComputeTerminalPanel zh preferredNodeId='node-12345678' preferredTransport='lan' autoConnect/>);

            expect(await screen.findByText('当前账号无权查看终端目标。')).toBeInTheDocument();
            const target = screen.getByRole('combobox', {name: '目标节点'});
            expect(target).toHaveValue('node-12345678');
            expect(target).toBeDisabled();

            await act(async () => { jest.advanceTimersByTime(5000); });
            expect(target).toHaveValue('node-12345678');
            expect(screen.getByRole('button', {name: '连接终端'})).toBeDisabled();
            expect(service.startTerminal).not.toHaveBeenCalled();

            await act(async () => { jest.advanceTimersByTime(5000); });
            expect(service.startTerminal).toHaveBeenCalledWith('node-12345678', 'lan');
            expect(screen.getByText('局域网 SSH · 连接失败')).toBeInTheDocument();
            expect(screen.getByText('LAN SSH is unavailable for this node')).toBeInTheDocument();

            await act(async () => { jest.advanceTimersByTime(5000); });
            expect(screen.getByText('LAN SSH is unavailable for this node')).toBeInTheDocument();
            expect(service.startTerminal).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it.each([
        ['lan', 'tailcat', '局域网 SSH', 'Tailcat', true],
        ['tailcat', 'lan', 'Tailcat', '局域网 SSH', true],
        ['tailscale', 'lan', 'Tailscale', 'LAN SSH', false],
    ] as const)('requires explicit viewing of a conflicting session from %s', async (requested, existing, requestedLabel, existingLabel, zh) => {
        const user = userEvent.setup();
        const targets = await service.terminalTargets();
        const session = await service.terminal('terminal-session-1');
        const existingSession = {...session, transport: existing, output: 'existing session output'};
        service.terminal.mockResolvedValue(existingSession).mockClear();
        service.terminalTargets.mockResolvedValue({
            ...targets, targets: [{...targets.targets[0], tailcat_available: true, active_session_id: session.session_id}],
        });
        render(<ComputeTerminalPanel zh={zh} preferredNodeId='node-12345678' preferredTransport={requested} initialCommand='whoami' autoConnect/>);

        const view = await screen.findByRole('button', {name: zh ? `查看现有 ${existingLabel} 会话` : `View existing ${existingLabel} session`});
        expect(screen.getByText(`${requestedLabel} · ${zh ? '已有其他路线会话' : 'Session on another route'}`)).toBeInTheDocument();
        expect(screen.getByLabelText(zh ? '终端输出' : 'Terminal output')).not.toHaveTextContent('existing session output');
        expect(screen.getByRole('button', {name: zh ? '连接终端' : 'Connect'})).toBeDisabled();
        expect(service.startTerminal).not.toHaveBeenCalled();
        expect(service.terminalControl).not.toHaveBeenCalled();
        await user.click(view);
        await waitFor(() => expect(service.terminal.mock.calls.length).toBeGreaterThanOrEqual(3));
        expect(screen.getByText(`${existingLabel} · ${zh ? '已连接' : 'Connected'}`)).toBeInTheDocument();
        expect(screen.getByLabelText(zh ? '终端输出' : 'Terminal output')).toHaveTextContent('existing session output');
        expect(screen.queryByRole('textbox', {name: zh ? '终端指令' : 'Terminal command'})).not.toBeInTheDocument();
        expect(service.terminalInput).not.toHaveBeenCalled();

        service.terminalControl.mockResolvedValue({...existingSession, state: 'closed'});
        service.startTerminal.mockResolvedValue({...session, session_id: 'new-session', transport: requested});
        service.terminal.mockResolvedValue({...session, session_id: 'new-session', transport: requested});
        await user.click(screen.getByRole('button', {name: zh ? '断开' : 'Disconnect'}));
        expect(service.terminalControl).toHaveBeenCalledWith(session.session_id, 'close');
        await user.click(screen.getByRole('button', {name: zh ? '连接终端' : 'Connect'}));
        expect(service.startTerminal).toHaveBeenCalledWith('node-12345678', requested);
        expect(await screen.findByText(`${requestedLabel} · ${zh ? '已连接' : 'Connected'}`)).toBeInTheDocument();
    });

    it('does not offer to view a conflicting session from another node', async () => {
        const targets = await service.terminalTargets();
        const session = await service.terminal('terminal-session-1');
        service.terminalTargets.mockResolvedValue({
            ...targets, targets: [{...targets.targets[0], active_session_id: session.session_id}],
        });
        service.terminal.mockResolvedValue({...session, node_id: 'other-node', transport: 'tailcat', output: 'private output'});
        render(<ComputeTerminalPanel zh preferredNodeId='node-12345678' preferredTransport='lan' autoConnect/>);

        expect(await screen.findByText('返回的会话与所选节点不一致。')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /查看现有/})).not.toBeInTheDocument();
        expect(screen.getByLabelText('终端输出')).not.toHaveTextContent('private output');
        expect(service.startTerminal).not.toHaveBeenCalled();
        expect(service.terminalControl).not.toHaveBeenCalled();
    });

    it('blocks terminal input when session reading is denied, independently of the target list', async () => {
        service.terminal.mockRejectedValue(new ComputeClusterRequestError(403, 'Forbidden'));
        render(<ComputeTerminalPanel zh preferredNodeId='node-12345678'/>);
        const connect = screen.getByRole('button', {name: '连接终端'});
        await waitFor(() => expect(connect).toBeEnabled());
        fireEvent.click(connect);
        expect(await screen.findByText(/当前账号无权访问此终端会话/)).toBeInTheDocument();
        const terminal = (Terminal as unknown as {instances: Array<{emitData: (data: string) => void}>}).instances.slice(-1)[0];
        act(() => terminal.emitData('whoami\r'));
        expect(service.terminalInput).not.toHaveBeenCalled();
        expect(screen.getByLabelText('终端输出')).not.toHaveTextContent('model-work-node-backups');
        expect(screen.queryByText('当前账号无权查看终端目标。')).not.toBeInTheDocument();
    });
});
