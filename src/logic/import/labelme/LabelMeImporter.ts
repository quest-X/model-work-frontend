import {ImageData, LabelName} from '../../../store/labels/types';
import {LabelsSelector} from '../../../store/selectors/LabelsSelector';
import {AnnotationImporter, ImportResult} from '../AnnotationImporter';
import {ImageDataUtil} from '../../../utils/ImageDataUtil';
import {LabelUtil} from '../../../utils/LabelUtil';
import {LabelType} from '../../../data/enums/LabelType';
import {IRect} from '../../../interfaces/IRect';
import {IPoint} from '../../../interfaces/IPoint';
import {ArrayUtil} from '../../../utils/ArrayUtil';
import {Settings} from '../../../settings/Settings';
import { v4 as uuidv4 } from 'uuid';

interface LabelMeShape {
    label: string;
    points: [number, number][];
    shape_type: 'polygon' | 'rectangle' | 'mask';
    mask: string | null;
}

interface LabelMeAnnotation {
    shapes: LabelMeShape[];
    imagePath: string;
    imageHeight: number;
    imageWidth: number;
}

export class LabelMeImporter extends AnnotationImporter {
    public import(
        filesData: File[],
        onSuccess: (imagesData: ImageData[], labelNames: LabelName[]) => any,
        onFailure: (error?: Error) => any
    ): void {
        const jsonFiles = filesData.filter(f => f.name.toLowerCase().endsWith('.json'));
        if (jsonFiles.length === 0) {
            onFailure(new Error('No JSON files found'));
            return;
        }

        const readPromises = jsonFiles.map(f =>
            new Promise<LabelMeAnnotation>((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsText(f);
                reader.onloadend = (evt: any) => {
                    try {
                        resolve(JSON.parse(evt.target.result) as LabelMeAnnotation);
                    } catch {
                        reject(new Error(`Failed to parse ${f.name}`));
                    }
                };
                reader.onerror = () => reject(new Error(`Failed to read ${f.name}`));
            })
        );

        Promise.all(readPromises)
            .then(annotations => {
                try {
                    const result = this.applyLabels(LabelsSelector.getImagesData(), annotations);
                    onSuccess(result.imagesData, result.labelNames);
                } catch (e) {
                    onFailure(e as Error);
                }
            })
            .catch(e => onFailure(e instanceof Error ? e : new Error(String(e))));
    }

    private applyLabels(imageData: ImageData[], annotations: LabelMeAnnotation[]): ImportResult {
        const allLabels = new Set<string>();
        annotations.forEach(ann => ann.shapes.forEach(s => allLabels.add(s.label)));

        const labelNameMap: Record<string, LabelName> = {};
        let colorIdx = 0;
        allLabels.forEach(name => {
            labelNameMap[name] = {
                id: uuidv4(),
                name,
                color: ArrayUtil.getByInfiniteIndex(Settings.LABEL_COLORS_PALETTE, colorIdx++)
            };
        });

        if (imageData.length === 0) {
            throw new Error('此标注包不含图像文件，请先在主界面加载对应的图像，再导入标注');
        }

        const cleanImageData = imageData.map(img => ImageDataUtil.cleanAnnotations(img));
        const imageDataByName: Record<string, ImageData> = {};
        cleanImageData.forEach(img => {
            imageDataByName[img.fileData.name] = img;
        });

        const matchedNames = new Set(annotations.map(ann => ann.imagePath.split('/').pop() || ann.imagePath));
        const hasMatch = Array.from(matchedNames).some(name => imageDataByName[name]);
        if (!hasMatch) {
            throw new Error('标注文件与已加载图像文件名不匹配，请确认加载了正确的图像');
        }

        for (const ann of annotations) {
            const baseName = ann.imagePath.split('/').pop() || ann.imagePath;
            const imgData = imageDataByName[baseName];
            if (!imgData) continue;

            for (const shape of ann.shapes) {
                const labelId = labelNameMap[shape.label]?.id;
                if (!labelId) continue;

                if (shape.shape_type === 'rectangle' && this.labelType.includes(LabelType.RECT)) {
                    const [[x1, y1], [x2, y2]] = shape.points;
                    const rect: IRect = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
                    imgData.labelRects.push({ ...LabelUtil.createLabelRect(labelId, rect), isCreatedByAI: true });
                }

                if (shape.shape_type === 'polygon' && this.labelType.includes(LabelType.POLYGON)) {
                    const vertices: IPoint[] = shape.points.map(([x, y]) => ({ x, y }));
                    imgData.labelPolygons.push({ ...LabelUtil.createLabelPolygon(labelId, vertices), isCreatedByAI: true });
                }

                // mask: import bounding box as rect when in rect mode
                if (shape.shape_type === 'mask' && shape.points.length >= 2 && this.labelType.includes(LabelType.RECT)) {
                    const [[x1, y1], [x2, y2]] = shape.points;
                    const rect: IRect = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
                    imgData.labelRects.push({ ...LabelUtil.createLabelRect(labelId, rect), isCreatedByAI: true });
                }
            }
        }

        return {
            imagesData: ImageDataUtil.arrange(cleanImageData, imageData.map(img => img.id)),
            labelNames: Object.values(labelNameMap)
        };
    }
}
