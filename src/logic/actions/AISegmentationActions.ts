import {store} from "../../index";
import {SegmentationAPIDetector, SegmentationResult} from "../../ai/SegmentationAPIDetector";
import {ImageData, LabelName, LabelRect, LabelPolygon} from "../../store/labels/types";
import {LabelStatus} from "../../data/enums/LabelStatus";
import {v4 as uuidv4} from "uuid";
import {updateImageDataById, updateLabelNames} from "../../store/labels/actionCreators";
import {updateSegmentationResults, updateFullImageInferenceStatus, addInferenceHistory} from "../../store/ai/actionCreators";
import {submitNewNotification, deleteNotificationById, updateNotificationById} from "../../store/notifications/actionCreators";
import {updatePerClassColorationStatus} from "../../store/general/actionCreators";
import {NotificationUtil} from "../../utils/NotificationUtil";
import {LabelUtil} from "../../utils/LabelUtil";
import {RectUtil} from "../../utils/RectUtil";
import {IRect} from "../../interfaces/IRect";
import {IPoint} from "../../interfaces/IPoint";
import {AISelector} from "../../store/selectors/AISelector";
import {LanguageConfig} from "../../data/LanguageConfig";

export class AISegmentationActions {

    public static segmentBbox(imageData: ImageData, bbox: IRect, temporaryRectId?: string): void {
        console.log('Starting segmentation for bbox:', bbox);
        
        // 检查用户是否关闭了AI推理功能
        if (AISelector.isAIDisabled()) {
            console.log('🚫 AI推理已被用户禁用，跳过分割推理');
            return;
        }
        
        // 检查是否启用了分割推理API配置
        if (!AISelector.isSegmentationAPIEnabled()) {
            console.log('🚫 分割推理API未启用，跳过推理');
            return;
        }

        // 创建推理进度通知
        const progressNotification = NotificationUtil.createInferenceProgressNotification();
        store.dispatch(submitNewNotification(progressNotification));

        // 获取国际化文本
        const language = store.getState().general.language;
        const texts = LanguageConfig[language];

        // 更新进度：步骤1 - 预处理
        setTimeout(() => {
            const step1Notification = NotificationUtil.updateInferenceProgress(
                progressNotification, 
                1, 
                texts.aiInference.steps.preprocessing
            );
            store.dispatch(updateNotificationById(progressNotification.id, step1Notification));
        }, 200);

        // 更新进度：步骤2 - 推理过程
        const step2Notification = NotificationUtil.updateInferenceProgress(
            progressNotification, 
            2, 
            texts.aiInference.steps.inference
        );
        store.dispatch(updateNotificationById(progressNotification.id, step2Notification));

        // 延迟调用分割API，确保UI更新
        setTimeout(() => {
            // 调用分割API
            SegmentationAPIDetector.predict(
                imageData,
                bbox,
                // 成功回调
                (results: SegmentationResult[]) => {
                    // 更新进度：步骤3 - 后处理（基于step2Notification）
                    const step3Notification = NotificationUtil.updateInferenceProgress(
                        step2Notification, 
                        3, 
                        texts.aiInference.steps.postprocessing
                    );
                    store.dispatch(updateNotificationById(progressNotification.id, step3Notification));
                    console.log('Segmentation completed, found', results.length, 'objects');
                
                    // 将分割结果转换为矩形框和多边形标签，并删除临时矩形框
                    this.convertSegmentationResultsToLabels(imageData, results, temporaryRectId);
                    
                    // 更新推理结果到状态（保留用于推理结果标签页显示）
                    store.dispatch(updateSegmentationResults(results));
                    
                    // 发送事件通知UI切换到推理结果视图
                    // 暂时使用简单的方式：在控制台提示用户手动切换
                    console.log('🎯 推理完成！请点击右侧边栏的"推理结果"按钮查看结果和缩略图');
                    
                    // 延迟一点时间让用户看到后处理步骤和统计信息
                    setTimeout(() => {
                        // 完成推理进度，显示最终统计
                        const completedNotification = NotificationUtil.completeInferenceProgress(
                            step3Notification,
                            results.length
                        );
                        store.dispatch(updateNotificationById(progressNotification.id, completedNotification));
                        
                        // 再延迟显示最终统计信息
                        setTimeout(() => {
                            // 删除进度通知
                            store.dispatch(deleteNotificationById(progressNotification.id));
                            
                            const totalTime = ((Date.now() - progressNotification.startTime!) / 1000).toFixed(2);
                            
                            // 显示成功通知
                            const language = store.getState().general.language;
                            const texts = LanguageConfig[language];
                            const successMessage = texts.aiInference.successMessage
                                .replace('{count}', results.length.toString())
                                .replace('{time}', totalTime);
                            
                            const successNotification = NotificationUtil.createSuccessNotification({
                                header: texts.aiInference.completed,
                                description: successMessage
                            });
                            store.dispatch(submitNewNotification(successNotification));
                        }, 1500);
                    }, 800); // 让用户看到后处理步骤

                    // 记录详细结果
                    results.forEach((result, index) => {
                        console.log(`Object ${index + 1}:`, {
                            class: result.info.name,
                            confidence: result.info.confidence.toFixed(3),
                            bbox: result.bbox
                        });
                    });
                    
                    // 自动映射推理结果到现有标签
                    this.mapInferenceResultsToLabels(results);
                    
                    // 重置整图推理状态，以便图标切换回原状态
                    store.dispatch(updateFullImageInferenceStatus(false));
                    
                    // 添加分割推理历史记录
                    console.log(`✅ 分割完成，为图片 ${imageData.id} 添加分割历史记录: 分割到 ${results.length} 个对象`);
                    store.dispatch(addInferenceHistory(imageData.id, results.length, true, 'segmentation'));
                    
                    // 临时矩形框已在convertSegmentationResultsToLabels中删除
                },
                // 失败回调
                (error: Error) => {
                    console.error('Segmentation failed:', error);
                    
                    // 删除进度通知
                    store.dispatch(deleteNotificationById(progressNotification.id));
                    
                    // 显示错误通知
                    const language = store.getState().general.language;
                    const texts = LanguageConfig[language];
                    const errorNotification = NotificationUtil.createErrorNotification({
                        header: texts.aiInference.failed,
                        description: error.message || texts.aiInference.failedMessage
                    });
                    store.dispatch(submitNewNotification(errorNotification));
                    
                    // 重置整图推理状态，以便图标切换回原状态
                    store.dispatch(updateFullImageInferenceStatus(false));
                    
                    // 添加失败的分割历史记录
                    console.log(`❌ 分割失败，为图片 ${imageData.id} 添加失败记录`);
                    store.dispatch(addInferenceHistory(imageData.id, 0, false, 'segmentation'));
                    
                    // 即使分割失败，也要删除临时矩形框
                    if (temporaryRectId) {
                        console.log(`🗑️ 分割失败，删除临时矩形框: ${temporaryRectId}`);
                        this.removeTemporaryRect(imageData.id, temporaryRectId);
                    }
                }
            );
        }, 500); // 延迟500ms调用API
    }

