import {NotificationType} from '../../data/enums/NotificationType';
import {Action} from '../Actions';

export interface INotification {
    id: string,
    type: NotificationType,
    header: string,
    description: string,
    // i18n: resolve text at render time so language switches take effect immediately
    i18nHeader?: string,       // dot-path into LanguageTexts, e.g. "notifications.detectionCompleted"
    i18nDescription?: string,  // dot-path or template string with {key} placeholders
    i18nParams?: Record<string, string>, // params for template substitution
    // 推理进度相关字段
    isInferenceProgress?: boolean,
    currentStep?: number,
    totalSteps?: number,
    stepDescription?: string,
    startTime?: number,
    // 步骤时间统计
    stepTimes?: {
        stepStartTime: number,
        stepDurations: number[], // 每个步骤的耗时（毫秒）
        totalObjects?: number // 检测到的物体数量
    }
}

export type NotificationsState = {
    queue: INotification[]
}

interface SubmitNewNotification {
    type: typeof Action.SUBMIT_NEW_NOTIFICATION;
    payload: {
        notification: INotification;
    }
}

interface DeleteNotificationById {
    type: typeof Action.DELETE_NOTIFICATION_BY_ID;
    payload: {
        id: string;
    }
}

interface UpdateNotificationById {
    type: typeof Action.UPDATE_NOTIFICATION_BY_ID;
    payload: {
        id: string;
        notification: INotification;
    }
}

export type NotificationsActionType = SubmitNewNotification | DeleteNotificationById | UpdateNotificationById
