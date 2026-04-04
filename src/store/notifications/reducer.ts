import {INotification, NotificationsActionType, NotificationsState} from './types';
import {Action} from '../Actions';

const initialState: NotificationsState = {
    queue: []
}

export function notificationsReducer(
    state = initialState,
    action: NotificationsActionType
): NotificationsState {
    switch (action.type) {
        case Action.SUBMIT_NEW_NOTIFICATION: {
            // 新通知直接替换所有旧通知，避免堆叠
            return {
                ...state,
                queue: [action.payload.notification]
            }
        }
        case Action.DELETE_NOTIFICATION_BY_ID: {
            return {
                ...state,
                queue: state.queue
                    .filter((message: INotification) => message.id !== action.payload.id)
            }
        }
        case Action.UPDATE_NOTIFICATION_BY_ID: {
            return {
                ...state,
                queue: state.queue.map((notification: INotification) =>
                    notification.id === action.payload.id 
                        ? action.payload.notification 
                        : notification
                )
            }
        }
        default:
            return state;
    }
}