    public static clearSegmentationResults(): void {
        store.dispatch(updateSegmentationResults([]));
    }

    public static getSegmentationResults(): SegmentationResult[] {
        return store.getState().ai.segmentationResults || [];
    }

    public static segmentCurrentBbox(): void {
        // 获取当前活跃的标注框
        const state = store.getState();
        const activeImageData = state.labels.imagesData[state.labels.activeImageIndex];
        if (!activeImageData) {
            console.log('No active image data found');
            return;
        }

        // 简化实现，这个方法暂时不使用
        console.log('segmentCurrentBbox method called but not implemented');
    }

    /**
     * 将新的分割结果转换为多边形标签
     * 分割模式下只根据mask生成多边形标签，不生成矩形框
     */
    private static convertSegmentationResultsToLabels(imageData: ImageData, results: SegmentationResult[], temporaryRectId?: string): void {
        const existingLabels: LabelName[] = store.getState().labels.labels;
        const newLabelPolygons: LabelPolygon[] = [];
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

        // 等待标签创建完成后，再处理分割结果
        setTimeout(() => {
            // 获取更新后的标签列表和最新的图像数据
            const updatedLabels: LabelName[] = store.getState().labels.labels;
            const currentImageData = store.getState().labels.imagesData.find(img => img.id === imageData.id);
            
            if (!currentImageData) {
                console.error('无法找到当前图像数据，分割结果处理失败');
                return;
            }

            results.forEach((result: SegmentationResult) => {
                // 分割模式：只处理mask生成多边形标签
                if (result.mask && result.mask.length > 0) {
                    // 转换mask坐标为IPoint数组，添加数据验证
                    const polygonVertices: IPoint[] = result.mask
                        .filter(([x, y]) => {
                            // 过滤掉无效的坐标点
                            const isValid = typeof x === 'number' && typeof y === 'number' && 
                                           !isNaN(x) && !isNaN(y) && 
                                           isFinite(x) && isFinite(y);
                            if (!isValid) {
                                console.warn('发现无效的mask坐标点:', [x, y]);
                            }
                            return isValid;
                        })
                        .map(([x, y]) => ({
                            x: x,
                            y: y
                        }));

                    // 检查是否有足够的有效顶点来形成多边形
                    if (polygonVertices.length < 3) {
                        console.warn('多边形顶点数量不足，需要至少3个顶点，实际:', polygonVertices.length);
                        return; // 跳过这个结果
                    }

                    // 基于bbox检查是否为重复的多边形标签
                    const [x1, y1, x2, y2] = result.bbox;
                    const resultBbox: IRect = {
                        x: x1, 
                        y: y1, 
                        width: x2 - x1, 
                        height: y2 - y1
                    };
                    
                    const isDuplicate = this.checkDuplicatePolygonLabelByBbox(
                        currentImageData.labelPolygons,
                        resultBbox,
                        result.info.name,
                        updatedLabels
                    );
                    
                    if (isDuplicate) {
                        console.log(`🔍 🚫 跳过重复多边形标签: ${result.info.name} (相似bbox位置相同标签)`);
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
                    }

                    // 创建多边形标签
                    const newLabelPolygon: LabelPolygon = {
                        id: uuidv4(),
                        labelId: labelId,
                        vertices: polygonVertices,
                        isCreatedByAI: true,
                        isVisible: true,
                        status: LabelStatus.ACCEPTED,
                        suggestedLabel: labelId ? null : result.info.name
                    };
                    newLabelPolygons.push(newLabelPolygon);
                }
            });

            // 更新图像数据，添加多边形标签并删除临时矩形框
            // 使用最新的图像数据，避免并发更新时的数据覆盖问题
            const latestImageData = store.getState().labels.imagesData.find(img => img.id === imageData.id);
            if (!latestImageData) {
                console.error('无法获取最新的图像数据，更新失败');
                return;
            }
            
            let updatedLabelRects = latestImageData.labelRects;
            if (temporaryRectId) {
                console.log(`🗑️ 在更新图像数据时删除临时矩形框: ${temporaryRectId}`);
                updatedLabelRects = latestImageData.labelRects.filter(rect => rect.id !== temporaryRectId);
                console.log(`🔍 矩形框数量从 ${latestImageData.labelRects.length} 减少到 ${updatedLabelRects.length}`);
            }

            const updatedImageData: ImageData = {
                ...latestImageData,
                labelRects: updatedLabelRects,
                labelPolygons: [...(latestImageData.labelPolygons || []), ...newLabelPolygons]
            };

            console.log(`🔍 更新图像数据 - 多边形标签：从 ${latestImageData.labelPolygons?.length || 0} 增加到 ${updatedImageData.labelPolygons.length}`);
            console.log(`🔍 新增多边形标签数量: ${newLabelPolygons.length}, 跳过重复项: ${skippedDuplicates}`);
            store.dispatch(updateImageDataById(imageData.id, updatedImageData));
            
            // 确保按类别着色功能已启用
            const perClassColorEnabled = store.getState().general.enablePerClassColoration;
            if (!perClassColorEnabled) {
                store.dispatch(updatePerClassColorationStatus(true));
            }
        }, 100); // 给标签创建一点时间
    }

