import {ImageData, LabelName} from '../../../store/labels/types';
import {LabelsSelector} from '../../../store/selectors/LabelsSelector';
import {AnnotationImporter, ImportResult} from '../AnnotationImporter';
import {ImageDataUtil} from '../../../utils/ImageDataUtil';
import {LabelUtil} from '../../../utils/LabelUtil';
import {LabelType} from '../../../data/enums/LabelType';
import {VGGObject, VGGPolygon} from '../../../data/labels/VGG';
import {IPoint} from '../../../interfaces/IPoint';
import {ArrayUtil} from '../../../utils/ArrayUtil';
import {Settings} from '../../../settings/Settings';
import { v4 as uuidv4 } from 'uuid';

export class VGGImporter extends AnnotationImporter {
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
            new Promise<VGGObject>((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsText(f);
                reader.onloadend = (evt: any) => {
                    try {
                        resolve(JSON.parse(evt.target.result) as VGGObject);
                    } catch {
                        reject(new Error(`Failed to parse ${f.name}`));
                    }
                };
                reader.onerror = () => reject(new Error(`Failed to read ${f.name}`));
            })
        );

        Promise.all(readPromises)
            .then(vggObjects => {
                // Merge all split JSONs (train/val/test) into one map
                const merged: VGGObject = Object.assign({}, ...vggObjects);
                try {
                    const result = this.applyLabels(LabelsSelector.getImagesData(), merged);
                    onSuccess(result.imagesData, result.labelNames);
                } catch (e) {
                    onFailure(e as Error);
                }
            })
            .catch(e => onFailure(e instanceof Error ? e : new Error(String(e))));
    }

    private applyLabels(imageData: ImageData[], vgg: VGGObject): ImportResult {
        if (imageData.length === 0) {
            throw new Error('请先加载图片或视频，再导入 VGG 标注');
        }

        // Collect all label names
        const allLabels = new Set<string>();
        Object.values(vgg).forEach(fileData => {
            Object.values(fileData.regions).forEach(region => {
                const label = region.region_attributes?.label;
                if (label) allLabels.add(label);
            });
        });

        const labelNameMap: Record<string, LabelName> = {};
        let colorIdx = 0;
        allLabels.forEach(name => {
            labelNameMap[name] = {
                id: uuidv4(),
                name,
                color: ArrayUtil.getByInfiniteIndex(Settings.LABEL_COLORS_PALETTE, colorIdx++)
            };
        });

        const cleanImageData = imageData.map(img => ImageDataUtil.cleanAnnotations(img));
        const imageDataByName: Record<string, ImageData> = {};
        cleanImageData.forEach(img => { imageDataByName[img.fileData.name] = img; });

        const hasMatch = Object.keys(vgg).some(filename => imageDataByName[filename]);
        if (!hasMatch) {
            throw new Error('标注文件与当前图片不匹配，请确认已加载对应视频或图片');
        }

        if (!this.labelType.includes(LabelType.POLYGON)) {
            return { imagesData: ImageDataUtil.arrange(cleanImageData, imageData.map(i => i.id)), labelNames: Object.values(labelNameMap) };
        }

        Object.entries(vgg).forEach(([filename, fileData]) => {
            const imgData = imageDataByName[filename];
            if (!imgData) return;

            Object.values(fileData.regions).forEach(region => {
                const label = region.region_attributes?.label;
                const labelId = labelNameMap[label]?.id;
                if (!labelId) return;

                const attrs = region.shape_attributes as VGGPolygon;
                if (attrs.name !== 'polygon') return;

                const xs = attrs.all_points_x;
                const ys = attrs.all_points_y;
                if (!xs?.length || xs.length !== ys.length) return;

                // VGG closes polygons by repeating first point — drop it
                const len = (xs[0] === xs[xs.length - 1] && ys[0] === ys[ys.length - 1])
                    ? xs.length - 1 : xs.length;

                const vertices: IPoint[] = [];
                for (let i = 0; i < len; i++) vertices.push({ x: xs[i], y: ys[i] });

                imgData.labelPolygons.push(LabelUtil.createLabelPolygon(labelId, vertices));
            });
        });

        return {
            imagesData: ImageDataUtil.arrange(cleanImageData, imageData.map(i => i.id)),
            labelNames: Object.values(labelNameMap)
        };
    }
}
