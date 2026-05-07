import {Action} from '../Actions';
import {ManagedTask, TasksActionTypes} from './types';

export function taskStart(task: ManagedTask): TasksActionTypes {
    return { type: Action.TASK_START, payload: { task } };
}

export function taskUpdate(id: string, progress?: number, subtitle?: string): TasksActionTypes {
    return { type: Action.TASK_UPDATE, payload: { id, progress, subtitle } };
}

export function taskComplete(id: string): TasksActionTypes {
    return { type: Action.TASK_COMPLETE, payload: { id, finishedAt: Date.now() } };
}

export function taskFail(id: string, errorMessage: string): TasksActionTypes {
    return { type: Action.TASK_FAIL, payload: { id, finishedAt: Date.now(), errorMessage } };
}

export function taskCancel(id: string): TasksActionTypes {
    return { type: Action.TASK_CANCEL, payload: { id, finishedAt: Date.now() } };
}

export function taskRemove(id: string): TasksActionTypes {
    return { type: Action.TASK_REMOVE, payload: { id } };
}

export function tasksClearAll(): TasksActionTypes {
    return { type: Action.TASKS_CLEAR_ALL };
}
