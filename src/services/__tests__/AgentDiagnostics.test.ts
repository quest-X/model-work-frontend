import {diagnoseTaskExecutor, isExecutorDiagnostic} from '../AgentDiagnostics';
import {ComputeClusterNode, ComputeClusterService, ComputeRuntimeSnapshot} from '../ComputeClusterService';

afterEach(() => jest.restoreAllMocks());

it('only matches explicit read-only executor questions', () => {
    expect(isExecutorDiagnostic('@全部节点 Task Executor 故障的原因是什么?')).toBe(true);
    expect(isExecutorDiagnostic('@AIPACK-01 检查 Task Executor 状态')).toBe(true);
    expect(isExecutorDiagnostic('@All Nodes why is task executor failing?')).toBe(true);
    expect(isExecutorDiagnostic('@全部节点 Task Executor 故障原因，然后重启')).toBe(false);
    expect(isExecutorDiagnostic('@全部节点 修复 Task Executor')).toBe(false);
    expect(isExecutorDiagnostic('删除 Task Executor 任务')).toBe(false);
});

it('reports observed executor errors and preserves failures as unknown', async () => {
    jest.spyOn(ComputeClusterService, 'nodes').mockResolvedValue([
        {node_id: 'n1', name: 'AIPACK-01', online: true, capabilities: ['runtime.read.v1']},
        {node_id: 'n2', name: 'AIPACK-02', online: true, capabilities: ['runtime.read.v1']},
        {node_id: 'n3', name: 'AIPACK-03', online: false},
    ] as ComputeClusterNode[]);
    const runtime = jest.spyOn(ComputeClusterService, 'runtime')
        .mockResolvedValueOnce({
            services: [{service_id: 'task-executor', state: 'unavailable',
                execution: {available: false, error: 'isolation_unavailable'}}],
        } as ComputeRuntimeSnapshot)
        .mockRejectedValueOnce(new Error('command has expired'));
    const report = await diagnoseTaskExecutor(undefined, true);
    expect(report).toContain('原生隔离检查未通过');
    expect(report).toContain('不能确定哪项失败');
    expect(report).toContain('检查失败：command has expired');
    expect(report).toContain('未收到节点心跳，未检查');
    expect(runtime).toHaveBeenCalledTimes(2);
    expect(runtime.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
});
