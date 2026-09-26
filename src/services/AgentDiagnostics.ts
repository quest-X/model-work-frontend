import {ComputeClusterNode, ComputeClusterService} from './ComputeClusterService';

// Exact read-only questions only. Mixed requests continue through the normal tool/approval path.
export const isExecutorDiagnostic = (message: string): boolean =>
    /^(?:@(?:全部节点|全部设备|All Nodes|All Devices|[^\s@]+)\s+)?(?:请|帮我)?(?:查一下|检查一下|检查|诊断|分析)?\s*Task Executor\s*(?:故障的原因是什么|故障原因|为什么故障|故障原因是什么|状态|诊断)[?？。!！]*$/i.test(message.trim())
    || /^(?:@(?:All Nodes|All Devices|[^\s@]+)\s+)?(?:why is task executor failing|check task executor|diagnose task executor)[?.!]*$/i.test(message.trim());

const cell = (value: string): string => value.replace(/[|\r\n]+/g, ' ');

export const diagnoseTaskExecutor = async (nodeId: string | undefined, zh: boolean): Promise<string> => {
    const nodes = (await ComputeClusterService.nodes()).filter(node => !nodeId || node.node_id === nodeId);
    if (!nodes.length) throw new Error(zh ? '未找到该节点' : 'Node not found');
    // Localized terminal states: offline, unsupported, missing, failed or inspected.
    // eslint-disable-next-line complexity
    const inspect = async (node: ComputeClusterNode): Promise<string> => {
        const prefix = `| ${cell(node.name)} |`;
        if (!node.online) return `${prefix} — | ${zh ? '未收到节点心跳，未检查' : 'No heartbeat; not checked'} |`;
        if (!node.capabilities?.includes('runtime.read.v1')) {
            return `${prefix} — | ${zh ? '不支持服务检查' : 'Runtime inspection unsupported'} |`;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);
        try {
            const snapshot = await ComputeClusterService.runtime(node.node_id, controller.signal);
            const executor = snapshot.services.find(service => service.service_id === 'task-executor');
            if (!executor) return `${prefix} — | ${zh ? '未上报 Task Executor' : 'Task Executor not reported'} |`;
            const error = executor.execution?.error;
            const state = executor.execution?.available === false ? 'unavailable' : executor.state;
            const evidence = error === 'isolation_unavailable'
                ? (zh ? 'isolation_unavailable：原生隔离检查未通过；需核对服务账户、cgroup v2、systemd 和托管 Python 环境，错误码本身不能确定哪项失败。'
                    : 'isolation_unavailable: native isolation checks failed; verify service identity, cgroup v2, systemd and managed Python. This code does not identify the failed prerequisite.')
                : error || (zh ? '未上报错误码' : 'No error code reported');
            return `${prefix} ${state} | ${cell(evidence)} |`;
        } catch (error) {
            return `${prefix} — | ${zh ? '检查失败：' : 'Inspection failed: '}${cell(
                controller.signal.aborted
                    ? (zh ? '超过 20 秒' : 'Timed out after 20s')
                    : error instanceof Error ? error.message : String(error),
            )} |`;
        } finally {
            clearTimeout(timeout);
        }
    };
    const rows: string[] = [];
    // Bound field reads; keep the control connection responsive during a fleet scan.
    for (let index = 0; index < nodes.length; index += 4) {
        rows.push(...await Promise.all(nodes.slice(index, index + 4).map(inspect)));
    }
    return `${zh ? 'Task Executor 只读检查' : 'Task Executor read-only inspection'} · ${new Date().toISOString()}\n`
        + `${zh ? '未执行任务、重启或修复；执行器状态不代表现场检测程序状态。' : 'No task, restart or repair was executed. Executor status is separate from field detection programs.'}\n`
        + `${zh ? '| 节点 | 状态 | 证据 |' : '| Node | State | Evidence |'}\n| --- | --- | --- |\n${rows.join('\n')}`;
};
