import {INotification} from '../store/notifications/types';
import {v4 as uuidv4} from 'uuid';
import {NotificationType} from '../data/enums/NotificationType';
import {NotificationContent} from "../data/info/NotificationsData";
import {LanguageConfig} from "../data/LanguageConfig";
import {store} from "../index";

export class NotificationUtil {
    public static createErrorNotification(content: NotificationContent): INotification {
        return {
            id: uuidv4(),
            type: NotificationType.ERROR,
            header: content.header,
            description: content.description
        }
    }

    public static createMessageNotification(content: NotificationContent): INotification {
        return {
            id: uuidv4(),
            type: NotificationType.MESSAGE,
            header: content.header,
            description: content.description
        }
    }

    public static createWarningNotification(content: NotificationContent): INotification {
        return {
            id: uuidv4(),
            type: NotificationType.WARNING,
            header: content.header,
            description: content.description
        }
    }

    public static createSuccessNotification(content: NotificationContent): INotification {
        return {
            id: uuidv4(),
            type: NotificationType.SUCCESS, // 修复：使用正确的SUCCESS类型
            header: content.header,
            description: content.description
        }
    }

    public static createInferenceProgressNotification(): INotification {
        const now = Date.now();
        const language = store.getState().general.language;
        const texts = LanguageConfig[language];
        
        return {
            id: uuidv4(),
            type: NotificationType.INFERENCE,
            header: texts.aiInference.inProgress,
            description: `${texts.aiInference.stepProgress.replace('{current}', '1').replace('{total}', '3')}: ${texts.aiInference.steps.preprocessing}`,
            i18nHeader: 'aiInference.inProgress',
            isInferenceProgress: true,
            currentStep: 1, // 从步骤1开始，而不是0
            totalSteps: 3,
            stepDescription: '准备开始推理',
            startTime: now,
            stepTimes: {
                stepStartTime: now,
                stepDurations: []
            }
        }
    }

    public static updateInferenceProgress(notification: INotification, step: number, description: string): INotification {
        const now = Date.now();
        const newStepTimes = { ...notification.stepTimes };
        const language = store.getState().general.language;
        const texts = LanguageConfig[language];
        
        // 如果是新步骤，记录上一步的耗时
        if (step > notification.currentStep && notification.stepTimes) {
            const lastStepDuration = now - notification.stepTimes.stepStartTime;
            newStepTimes.stepDurations = [...notification.stepTimes.stepDurations, lastStepDuration];
            newStepTimes.stepStartTime = now; // 记录新步骤开始时间
            console.log(`📊 记录步骤 ${notification.currentStep} 耗时: ${(lastStepDuration / 1000).toFixed(2)}s`);
        }

        return {
            ...notification,
            currentStep: step,
            stepDescription: description,
            description: `${texts.aiInference.stepProgress.replace('{current}', step.toString()).replace('{total}', notification.totalSteps?.toString() || '3')}: ${description}`,
            header: texts.aiInference.inProgress,
            i18nHeader: 'aiInference.inProgress',
            stepTimes: newStepTimes
        }
    }

    public static completeInferenceProgress(notification: INotification, objectCount: number): INotification {
        const now = Date.now();
        const finalStepDuration = now - notification.stepTimes!.stepStartTime;
        const allStepDurations = [...notification.stepTimes!.stepDurations, finalStepDuration];
        
        console.log(`📊 记录最后步骤 ${notification.currentStep} 耗时: ${(finalStepDuration / 1000).toFixed(2)}s`);
        console.log(`📊 所有步骤耗时: [${allStepDurations.map(d => (d / 1000).toFixed(2) + 's').join(', ')}]`);
        
        // 获取国际化文本
        const language = store.getState().general.language;
        const texts = LanguageConfig[language];
        
        return {
            ...notification,
            currentStep: notification.totalSteps,
            stepDescription: texts.aiInference.completedStep,
            description: `${texts.aiInference.detectedObjects.replace('：', '')} ${objectCount}`,
            stepTimes: {
                ...notification.stepTimes!,
                stepDurations: allStepDurations,
                totalObjects: objectCount
            }
        }
    }
}
