import {store} from "../../index";
import {RetrievalAPIDetector, RetrievalResult} from "../../ai/RetrievalAPIDetector";
import {ImageData, LabelName, LabelRect} from "../../store/labels/types";
import {LabelStatus} from "../../data/enums/LabelStatus";
import {v4 as uuidv4} from "uuid";
import {updateImageDataById, updateLabelNames} from "../../store/labels/actionCreators";
import {LabelsSelector} from "../../store/selectors/LabelsSelector";
import {EditorActions} from "./EditorActions";
import {updateFullImageInferenceStatus, addInferenceHistory, toggleImageAILabelsVisibility} from "../../store/ai/actionCreators";
import {submitNewNotification, deleteNotificationById, updateNotificationById} from "../../store/notifications/actionCreators";
import {updatePerClassColorationStatus} from "../../store/general/actionCreators";
import {NotificationUtil} from "../../utils/NotificationUtil";
import {LabelUtil} from "../../utils/LabelUtil";
import {RectUtil} from "../../utils/RectUtil";
import {IRect} from "../../interfaces/IRect";
import {AISelector} from "../../store/selectors/AISelector";
import {AIModelsSelector} from "../../store/selectors/AIModelsSelector";
import {LanguageConfig} from "../../data/LanguageConfig";
import {LabelsSelector} from "../../store/selectors/LabelsSelector";

export class AIRetrievalActions {

