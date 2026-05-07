import {store} from '../..';
import {ManagedTask, TaskPriority} from '../tasks/types';

export class TasksSelector {
    public static getAll(): ManagedTask[] {
        return store.getState().tasks.tasks;
    }

    public static getActive(): ManagedTask[] {
        return TasksSelector.getAll().filter(t => t.status === 'running');
    }

    public static getActiveCount(): number {
        return TasksSelector.getActive().length;
    }

    public static getByPriority(p: TaskPriority): ManagedTask[] {
        // running 在前，按 startedAt 倒序；其它（completed/cancelled/error）按 finishedAt 倒序
        const items = TasksSelector.getAll().filter(t => t.priority === p);
        const running = items.filter(t => t.status === 'running')
            .sort((a, b) => b.startedAt - a.startedAt);
        const finished = items.filter(t => t.status !== 'running')
            .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
        return [...running, ...finished];
    }
}
