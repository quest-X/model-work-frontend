import {store} from "../../index";
import {DetectionAPIDetector, DetectionResult} from "../../ai/DetectionAPIDetector";
import {ImageData, LabelName, LabelRect} from "../../store/labels/types";
import {LabelStatus} from "../../data/enums/LabelStatus";
import {v4 as uuidv4} from "uuid";
import {updateImageDataById, updateLabelNames} from "../../store/labels/actionCreators";
import {updateFullImageInferenceStatus, addInferenceHistory, toggleImageAILabelsVisibility, updateSegmentationResults} from "../../store/ai/actionCreators";
import {submitNewNotification, deleteNotificationById, updateNotificationById} from "../../store/notifications/actionCreators";
import {updatePerClassColorationStatus} from "../../store/general/actionCreators";
import {NotificationUtil} from "../../utils/NotificationUtil";
import {LabelUtil} from "../../utils/LabelUtil";
import {RectUtil} from "../../utils/RectUtil";
import {IRect} from "../../interfaces/IRect";
import {AISelector} from "../../store/selectors/AISelector";
import {LanguageConfig} from "../../data/LanguageConfig";
import {EditorActions} from "./EditorActions";

export class AIDetectionActions {

    /**
     * 执行全图目标检测
     * @param imageData 当前图片数据
     */
    public static detectObjects(imageData: ImageData): void {
        // 检测功能独立运行，不受分割功能开关状态影响
        
        // 检查检测API是否可用
        if (!DetectionAPIDetector.isEnabled()) {
            return;
        }

        // 创建检测进度通知
        const progressNotification = NotificationUtil.createInferenceProgressNotification();
        store.dispatch(submitNewNotification(progressNotification));

        // 获取国际化文本
        const language = store.getState().general.language;
        const texts = LanguageConfig[language];

        // 更新进度：步骤1 - 预处理 (立即执行，无延迟)
        queueMicrotask(() => {
            const step1Notification = NotificationUtil.updateInferenceProgress(
                progressNotification, 
                1, 
                texts.aiInference.steps.preprocessing
            );
            store.dispatch(updateNotificationById(progressNotification.id, step1Notification));
        });

        // 更新进度：步骤2 - 检测过程
        const step2Notification = NotificationUtil.updateInferenceProgress(
            progressNotification, 
            2, 
            texts.notifications.detectionInProgress
        );
        store.dispatch(updateNotificationById(progressNotification.id, step2Notification));

        // 使用微任务调用检测API，避免阻塞UI
        queueMicrotask(() => {
            // 调用检测API
            DetectionAPIDetector.predict(
                imageData,
                // 成功回调
                (results: DetectionResult[]) => {
                    // 更新进度：步骤3 - 后处理
                    const step3Notification = NotificationUtil.updateInferenceProgress(
                        step2Notification, 
                        3, 
                        texts.aiInference.steps.postprocessing
                    );
                    store.dispatch(updateNotificationById(progressNotification.id, step3Notification));
                    // 检测完成，发现对象
                
                    // 将检测结果转换为可编辑的标注框
                    this.convertDetectionResultsToLabelRects(imageData, results);

                    // 将检测结果同步到推理结果视图
                    const segResults = DetectionAPIDetector.convertToSegmentationFormat(results);
                    store.dispatch(updateSegmentationResults(segResults));
                    
                    // 批量更新通知，避免多次dispatch
                    queueMicrotask(() => {
                        // 完成检测进度，显示最终统计
                        const completedNotification = NotificationUtil.completeInferenceProgress(
                            step3Notification,
                            results.length
                        );
                        store.dispatch(updateNotificationById(progressNotification.id, completedNotification));
                        
                        // 延迟显示成功通知，但缩短时间
                        setTimeout(() => {
                            // 删除进度通知
                            store.dispatch(deleteNotificationById(progressNotification.id));
                            
                            const totalTime = ((Date.now() - progressNotification.startTime!) / 1000).toFixed(2);
                            
                            // 显示成功通知
                            const language = store.getState().general.language;
                            const texts = LanguageConfig[language];
                            const successNotification = NotificationUtil.createSuccessNotification({
                                header: texts.notifications.detectionCompleted,
                                description: texts.notifications.detectionCompletedMessage
                                    .replace('{count}', String(results.length))
                                    .replace('{time}', totalTime)
                            });
                            successNotification.i18nHeader = 'notifications.detectionCompleted';
                            successNotification.i18nDescription = 'notifications.detectionCompletedMessage';
                            successNotification.i18nParams = { count: String(results.length), time: totalTime };
                            store.dispatch(submitNewNotification(successNotification));
                        }, 800); // 减少延迟时间
                    });

                    // 记录详细结果（性能优化：移除日志输出）
                    
                    // 重置检测状态
                    store.dispatch(updateFullImageInferenceStatus(false));

                    // 添加检测历史记录（会自动设置aiLabelsVisible为true）
                    store.dispatch(addInferenceHistory(imageData.id, results.length, true, 'detection'));

                    // 触发 canvas 重绘，显示检测结果
                    EditorActions.fullRender();
                },
                // 失败回调
                (error: Error) => {
                    // 目标检测失败
                    
                    // 删除进度通知
                    store.dispatch(deleteNotificationById(progressNotification.id));
                    
                    // 显示错误通知
                    const language = store.getState().general.language;
                    const texts = LanguageConfig[language];
                    const errorNotification = NotificationUtil.createErrorNotification({
                        header: texts.notifications.detectionFailed,
                        description: error.message || texts.notifications.detectionFailedMessage
                    });
                    errorNotification.i18nHeader = 'notifications.detectionFailed';
                    store.dispatch(submitNewNotification(errorNotification));
                    
                    // 重置检测状态
                    store.dispatch(updateFullImageInferenceStatus(false));
                    
                    // 添加失败的检测历史记录
                    // 检测失败，添加失败记录
                    store.dispatch(addInferenceHistory(imageData.id, 0, false, 'detection'));
                }
            );
        }); // 移除不必要的延迟
    }

