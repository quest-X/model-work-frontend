import {v4 as uuidv4} from 'uuid';
import {store} from '../index';
import {
    taskStart, taskUpdate, taskComplete, taskFail, taskCancel, taskRemove
} from '../store/tasks/actionCreators';
import {ManagedTask, TaskPriority, TaskType} from '../store/tasks/types';

export interface TaskHandle {
    id: string;
    update: (progress?: number, subtitle?: string) => void;
    complete: () => void;
    fail: (err: unknown) => void;
    cancel: () => void;
}

export interface StartTaskOptions {
    type: TaskType;
    priority: TaskPriority;
    title: string;
    cancellable: boolean;
    subtitle?: string;
    /**
     * 固定 id：用同一 id 重启 task 时走 upsert 替换，不会刷屏。
     * 典型场景：AutoSave 每次都用 stableId='autosave'。
     */
    stableId?: string;
    /**
     * 终态后自动 dispatch TASK_REMOVE 的延迟 (ms)。0 表示永不自动移除。
     * 默认：completed/cancelled 4000，error 8000，AutoSave 走自定义 1500。
     */
    autoRemoveAfterMs?: number;
    onCancel?: () => void;
}

export class TaskTracker {
    // 函数句柄不能放 Redux state（序列化会丢），用 module-level Map 存。
    private static cancelHandlers = new Map<string, () => void>();
    // 终态后自动移除的 timer，按 id 索引。新 startTask 同 id 时清掉旧的。
    private static autoRemoveTimers = new Map<string, ReturnType<typeof setTimeout>>();
    // 每个 task 的 autoRemoveAfterMs 配置（终态时复用）
    private static autoRemoveConfig = new Map<string, number>();

    public static startTask(opts: StartTaskOptions): TaskHandle {
        const id = opts.stableId ?? uuidv4();

        // 同 id 重启：清掉旧的 autoRemove timer 和旧 cancel handler
        const existingTimer = TaskTracker.autoRemoveTimers.get(id);
        if (existingTimer) {
            clearTimeout(existingTimer);
            TaskTracker.autoRemoveTimers.delete(id);
        }
        TaskTracker.cancelHandlers.delete(id);

        if (opts.cancellable && opts.onCancel) {
            TaskTracker.cancelHandlers.set(id, opts.onCancel);
        }
        // 默认 0 = 不自动移除，让 UI 开关控制已完成任务的可见性。
        // 只有 autoSave（stableId='autosave', 1500ms）等特殊场景手动传值才会自动移除。
        TaskTracker.autoRemoveConfig.set(id, opts.autoRemoveAfterMs ?? 0);

        const task: ManagedTask = {
            id,
            type: opts.type,
            priority: opts.priority,
            title: opts.title,
            subtitle: opts.subtitle,
            progress: undefined,
            status: 'running',
            startedAt: Date.now(),
            cancellable: opts.cancellable,
        };
        store.dispatch(taskStart(task));

        return {
            id,
            update: (progress?: number, subtitle?: string) => {
                store.dispatch(taskUpdate(id, progress, subtitle));
            },
            complete: () => {
                TaskTracker.cancelHandlers.delete(id);
                store.dispatch(taskComplete(id));
                TaskTracker.scheduleAutoRemove(id);
            },
            fail: (err: unknown) => {
                TaskTracker.cancelHandlers.delete(id);
                const msg = err instanceof Error ? err.message : String(err ?? 'unknown error');
                store.dispatch(taskFail(id, msg));
                TaskTracker.scheduleAutoRemove(id);
            },
            cancel: () => {
                TaskTracker.cancelHandlers.delete(id);
                store.dispatch(taskCancel(id));
                TaskTracker.scheduleAutoRemove(id);
            },
        };
    }

    /** 面板上 × 按钮点击：触发该 task 的 onCancel 句柄并 dispatch cancel。 */
    public static cancelById(id: string): void {
        const handler = TaskTracker.cancelHandlers.get(id);
        TaskTracker.cancelHandlers.delete(id);
        if (handler) {
            try { handler(); } catch (e) { console.warn('[TaskTracker] cancel handler threw', e); }
        }
        store.dispatch(taskCancel(id));
        TaskTracker.scheduleAutoRemove(id);
    }

    /** 导出场景便利方法：自动 start/complete/fail，不可取消。 */
    public static async wrapExport<T>(title: string, fn: () => Promise<T> | T): Promise<T> {
        const handle = TaskTracker.startTask({
            type: TaskType.EXPORT,
            priority: 'P2',
            title,
            cancellable: false,
        });
        try {
            const result = await fn();
            handle.complete();
            return result;
        } catch (err) {
            handle.fail(err);
            throw err;
        }
    }

    private static scheduleAutoRemove(id: string, overrideMs?: number): void {
        const existing = TaskTracker.autoRemoveTimers.get(id);
        if (existing) clearTimeout(existing);

        const ms = overrideMs ?? TaskTracker.autoRemoveConfig.get(id) ?? 4000;
        if (ms <= 0) return;

        const timer = setTimeout(() => {
            TaskTracker.autoRemoveTimers.delete(id);
            TaskTracker.autoRemoveConfig.delete(id);
            store.dispatch(taskRemove(id));
        }, ms);
        TaskTracker.autoRemoveTimers.set(id, timer);
    }
}