    /**
     * 基于bbox检查是否为重复的多边形标签
     */
    private static checkDuplicatePolygonLabelByBbox(
        existingPolygons: LabelPolygon[],
        resultBbox: IRect,
        className: string,
        existingLabels: LabelName[]
    ): boolean {
        const IOU_THRESHOLD = 0.7; // IoU阈值，大于此值认为是相同位置
        
        console.log(`🔍 检查重复多边形标签: ${className}`, resultBbox);
        console.log(`🔍 现有多边形标签数量: ${existingPolygons.length}`);
        
        for (const existingPolygon of existingPolygons) {
            // 计算现有多边形的边界框
            const existingBbox = this.calculatePolygonBoundingBox(existingPolygon.vertices);
            
            // 计算bbox的IoU
            const iou = RectUtil.calculateIOU(existingBbox, resultBbox);
            console.log(`🔍 多边形bbox IoU计算: 现有bbox ${JSON.stringify(existingBbox)} vs 新bbox ${JSON.stringify(resultBbox)} = ${iou.toFixed(3)}`);
            
            if (iou > IOU_THRESHOLD) {
                let isSameLabel = false;
                
                if (existingPolygon.labelId) {
                    const existingLabelName = existingLabels.find(label => label.id === existingPolygon.labelId);
                    if (existingLabelName) {
                        isSameLabel = existingLabelName.name.toLowerCase() === className.toLowerCase();
                    }
                } else if (existingPolygon.suggestedLabel) {
                    isSameLabel = existingPolygon.suggestedLabel.toLowerCase() === className.toLowerCase();
                }
                
                if (isSameLabel) {
                    console.log(`🔍 🔍 检测到重复多边形标签: ${className} (bbox IoU: ${iou.toFixed(3)})`);
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 计算多边形的边界框
     */
    private static calculatePolygonBoundingBox(vertices: IPoint[]): IRect {
        if (vertices.length === 0) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }
        
        const xCoords = vertices.map(v => v.x);
        const yCoords = vertices.map(v => v.y);
        
        const minX = Math.min(...xCoords);
        const maxX = Math.max(...xCoords);
        const minY = Math.min(...yCoords);
        const maxY = Math.max(...yCoords);
        
        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    // 保留原来的方法用于兼容性
    private static convertInferenceResultsToLabelRects(imageData: ImageData, results: SegmentationResult[]): void {
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

        // 等待标签创建完成后，再处理推理结果
        setTimeout(() => {
            // 获取更新后的标签列表
            const updatedLabels: LabelName[] = store.getState().labels.labels;

            results.forEach((result: SegmentationResult) => {
                const [x1, y1, x2, y2] = result.bbox;
                const inferenceRect: IRect = {x: x1, y: y1, width: x2 - x1, height: y2 - y1};

                // 检查是否为重复的标注框（相同位置+相同标签）
                const isDuplicate = this.checkDuplicateLabelRect(
                    imageData.labelRects, 
                    inferenceRect, 
                    result.info.name,
                    updatedLabels
                );
                
                if (isDuplicate) {
                    console.log(`🚫 跳过重复标注框: ${result.info.name} (相同位置相同标签)`);
                    skippedDuplicates++;
                    return; // 跳过这个结果
                }

                // 查找匹配的标签（现在应该能找到新创建的标签）
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
                    rect: inferenceRect,
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
            console.log(`✅ Added ${newLabelRects.length} new inference results as editable label rectangles (${skippedDuplicates} duplicates skipped)`);
            
            // 确保按类别着色功能已启用
            const perClassColorEnabled = store.getState().general.enablePerClassColoration;
            if (!perClassColorEnabled) {
                console.log('🎨 自动启用按类别着色功能以显示AI推理结果颜色');
                store.dispatch(updatePerClassColorationStatus(true));
            }
        }, 100); // 给标签创建一点时间
    }

    private static createMissingLabels(labelNames: string[]): void {
        const existingLabels: LabelName[] = store.getState().labels.labels;
        
        // 过滤掉已存在的标签名称（不区分大小写）
        const filteredLabelNames = labelNames.filter(name => 
            !existingLabels.some(existing => 
                existing.name.toLowerCase() === name.toLowerCase()
            )
        );
        
        if (filteredLabelNames.length === 0) {
            console.log('所有AI推理标签都已存在，无需创建新标签');
            return;
        }
        
        const newLabels = filteredLabelNames.map(name => LabelUtil.createLabelName(name));
        const updatedLabels = [...existingLabels, ...newLabels];
        
        store.dispatch(updateLabelNames(updatedLabels));
        console.log(`创建了 ${newLabels.length} 个新的AI标签: ${filteredLabelNames.join(', ')}`);
        console.log(`跳过了 ${labelNames.length - filteredLabelNames.length} 个重复标签`);
    }

    private static checkDuplicateLabelRect(
        existingLabelRects: LabelRect[], 
        inferenceRect: IRect, 
        className: string,
        existingLabels: LabelName[]
    ): boolean {
        const IOU_THRESHOLD = 0.7; // IOU阈值，大于此值认为是相同位置
        
        for (const existingRect of existingLabelRects) {
            const iou = RectUtil.calculateIOU(existingRect.rect, inferenceRect);
            
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

    private static mapInferenceResultsToLabels(results: SegmentationResult[]): void {
        const existingLabels: LabelName[] = store.getState().labels.labels;
        const uniqueClassNames = [...new Set(results.map(result => result.info.name))];
        
        let newLabelsCount = 0;
        uniqueClassNames.forEach(className => {
            const existingLabel = existingLabels.find(label => 
                label.name.toLowerCase() === className.toLowerCase()
            );
            
            if (!existingLabel) {
                newLabelsCount++;
            }
        });
        
        console.log(`Mapped labels for ${newLabelsCount} new label types`);
    }

    /**
     * 删除用于分割的临时矩形框
     * @param imageId 图片ID
     * @param rectId 要删除的矩形框ID
     */
    private static removeTemporaryRect(imageId: string, rectId: string): void {
        const currentImageData = store.getState().labels.imagesData.find(img => img.id === imageId);
        if (!currentImageData) {
            console.warn(`找不到图片数据: ${imageId}`);
            return;
        }

        console.log(`🔍 删除前矩形框数量: ${currentImageData.labelRects.length}`);
        console.log(`🔍 要删除的矩形框ID: ${rectId}`);
        console.log(`🔍 现有矩形框IDs:`, currentImageData.labelRects.map(r => r.id));

        // 过滤掉指定的矩形框
        const filteredRects = currentImageData.labelRects.filter(rect => rect.id !== rectId);
        console.log(`🔍 删除后矩形框数量: ${filteredRects.length}`);

        const updatedImageData = {
            ...currentImageData,
            labelRects: filteredRects
        };

        // 更新图片数据
        store.dispatch(updateImageDataById(imageId, updatedImageData));
        console.log(`✅ 已删除临时矩形框 ${rectId}`);
        
        // 验证删除是否成功
        setTimeout(() => {
            const verifyImageData = store.getState().labels.imagesData.find(img => img.id === imageId);
            if (verifyImageData) {
                console.log(`🔍 验证删除结果 - 当前矩形框数量: ${verifyImageData.labelRects.length}`);
                const stillExists = verifyImageData.labelRects.some(rect => rect.id === rectId);
                console.log(`🔍 矩形框是否仍存在: ${stillExists}`);
            }
        }, 100);
    }
}
