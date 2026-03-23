import {LabelsSelector} from '../../store/selectors/LabelsSelector';
import {ImageData, LabelLine, LabelName, LabelPoint, LabelPolygon, LabelRect} from '../../store/labels/types';
import {filter} from 'lodash';
import {store} from '../../index';
import {updateImageData, updateImageDataById} from '../../store/labels/actionCreators';
import {updateSegmentationResults} from '../../store/ai/actionCreators';
import {LabelType} from '../../data/enums/LabelType';
import {LabelUtil} from '../../utils/LabelUtil';
import {SegmentationResult} from '../../ai/SegmentationAPIDetector';

export class LabelActions {
    public static deleteActiveLabel() {
        const activeImageData: ImageData = LabelsSelector.getActiveImageData();
        const activeLabelId: string = LabelsSelector.getActiveLabelId();
        LabelActions.deleteImageLabelById(activeImageData.id, activeLabelId);
    }

    public static deleteImageLabelById(imageId: string, labelId: string) {
        switch (LabelsSelector.getActiveLabelType()) {
            case LabelType.POINT:
                LabelActions.deletePointLabelById(imageId, labelId);
                break;
            case LabelType.RECT:
                LabelActions.deleteRectLabelById(imageId, labelId);
                break;
            case LabelType.POLYGON:
                LabelActions.deletePolygonLabelById(imageId, labelId);
                break;
        }
    }

    public static deleteRectLabelById(imageId: string, labelRectId: string) {
        const imageData: ImageData = LabelsSelector.getImageDataById(imageId);
        
        // 找到被删除的标注框，获取其标签名称用于清理推理结果
        const deletedLabelRect = imageData.labelRects.find(rect => rect.id === labelRectId);
        
        const newImageData = {
            ...imageData,
            labelRects: filter(imageData.labelRects, (currentLabel: LabelRect) => {
                return currentLabel.id !== labelRectId;
            })
        };
        store.dispatch(updateImageDataById(imageData.id, newImageData));
        
        // 如果删除的是AI创建的标注框，检查是否需要清理对应的推理结果
        if (deletedLabelRect?.isCreatedByAI) {
            LabelActions.cleanupSegmentationResultsIfNeeded();
        }
    }

    public static deletePointLabelById(imageId: string, labelPointId: string) {
        const imageData: ImageData = LabelsSelector.getImageDataById(imageId);
        
        // 找到被删除的标注点
        const deletedLabelPoint = imageData.labelPoints.find(point => point.id === labelPointId);
        
        const newImageData = {
            ...imageData,
            labelPoints: filter(imageData.labelPoints, (currentLabel: LabelPoint) => {
                return currentLabel.id !== labelPointId;
            })
        };
        store.dispatch(updateImageDataById(imageData.id, newImageData));
        
        // 如果删除的是AI创建的标注点，检查是否需要清理对应的推理结果
        if (deletedLabelPoint?.isCreatedByAI) {
            LabelActions.cleanupSegmentationResultsIfNeeded();
        }
    }

    public static deleteLineLabelById(imageId: string, labelLineId: string) {
        const imageData: ImageData = LabelsSelector.getImageDataById(imageId);
        
        // 找到被删除的标注线
        const deletedLabelLine = imageData.labelLines.find(line => line.id === labelLineId);
        
        const newImageData = {
            ...imageData,
            labelLines: filter(imageData.labelLines, (currentLabel: LabelLine) => {
                return currentLabel.id !== labelLineId;
            })
        };
        store.dispatch(updateImageDataById(imageData.id, newImageData));
        
        // 如果删除的是AI创建的标注线，检查是否需要清理对应的推理结果
        if (deletedLabelLine?.isCreatedByAI) {
            LabelActions.cleanupSegmentationResultsIfNeeded();
        }
    }

    public static deletePolygonLabelById(imageId: string, labelPolygonId: string) {
        const imageData: ImageData = LabelsSelector.getImageDataById(imageId);
        
        // 找到被删除的标注多边形
        const deletedLabelPolygon = imageData.labelPolygons.find(polygon => polygon.id === labelPolygonId);
        
        const newImageData = {
            ...imageData,
            labelPolygons: filter(imageData.labelPolygons, (currentLabel: LabelPolygon) => {
                return currentLabel.id !== labelPolygonId;
            })
        };
        store.dispatch(updateImageDataById(imageData.id, newImageData));
        
        // 如果删除的是AI创建的标注多边形，检查是否需要清理对应的推理结果
        if (deletedLabelPolygon?.isCreatedByAI) {
            LabelActions.cleanupSegmentationResultsIfNeeded();
        }
    }