    /**
     * 将检测结果转换为可编辑的标注框
     */
    private static convertDetectionResultsToLabelRects(imageData: ImageData, results: DetectionResult[]): void {
        const existingLabels: LabelName[] = store.getState().labels.labels;
        const newLabelRects: LabelRect[] = [];
        let skippedDuplicates = 0;

        // 首先创建缺失的标签
        const uniqueNewLabels = [...new Set(results
            .filter(result => !existingLabels.some(existing => 
                existing.name.toLowerCase() === result.info.name.toLowerCase()
            ))
            .map(result => result.info.name)
        )];

        if (uniqueNewLabels.length > 0) {
            this.createMissingLabels(uniqueNewLabels);
        }

        // 使用微任务处理检测结果，避免阻塞
        queueMicrotask(() => {
            // 获取更新后的标签列表
            const updatedLabels: LabelName[] = store.getState().labels.labels;

            results.forEach((result: DetectionResult) => {
                // 转换bbox格式：[x1, y1, x2, y2] -> IRect
                const [x1, y1, x2, y2] = result.bbox;
                const detectionRect: IRect = {
                    x: x1, 
                    y: y1, 
                    width: x2 - x1, 
                    height: y2 - y1
                };

                // 检查是否为重复的标注框（相同位置+相同标签）
                const isDuplicate = this.checkDuplicateLabelRect(
                    imageData.labelRects, 
                    detectionRect, 
                    result.info.name,
                    updatedLabels
                );
                
                if (isDuplicate) {
                    console.log(`🚫 跳过重复标注框: ${result.info.name} (相同位置相同标签)`);
                    skippedDuplicates++;
                    return; // 跳过这个结果
                }

                // 查找匹配的标签
                let labelId: string | null = null;
                const matchingLabel = updatedLabels.find(label => 
                    label.name.toLowerCase() === result.info.name.toLowerCase()
                );
                
                if (matchingLabel) {
                    labelId = matchingLabel.id;
                    console.log(`✅ 使用标签: ${matchingLabel.name} (匹配 ${result.info.name}) - 颜色: ${matchingLabel.color}`);
                } else {
                    console.log(`⚠️ 未找到匹配标签: ${result.info.name}`);
                }

                const newLabelRect: LabelRect = {
                    id: uuidv4(),
                    labelId: labelId,
                    rect: detectionRect,
                    isCreatedByAI: true,
                    isVisible: true,
                    status: LabelStatus.ACCEPTED,
                    suggestedLabel: labelId ? null : result.info.name
                };

                newLabelRects.push(newLabelRect);
            });

            // 添加新的标注框到图像数据
            const updatedImageData: ImageData = {
                ...imageData,
                labelRects: [...imageData.labelRects, ...newLabelRects]
            };

            store.dispatch(updateImageDataById(imageData.id, updatedImageData));
            console.log(`✅ 添加了 ${newLabelRects.length} 个新的检测结果作为可编辑标注框 (跳过了 ${skippedDuplicates} 个重复项)`);
            
            // 确保按类别着色功能已启用
            const perClassColorEnabled = store.getState().general.enablePerClassColoration;
            if (!perClassColorEnabled) {
                console.log('🎨 自动启用按类别着色功能以显示AI检测结果颜色');
                store.dispatch(updatePerClassColorationStatus(true));
            }
        }); // 移除不必要的延迟
    }

    /**
     * 创建缺失的标签
     */
    private static createMissingLabels(labelNames: string[]): void {
        const existingLabels: LabelName[] = store.getState().labels.labels;
        
        // 过滤掉已存在的标签名称（不区分大小写）
        const filteredLabelNames = labelNames.filter(name => 
            !existingLabels.some(existing => 
                existing.name.toLowerCase() === name.toLowerCase()
            )
        );
        
        if (filteredLabelNames.length === 0) {
            console.log('所有AI检测标签都已存在，无需创建新标签');
            return;
        }
        
        const newLabels = filteredLabelNames.map(name => LabelUtil.createLabelName(name));
        const updatedLabels = [...existingLabels, ...newLabels];
        
        store.dispatch(updateLabelNames(updatedLabels));
        // 创建了AI标签，跳过重复标签（性能优化：移除日志）
    }

    /**
     * 检查是否为重复的标注框
     */
    private static checkDuplicateLabelRect(
        existingLabelRects: LabelRect[], 
        detectionRect: IRect, 
        className: string,
        existingLabels: LabelName[]
    ): boolean {
        const IOU_THRESHOLD = 0.7; // IOU阈值，大于此值认为是相同位置
        
        for (const existingRect of existingLabelRects) {
            const iou = RectUtil.calculateIOU(existingRect.rect, detectionRect);
            
            if (iou > IOU_THRESHOLD) {
                let isSameLabel = false;
                
                if (existingRect.labelId) {
                    const existingLabelName = existingLabels.find(label => label.id === existingRect.labelId);
                    if (existingLabelName) {
                        isSameLabel = existingLabelName.name.toLowerCase() === className.toLowerCase();
                    }
                } else if (existingRect.suggestedLabel) {
                    isSameLabel = existingRect.suggestedLabel.toLowerCase() === className.toLowerCase();
                }
                
                if (isSameLabel) {
                    console.log(`🔍 检测到重复标注框: ${className} (IOU: ${iou.toFixed(3)})`);
                    return true;
                }
            }
        }
        return false;
    }
}