    /**
     * 执行图像检索
     * @param imageData 当前图片数据
     * @param queryBbox 用户拉的查询标注框
     */
    public static retrieveImages(imageData: ImageData, queryBbox: [number, number, number, number]): void {
        console.log('🔍 === 开始图像检索 ===');
        console.log('🔍 输入图像:', imageData.fileData?.name || 'unnamed');
        console.log('🔍 查询bbox:', queryBbox);
        
        // 获取用户配置的检索模型
        const state = store.getState();
        const retrievalModel = AIModelsSelector.getActiveModelByType(state, 'retrieval');
        
        if (!retrievalModel) {
            console.error('🔍 没有找到配置的检索模型');
            return;
        }
        
        console.log('🔍 使用检索模型:', retrievalModel.name);
        console.log('🔍 模型URL:', retrievalModel.url);
        
        // 使用用户配置的模型URL更新检索API配置
        RetrievalAPIDetector.setConfig({
            url: retrievalModel.url,
            enabled: true
        });
        
        // 检查检索API是否可用
        if (!RetrievalAPIDetector.isEnabled()) {
            console.error('🔍 检索API未启用');
            return;
        }

        // 创建检索进度通知
        const progressNotification = NotificationUtil.createInferenceProgressNotification();
        store.dispatch(submitNewNotification(progressNotification));

        // 获取国际化文本
        const language = store.getState().general.language;
        const texts = LanguageConfig[language];

        console.log('🔍 创建进度通知:', progressNotification.id);

        // 更新进度：步骤1 - 预处理
        queueMicrotask(() => {
            const step1Notification = NotificationUtil.updateInferenceProgress(
                progressNotification, 
                1, 
                '图像预处理中...'
            );
            store.dispatch(updateNotificationById(progressNotification.id, step1Notification));
            console.log('🔍 步骤1: 图像预处理');
        });

        // 更新进度：步骤2 - 检索过程
        const step2Notification = NotificationUtil.updateInferenceProgress(
            progressNotification, 
            2, 
            '图像检索中...'
        );
        store.dispatch(updateNotificationById(progressNotification.id, step2Notification));
        console.log('🔍 步骤2: 开始图像检索');

        // 使用微任务调用检索API，避免阻塞主线程
        queueMicrotask(() => {
            // 调用检索API
            RetrievalAPIDetector.predict(
                imageData,
                queryBbox,
                // 成功回调
                (results: RetrievalResult[]) => {
                    console.log('🔍 === 检索API调用成功 ===');
                    console.log('🔍 检索结果数量:', results.length);
                    console.log('🔍 检索结果详情:', results);
                    
                    // 更新进度：步骤3 - 后处理
                    const step3Notification = NotificationUtil.updateInferenceProgress(
                        step2Notification, 
                        3, 
                        '结果处理中...'
                    );
                    store.dispatch(updateNotificationById(progressNotification.id, step3Notification));
                    console.log('🔍 步骤3: 结果处理');
                
                    // 将检索结果根据img_filename分发到对应的图像上
                    this.distributeRetrievalResultsToImages(results);
                    
                    // 检查是否需要对检索结果进行分割
                    this.processRetrievalResultsForSegmentation(results);
                    
                    // 批量更新通知，避免多次dispatch
                    queueMicrotask(() => {
                        // 完成检索进度，显示最终统计
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
                            const successMessage = `检索完成：找到 ${results.length} 个相似结果，耗时 ${totalTime} 秒`;
                            
                            console.log('🔍 检索完成通知:', successMessage);
                            
                            const successNotification = NotificationUtil.createSuccessNotification({
                                header: '图像检索完成',
                                description: successMessage
                            });
                            store.dispatch(submitNewNotification(successNotification));
                        }, 800);
                    });

                    // 重置检索状态
                    store.dispatch(updateFullImageInferenceStatus(false));
                    
                    // 添加检索历史记录，这会自动显示AI标签
                    console.log('🔍 添加检索历史记录');
                    store.dispatch(addInferenceHistory(imageData.id, results.length, true, 'retrieval' as any));
                    
                    // 确保所有涉及的图像都显示AI标签
                    const resultsByFilename = new Map<string, RetrievalResult[]>();
                    results.forEach(result => {
                        const filename = result.info.img_filename;
                        if (!resultsByFilename.has(filename)) {
                            resultsByFilename.set(filename, []);
                        }
                        resultsByFilename.get(filename)!.push(result);
                    });
                    
                    // 为每个有检索结果的图像启用AI标签显示
                    const allImages = LabelsSelector.getImagesData();
                    resultsByFilename.forEach((imageResults, filename) => {
                        const matchedImage = allImages.find(img => {
                            const imgFilename = img.fileData?.name || '';
                            return imgFilename === filename || imgFilename.includes(filename) || filename.includes(imgFilename.split('.')[0]);
                        });
                        
                        if (matchedImage) {
                            console.log(`🔍 为图像 ${filename} 启用AI标签显示`);
                            // 检查当前AI标签显示状态
                            const currentAIState = store.getState().ai.imageAIStates.get(matchedImage.id);
                            const currentlyVisible = currentAIState ? currentAIState.aiLabelsVisible : false;
                            
                            if (!currentlyVisible) {
                                store.dispatch(toggleImageAILabelsVisibility(matchedImage.id));
                                console.log(`🔍 ✅ 图像 ${filename} AI标签已启用显示`);
                            } else {
                                console.log(`🔍 ℹ️ 图像 ${filename} AI标签已经是显示状态`);
                            }
                        }
                    });
                    
                    // 强制触发canvas重绘，确保新标注框立即显示
                    queueMicrotask(() => {
                        EditorActions.fullRender();
                        console.log('🔍 ✅ 触发canvas重绘，显示检索结果');
                    });
                },
                // 失败回调
                (error: Error) => {
                    console.error('🔍 === 检索API调用失败 ===');
                    console.error('🔍 错误详情:', error);
                    
                    // 删除进度通知
                    store.dispatch(deleteNotificationById(progressNotification.id));
                    
                    // 显示错误通知
                    const language = store.getState().general.language;
                    const texts = LanguageConfig[language];
                    const errorNotification = NotificationUtil.createErrorNotification({
                        header: '图像检索失败',
                        description: error.message || '检索过程中发生错误'
                    });
                    store.dispatch(submitNewNotification(errorNotification));
                    
                    // 重置检索状态
                    store.dispatch(updateFullImageInferenceStatus(false));
                    
                    // 添加失败的检索历史记录
                    console.log('🔍 添加失败的检索历史记录');
                    store.dispatch(addInferenceHistory(imageData.id, 0, false, 'retrieval' as any));
                }
            );
        });
    }

    /**
     * 将检索结果根据img_filename分发到对应的图像上
     */
    private static distributeRetrievalResultsToImages(results: RetrievalResult[]): void {
        console.log('🔍 === 开始分发检索结果到对应图像 ===');
        console.log('🔍 检索结果总数:', results.length);
        
        // 获取当前项目中的所有图像
        const allImages = LabelsSelector.getImagesData();
        console.log('🔍 项目中的图像总数:', allImages.length);
        
        // 按img_filename分组检索结果
        const resultsByFilename = new Map<string, RetrievalResult[]>();
        results.forEach(result => {
            const filename = result.info.img_filename;
            if (!resultsByFilename.has(filename)) {
                resultsByFilename.set(filename, []);
            }
            resultsByFilename.get(filename)!.push(result);
        });
        
        console.log('🔍 涉及的图像文件:', Array.from(resultsByFilename.keys()));
        
        // 为每个匹配的图像添加检索结果bbox
        let totalProcessed = 0;
        resultsByFilename.forEach((imageResults, filename) => {
            // 根据文件名找到对应的图像数据
            const matchedImage = allImages.find(img => {
                // 提取文件名（去掉路径和扩展名）
                const imgFilename = img.fileData?.name || '';
                return imgFilename === filename || imgFilename.includes(filename) || filename.includes(imgFilename.split('.')[0]);
            });
            
            if (matchedImage) {
                console.log(`🔍 ✅ 找到匹配图像: ${filename} -> ${matchedImage.fileData?.name}`);
                console.log(`🔍 为图像 ${filename} 添加 ${imageResults.length} 个检索结果`);
                
                // 为这个图像添加检索结果bbox
                this.addRetrievalResultsToImage(matchedImage, imageResults);
                totalProcessed += imageResults.length;
            } else {
                console.log(`🔍 ⚠️ 未找到匹配图像: ${filename}`);
            }
        });
        
        console.log(`🔍 ✅ 检索结果分发完成，共处理 ${totalProcessed} 个结果`);
    }

    /**
     * 为指定图像添加检索结果bbox
     */
    private static addRetrievalResultsToImage(imageData: ImageData, results: RetrievalResult[]): void {
        console.log(`🔍 === 为图像 ${imageData.fileData?.name} 添加检索结果 ===`);
        console.log('🔍 图像ID:', imageData.id);
        console.log('🔍 检索结果数量:', results.length);
        
        const existingLabels: LabelName[] = store.getState().labels.labels;
        const newLabelRects: LabelRect[] = [];
        let skippedDuplicates = 0;

        console.log('🔍 现有标签数量:', existingLabels.length);
        console.log('🔍 现有标签:', existingLabels.map(label => label.name));

        // 首先创建缺失的标签
        const uniqueNewLabels = [...new Set(results
            .filter(result => !existingLabels.some(existing => 
                existing.name.toLowerCase() === result.info.name.toLowerCase()
            ))
            .map(result => result.info.name)
        )];

        console.log('🔍 需要创建的新标签:', uniqueNewLabels);

        if (uniqueNewLabels.length > 0) {
            this.createMissingLabels(uniqueNewLabels);
        }

        // 使用微任务处理检索结果，避免阻塞
        queueMicrotask(() => {
            // 获取更新后的标签列表
            const updatedLabels: LabelName[] = store.getState().labels.labels;
            console.log('🔍 更新后的标签列表:', updatedLabels.map(label => label.name));

            results.forEach((result: RetrievalResult, index: number) => {
                console.log(`🔍 处理检索结果 ${index + 1}/${results.length}:`, result);
                console.log(`🔍 检索结果详情 - ID: ${result.info.id}, 名称: ${result.info.name}, 置信度: ${result.info.confidence}, 文件: ${result.info.img_filename}`);
                
                // 转换bbox格式：[x1, y1, x2, y2] -> IRect
                const [x1, y1, x2, y2] = result.bbox;
                const retrievalRect: IRect = {
                    x: x1, 
                    y: y1, 
                    width: x2 - x1, 
                    height: y2 - y1
                };

                console.log('🔍 转换后的矩形:', retrievalRect);
                console.log(`🔍 矩形位置: x=${x1}, y=${y1}, width=${x2-x1}, height=${y2-y1}`);

                // 检查是否为重复的标注框（相同位置+相同标签）
                const isDuplicate = this.checkDuplicateLabelRect(
                    imageData.labelRects, 
                    retrievalRect, 
                    result.info.name,
                    updatedLabels
                );
                
                if (isDuplicate) {
                    console.log(`🔍 🚫 跳过重复标注框: ${result.info.name} (相同位置相同标签)`);
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
                    console.log(`🔍 ✅ 使用标签: ${matchingLabel.name} (匹配 ${result.info.name}) - 颜色: ${matchingLabel.color}`);
                } else {
                    console.log(`🔍 ⚠️ 未找到匹配标签: ${result.info.name}`);
                }

                const newLabelRect: LabelRect = {
                    id: uuidv4(),
                    labelId: labelId,
                    rect: retrievalRect,
                    isCreatedByAI: true,
                    isVisible: true,
                    status: LabelStatus.ACCEPTED,
                    suggestedLabel: labelId ? null : result.info.name
                };

                console.log(`🔍 创建新标注框 ${index + 1}/${results.length}:`, newLabelRect);
                console.log(`🔍 标注框ID: ${newLabelRect.id}, 标签ID: ${labelId}, 建议标签: ${newLabelRect.suggestedLabel}`);
                newLabelRects.push(newLabelRect);
            });

            // 添加新的标注框到图像数据
            const updatedImageData: ImageData = {
                ...imageData,
                labelRects: [...imageData.labelRects, ...newLabelRects]
            };

            console.log(`🔍 为图像 ${imageData.fileData?.name} 更新数据，新增标注框数量:`, newLabelRects.length);
            console.log('🔍 跳过重复项数量:', skippedDuplicates);
            console.log('🔍 更新前图像的标注框数量:', imageData.labelRects.length);
            console.log('🔍 更新后图像的标注框数量:', updatedImageData.labelRects.length);
            console.log('🔍 新增的标注框列表:', newLabelRects.map(rect => ({
                id: rect.id,
                position: rect.rect,
                labelId: rect.labelId,
                suggestedLabel: rect.suggestedLabel
            })));

            store.dispatch(updateImageDataById(imageData.id, updatedImageData));
            console.log(`🔍 ✅ 为图像 ${imageData.fileData?.name} 添加了 ${newLabelRects.length} 个检索结果标注框 (跳过了 ${skippedDuplicates} 个重复项)`);
            
            // 确保按类别着色功能已启用
            const perClassColorEnabled = store.getState().general.enablePerClassColoration;
            if (!perClassColorEnabled) {
                console.log('🔍 🎨 自动启用按类别着色功能以显示AI检索结果颜色');
                store.dispatch(updatePerClassColorationStatus(true));
            }
        });
    }

    /**
     * 创建缺失的标签
     */
    private static createMissingLabels(labelNames: string[]): void {
        console.log('🔍 === 创建缺失的标签 ===');
        console.log('🔍 需要创建的标签:', labelNames);
        
        const existingLabels: LabelName[] = store.getState().labels.labels;
        
        // 过滤掉已存在的标签名称（不区分大小写）
        const filteredLabelNames = labelNames.filter(name => 
            !existingLabels.some(existing => 
                existing.name.toLowerCase() === name.toLowerCase()
            )
        );
        
        console.log('🔍 过滤后需要创建的标签:', filteredLabelNames);
        
        if (filteredLabelNames.length === 0) {
            console.log('🔍 所有检索标签都已存在，无需创建新标签');
            return;
        }
        
        const newLabels = filteredLabelNames.map(name => {
            const newLabel = LabelUtil.createLabelName(name);
            console.log('🔍 创建新标签:', newLabel);
            return newLabel;
        });
        const updatedLabels = [...existingLabels, ...newLabels];
        
        store.dispatch(updateLabelNames(updatedLabels));
        console.log('🔍 ✅ 创建了检索标签，总标签数:', updatedLabels.length);
    }

    /**
     * 检查是否为重复的标注框
     */
    private static checkDuplicateLabelRect(
        existingLabelRects: LabelRect[], 
        retrievalRect: IRect, 
        className: string,
        existingLabels: LabelName[]
    ): boolean {
        const IOU_THRESHOLD = 0.7; // IOU阈值，大于此值认为是相同位置
        
        console.log(`🔍 检查重复标注框: ${className}`, retrievalRect);
        console.log(`🔍 现有标注框数量: ${existingLabelRects.length}`);
        
        for (const existingRect of existingLabelRects) {
            const iou = RectUtil.calculateIOU(existingRect.rect, retrievalRect);
            console.log(`🔍 IOU计算: 现有矩形 ${JSON.stringify(existingRect.rect)} vs 新矩形 ${JSON.stringify(retrievalRect)} = ${iou.toFixed(3)}`);
            
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
                    console.log(`🔍 🔍 检测到重复标注框: ${className} (IOU: ${iou.toFixed(3)})`);
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 处理检索结果，对新的标注框进行分割
     */
    private static processRetrievalResultsForSegmentation(results: RetrievalResult[]): void {
        console.log('🔍 === 开始处理检索结果进行分割 ===');
        
        // 检查分割API和检索分割配置是否启用
        const aiState = store.getState().ai;
        if (aiState.isAIDisabled || !aiState.segmentationAPIConfig.enabled || !aiState.enableRetrievalSegmentation) {
            console.log('🔍 ⚠️ 分割功能未启用或检索分割被禁用，跳过检索结果分割');
            console.log('🔍 AI禁用:', aiState.isAIDisabled, '分割API启用:', aiState.segmentationAPIConfig.enabled, '检索分割启用:', aiState.enableRetrievalSegmentation);
            return;
        }
        
        // 获取所有图像数据
        const allImages = LabelsSelector.getImagesData();
        
        // 按img_filename分组检索结果
        const resultsByFilename = new Map<string, RetrievalResult[]>();
        results.forEach(result => {
            const filename = result.info.img_filename;
            if (!resultsByFilename.has(filename)) {
                resultsByFilename.set(filename, []);
            }
            resultsByFilename.get(filename)!.push(result);
        });
        
        console.log('🔍 需要分割的图像文件:', Array.from(resultsByFilename.keys()));
        
        // 为每个图像的检索结果执行分割
        let totalSegmentationTasks = 0;
        resultsByFilename.forEach((imageResults, filename) => {
            const matchedImage = allImages.find(img => {
                const imgFilename = img.fileData?.name || '';
                return imgFilename === filename || imgFilename.includes(filename) || filename.includes(imgFilename.split('.')[0]);
            });
            
            if (matchedImage) {
                console.log(`🔍 为图像 ${filename} 的 ${imageResults.length} 个检索结果执行分割`);
                
                // 延迟执行分割，避免同时发起太多请求
                imageResults.forEach((result, index) => {
                    setTimeout(() => {
                        this.segmentRetrievalResult(matchedImage, result);
                    }, index * 1000); // 每个分割请求间隔1秒
                    totalSegmentationTasks++;
                });
            }
        });
        
        if (totalSegmentationTasks > 0) {
            console.log(`🔍 ✅ 已安排 ${totalSegmentationTasks} 个检索结果进行分割处理`);
            
            // 显示分割任务开始通知
            const segmentationNotification = NotificationUtil.createMessageNotification({
                header: '检索结果分割',
                description: `正在对 ${totalSegmentationTasks} 个检索结果进行精确分割...`
            });
            store.dispatch(submitNewNotification(segmentationNotification));
            
            // 5秒后自动删除通知
            setTimeout(() => {
                store.dispatch(deleteNotificationById(segmentationNotification.id));
            }, 5000);
        } else {
            console.log('🔍 没有找到需要分割的检索结果');
        }
    }

    /**
     * 对单个检索结果执行分割
     */
    private static segmentRetrievalResult(imageData: ImageData, result: RetrievalResult): void {
        console.log(`🔍 🔪 开始分割检索结果: ${result.info.name} 在图像 ${imageData.fileData?.name}`);
        
        // 转换bbox格式：[x1, y1, x2, y2] -> IRect
        const [x1, y1, x2, y2] = result.bbox;
        const retrievalRect: IRect = {
            x: x1, 
            y: y1, 
            width: x2 - x1, 
            height: y2 - y1
        };
        
        console.log('🔍 分割目标区域:', retrievalRect);
        
        // 导入分割Actions（避免循环依赖）
        import('./AISegmentationActions').then(({ AISegmentationActions }) => {
            // 调用分割API
            AISegmentationActions.segmentBbox(imageData, retrievalRect);
        }).catch(error => {
            console.error('🔍 ❌ 导入分割Actions失败:', error);
        });
    }
}