    public static toggleLabelVisibilityById(imageId: string, labelId: string) {
        const imageData: ImageData = LabelsSelector.getImageDataById(imageId);
        const newImageData = {
            ...imageData,
            labelPoints: imageData.labelPoints.map((labelPoint: LabelPoint) => {
                return labelPoint.id === labelId ? LabelUtil.toggleAnnotationVisibility(labelPoint) : labelPoint
            }),
            labelRects: imageData.labelRects.map((labelRect: LabelRect) => {
                return labelRect.id === labelId ? LabelUtil.toggleAnnotationVisibility(labelRect) : labelRect
            }),
            labelPolygons: imageData.labelPolygons.map((labelPolygon: LabelPolygon) => {
                return labelPolygon.id === labelId ? LabelUtil.toggleAnnotationVisibility(labelPolygon) : labelPolygon
            }),
            labelLines: imageData.labelLines.map((labelLine: LabelLine) => {
                return labelLine.id === labelId ? LabelUtil.toggleAnnotationVisibility(labelLine) : labelLine
            }),
        };
        store.dispatch(updateImageDataById(imageData.id, newImageData));
    }

    public static removeLabelNames(labelNamesIds: string[]) {
        // 在删除标签之前，先获取要删除的标签名称
        LabelActions.removeSegmentationResultsByLabelIds(labelNamesIds);
        
        const imagesData: ImageData[] = LabelsSelector.getImagesData();
        const newImagesData: ImageData[] = imagesData.map((imageData: ImageData) => {
            return LabelActions.removeLabelNamesFromImageData(imageData, labelNamesIds);
        });
        store.dispatch(updateImageData(newImagesData));
    }

    private static removeLabelNamesFromImageData(imageData: ImageData, labelNamesIds: string[]): ImageData {
        return {
            ...imageData,
            labelRects: imageData.labelRects.map((labelRect: LabelRect) => {
                if (labelNamesIds.includes(labelRect.id)) {
                    return {
                        ...labelRect,
                        id: null
                    }
                } else {
                    return labelRect
                }
            }),
            labelPoints: imageData.labelPoints.map((labelPoint: LabelPoint) => {
                if (labelNamesIds.includes(labelPoint.id)) {
                    return {
                        ...labelPoint,
                        id: null
                    }
                } else {
                    return labelPoint
                }
            }),
            labelPolygons: imageData.labelPolygons.map((labelPolygon: LabelPolygon) => {
                if (labelNamesIds.includes(labelPolygon.id)) {
                    return {
                        ...labelPolygon,
                        id: null
                    }
                } else {
                    return labelPolygon
                }
            }),
            labelNameIds: imageData.labelNameIds.filter((labelNameId: string) => {
                return !labelNamesIds.includes(labelNameId)
            })
        }
    }

    public static labelExistsInLabelNames(label: string): boolean {
        const labelNames: LabelName[] = LabelsSelector.getLabelNames();
        return labelNames
            .map((labelName: LabelName) => labelName.name)
            .includes(label)
    }

    /**
     * 根据删除的标签ID删除对应的分割推理结果
     * @param labelNamesIds 被删除的标签ID数组
     */
    private static removeSegmentationResultsByLabelIds(labelNamesIds: string[]): void {
        const currentState = store.getState();
        const labelNames: LabelName[] = currentState.labels.labels;
        const segmentationResults: SegmentationResult[] = currentState.ai.segmentationResults;
        
        console.log(`🔍 准备删除标签ID: ${labelNamesIds.join(', ')}`);
        console.log(`🔍 当前标签列表:`, labelNames.map(l => `${l.name}(${l.id})`));
        console.log(`🔍 当前分割结果数量: ${segmentationResults.length}`);
        
        // 找到被删除的标签名称
        const deletedLabelNames = labelNames
            .filter((labelName: LabelName) => labelNamesIds.includes(labelName.id))
            .map((labelName: LabelName) => labelName.name.toLowerCase());
        
        console.log(`🔍 被删除的标签名称:`, deletedLabelNames);
        
        if (deletedLabelNames.length === 0) {
            console.log(`⚠️ 没有找到要删除的标签`);
            return; // 没有要删除的标签
        }
        
        // 过滤掉对应的分割推理结果
        const filteredSegmentationResults = segmentationResults.filter((result: SegmentationResult) => {
            const className = result.info?.name || result.class_name;
            if (!className) {
                console.warn('分割结果缺少类别名称:', result);
                return false;
            }
            const shouldKeep = !deletedLabelNames.includes(className.toLowerCase());
            console.log(`🔍 分割结果 "${className}" 是否保留: ${shouldKeep}`);
            return shouldKeep;
        });
        
        // 更新状态
        store.dispatch(updateSegmentationResults(filteredSegmentationResults));
        
        console.log(`🗑️ 已删除 ${segmentationResults.length - filteredSegmentationResults.length} 个对应的分割推理结果`);
        console.log(`🔍 剩余分割结果数量: ${filteredSegmentationResults.length}`);
    }

