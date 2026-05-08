import {LabelsSelector} from '../../store/selectors/LabelsSelector';
import {ImageData, LabelLine, LabelName, LabelPoint, LabelPolygon, LabelRect} from '../../store/labels/types';
import {filter} from 'lodash';
import {store} from '../../index';
import {updateImageData, updateImageDataById} from '../../store/labels/actionCreators';
import {LabelType} from '../../data/enums/LabelType';
import {LabelUtil} from '../../utils/LabelUtil';

export class LabelActions {
    public static deleteActiveLabel() {
        const activeImageData: ImageData = LabelsSelector.getActiveImageData();
        const activeLabelId: string = LabelsSelector.getActiveLabelId();
        LabelActions.deleteImageLabelById(activeImageData.id, activeLabelId);
    }

    public static deleteImageLabelById(imageId: string, labelId: string) {
        const labelType = LabelsSelector.getActiveLabelType();
        switch (labelType) {
            case LabelType.POINT:
                LabelActions.deletePointLabelById(imageId, labelId);
                break;
            case LabelType.RECT:
                LabelActions.deleteRectLabelById(imageId, labelId);
                break;
            case LabelType.POLYGON:
                LabelActions.deletePolygonLabelById(imageId, labelId);
                break;
            case LabelType.LINE:
                LabelActions.deleteLineLabelById(imageId, labelId);
                break;
            case LabelType.ALL: {
                // ALL 视图（智能标注/橡皮擦等）：按 labelId 在各类型中查找并删除
                const imageData = LabelsSelector.getImageDataById(imageId);
                if (!imageData) break;
                if (imageData.labelRects?.some(r => r.id === labelId)) {
                    LabelActions.deleteRectLabelById(imageId, labelId);
                } else if (imageData.labelPolygons?.some(p => p.id === labelId)) {
                    LabelActions.deletePolygonLabelById(imageId, labelId);
                } else if (imageData.labelPoints?.some(p => p.id === labelId)) {
                    LabelActions.deletePointLabelById(imageId, labelId);
                } else if (imageData.labelLines?.some(l => l.id === labelId)) {
                    LabelActions.deleteLineLabelById(imageId, labelId);
                }
                break;
            }
        }
    }

    public static deleteRectLabelById(imageId: string, labelRectId: string) {
        const imageData: ImageData = LabelsSelector.getImageDataById(imageId);
        const newImageData = {
            ...imageData,
            labelRects: filter(imageData.labelRects, (currentLabel: LabelRect) => {
                return currentLabel.id !== labelRectId;
            })
        };
        store.dispatch(updateImageDataById(imageData.id, newImageData));
    }

    public static deletePointLabelById(imageId: string, labelPointId: string) {
        const imageData: ImageData = LabelsSelector.getImageDataById(imageId);
        const newImageData = {
            ...imageData,
            labelPoints: filter(imageData.labelPoints, (currentLabel: LabelPoint) => {
                return currentLabel.id !== labelPointId;
            })
        };
        store.dispatch(updateImageDataById(imageData.id, newImageData));
    }

    public static deleteLineLabelById(imageId: string, labelLineId: string) {
        const imageData: ImageData = LabelsSelector.getImageDataById(imageId);
        const newImageData = {
            ...imageData,
            labelLines: filter(imageData.labelLines, (currentLabel: LabelLine) => {
                return currentLabel.id !== labelLineId;
            })
        };
        store.dispatch(updateImageDataById(imageData.id, newImageData));
    }

    public static deletePolygonLabelById(imageId: string, labelPolygonId: string) {
        const imageData: ImageData = LabelsSelector.getImageDataById(imageId);
        const newImageData = {
            ...imageData,
            labelPolygons: filter(imageData.labelPolygons, (currentLabel: LabelPolygon) => {
                return currentLabel.id !== labelPolygonId;
            })
        };
        store.dispatch(updateImageDataById(imageData.id, newImageData));
    }

    /**
     * 删除多边形中指定索引的顶点。
     * 若删除后顶点数 < 3，直接删除整个多边形。
     */
    public static deletePolygonVertexByIndex(imageId: string, polygonId: string, vertexIndex: number) {
        const imageData: ImageData = LabelsSelector.getImageDataById(imageId);
        const polygon = imageData.labelPolygons.find(p => p.id === polygonId);
        if (!polygon) return;
        if (polygon.vertices.length <= 3) {
            LabelActions.deletePolygonLabelById(imageId, polygonId);
            return;
        }
        const newVertices = polygon.vertices.filter((_, i) => i !== vertexIndex);
        const newImageData = {
            ...imageData,
            labelPolygons: imageData.labelPolygons.map(p =>
                p.id === polygonId ? { ...p, vertices: newVertices } : p
            )
        };
        store.dispatch(updateImageDataById(imageData.id, newImageData));
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
                if (labelNamesIds.includes(labelRect.labelId)) {
                    return {
                        ...labelRect,
                        labelId: null
                    }
                } else {
                    return labelRect
                }
            }),
            labelPoints: imageData.labelPoints.map((labelPoint: LabelPoint) => {
                if (labelNamesIds.includes(labelPoint.labelId)) {
                    return {
                        ...labelPoint,
                        labelId: null
                    }
                } else {
                    return labelPoint
                }
            }),
            labelPolygons: imageData.labelPolygons.map((labelPolygon: LabelPolygon) => {
                if (labelNamesIds.includes(labelPolygon.labelId)) {
                    return {
                        ...labelPolygon,
                        labelId: null
                    }
                } else {
                    return labelPolygon
                }
            }),
            labelLines: imageData.labelLines.map((labelLine: LabelLine) => {
                if (labelNamesIds.includes(labelLine.labelId)) {
                    return {
                        ...labelLine,
                        labelId: null
                    }
                } else {
                    return labelLine
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
}
