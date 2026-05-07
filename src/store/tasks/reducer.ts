import {Action} from '../Actions';
import {TasksActionTypes, TasksState} from './types';

const initialState: TasksState = {
    tasks: [],
};

export function tasksReducer(state = initialState, action: TasksActionTypes): TasksState {
    switch (action.type) {
        case Action.TASK_START: {
            // upsert by id：stableId 场景下用同一 id 重启，直接替换；
            // 否则 uuid 新 id 永远走 push 分支。
            const exists = state.tasks.some(t => t.id === action.payload.task.id);
            return {
                ...state,
                tasks: exists
                    ? state.tasks.map(t => t.id === action.payload.task.id ? action.payload.task : t)
                    : [...state.tasks, action.payload.task],
            };
        }
        case Action.TASK_UPDATE: {
            return {
                ...state,
                tasks: state.tasks.map(t => {
                    if (t.id !== action.payload.id) return t;
                    return {
                        ...t,
                        progress: action.payload.progress !== undefined ? action.payload.progress : t.progress,
                        subtitle: action.payload.subtitle !== undefined ? action.payload.subtitle : t.subtitle,
                    };
                }),
            };
        }
        case Action.TASK_COMPLETE: {
            return {
                ...state,
                tasks: state.tasks.map(t => t.id === action.payload.id
                    ? {...t, status: 'completed', finishedAt: action.payload.finishedAt, progress: 100}
                    : t),
            };
        }
        case Action.TASK_FAIL: {
            return {
                ...state,
                tasks: state.tasks.map(t => t.id === action.payload.id
                    ? {...t, status: 'error', finishedAt: action.payload.finishedAt, errorMessage: action.payload.errorMessage}
                    : t),
            };
        }
        case Action.TASK_CANCEL: {
            return {
                ...state,
                tasks: state.tasks.map(t => t.id === action.payload.id
                    ? {...t, status: 'cancelled', finishedAt: action.payload.finishedAt}
                    : t),
            };
        }
        case Action.TASK_REMOVE: {
            return {
                ...state,
                tasks: state.tasks.filter(t => t.id !== action.payload.id),
            };
        }
        case Action.TASKS_CLEAR_ALL: {
            return {...state, tasks: []};
        }
        default:
            return state;
    }
}