    /**
     * 清理不再有对应标注框的推理结果
     */
    private static cleanupSegmentationResultsIfNeeded(): void {
        const currentState = store.getState();
        const segmentationResults: SegmentationResult[] = currentState.ai.segmentationResults;
        const imagesData: ImageData[] = currentState.labels.imagesData;
        const labelNames: LabelName[] = currentState.labels.labels;
        
        console.log(`🧹 开始清理推理结果...`);
        
        // 收集所有当前存在的标注框对应的标签名称
        const existingLabelNames = new Set<string>();
        
        imagesData.forEach(imageData => {
            // 从矩形标注框收集标签名称
            imageData.labelRects.forEach(labelRect => {
                if (labelRect.labelId) {
                    const labelName = labelNames.find(ln => ln.id === labelRect.labelId);
                    if (labelName) {
                        existingLabelNames.add(labelName.name.toLowerCase());
                    }
                }
                // 也检查建议的标签名称
                if (labelRect.suggestedLabel) {
                    existingLabelNames.add(labelRect.suggestedLabel.toLowerCase());
                }
            });
            
            // 从点标注收集标签名称
            imageData.labelPoints.forEach(labelPoint => {
                if (labelPoint.labelId) {
                    const labelName = labelNames.find(ln => ln.id === labelPoint.labelId);
                    if (labelName) {
                        existingLabelNames.add(labelName.name.toLowerCase());
                    }
                }
                if (labelPoint.suggestedLabel) {
                    existingLabelNames.add(labelPoint.suggestedLabel.toLowerCase());
                }
            });
            
            // 从多边形标注收集标签名称
            imageData.labelPolygons.forEach(labelPolygon => {
                if (labelPolygon.labelId) {
                    const labelName = labelNames.find(ln => ln.id === labelPolygon.labelId);
                    if (labelName) {
                        existingLabelNames.add(labelName.name.toLowerCase());
                    }
                }
                if (labelPolygon.suggestedLabel) {
                    existingLabelNames.add(labelPolygon.suggestedLabel.toLowerCase());
                }
            });
            
            // 从线标注收集标签名称
            imageData.labelLines.forEach(labelLine => {
                if (labelLine.labelId) {
                    const labelName = labelNames.find(ln => ln.id === labelLine.labelId);
                    if (labelName) {
                        existingLabelNames.add(labelName.name.toLowerCase());
                    }
                }
                if (labelLine.suggestedLabel) {
                    existingLabelNames.add(labelLine.suggestedLabel.toLowerCase());
                }
            });
        });
        
        console.log(`🔍 当前存在的标签名称:`, Array.from(existingLabelNames));
        
        // 过滤掉没有对应标注框的推理结果
        const filteredSegmentationResults = segmentationResults.filter((result: SegmentationResult) => {
            const className = result.info?.name || result.class_name;
            if (!className) {
                console.warn('推理结果缺少类别名称:', result);
                return false;
            }
            const hasCorrespondingLabel = existingLabelNames.has(className.toLowerCase());
            console.log(`🔍 推理结果 "${className}" 是否有对应标注框: ${hasCorrespondingLabel}`);
            return hasCorrespondingLabel;
        });
        
        if (filteredSegmentationResults.length !== segmentationResults.length) {
            store.dispatch(updateSegmentationResults(filteredSegmentationResults));
            console.log(`🧹 清理完成！删除了 ${segmentationResults.length - filteredSegmentationResults.length} 个无对应标注框的推理结果`);
        } else {
            console.log(`🧹 无需清理，所有推理结果都有对应的标注框`);
        }
    }
}
