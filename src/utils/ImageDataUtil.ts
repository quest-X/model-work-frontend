import {ImageData, LabelLine, LabelPoint, LabelPolygon, LabelRect} from '../store/labels/types';
import { v4 as uuidv4 } from 'uuid';
import {FileUtil} from './FileUtil';
import {ImageRepository} from '../logic/imageRepository/ImageRepository';

export class ImageDataUtil {
    public static createImageDataFromFileData(fileData: File): ImageData {
        return {
            id: uuidv4(),
            fileData,
            loadStatus: false,
            labelRects: [],
            labelPoints: [],
            labelLines: [],
            labelPolygons: [],
            labelNameIds: [],
            isVisitedByRoboflowAPI: false
        }
    }

    public static cleanAnnotations(item: ImageData): ImageData {
        return {
            ...item,
            labelRects: [],
            labelPoints: [],
            labelLines: [],
            labelPolygons: [],
            labelNameIds: []
        }
    }

    public static arrange(items: ImageData[], idArrangement: string[]): ImageData[] {
        return items.sort((a: ImageData, b: ImageData) => {
            return idArrangement.indexOf(a.id) - idArrangement.indexOf(b.id)
        })
    }

    public static loadMissingImages(images: ImageData[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const missingImages = images.filter((i: ImageData) => !i.loadStatus);
            const missingImagesFiles = missingImages.map((i: ImageData) => i.fileData);
            FileUtil.loadImages(missingImagesFiles)
                .then((htmlImageElements:HTMLImageElement[]) => {
                    ImageRepository.storeImages(missingImages.map((i: ImageData) => i.id), htmlImageElements);
                    resolve()
                })
                .catch((error: Error) => reject(error));
        });
    }

    /**
     * Merge an incoming batch of ImageData into an existing list, deduplicating by
     * `fileData.name` (case-sensitive). When two images share a filename, the existing
     * id is preserved and incoming label arrays are concatenated onto the existing
     * arrays. All `labelId` values on incoming annotations are translated through
     * `idRemap` (used to map LabelName ids that were renumbered when label lists were
     * deduplicated). Inputs are never mutated.
     *
     * @returns merged   The combined ImageData list (existing in original order, then
     *                   any genuinely new incoming images in incoming order).
     * @returns mergedIds The final ImageData id for each incoming image, in incoming
     *                    order. For images that merged into an existing entry, this is
     *                    the existing id; for new images, this is the incoming id.
     */
    public static mergeImagesByName(
        existing: ImageData[],
        incoming: ImageData[],
        idRemap: Map<string, string>
    ): { merged: ImageData[]; mergedIds: string[] } {
        const remapLabelId = (labelId: string | null): string | null => {
            if (labelId === null) return null;
            return idRemap.get(labelId) ?? labelId;
        };
        const remapRect = (r: LabelRect): LabelRect => ({...r, labelId: remapLabelId(r.labelId)});
        const remapPoint = (p: LabelPoint): LabelPoint => ({...p, labelId: remapLabelId(p.labelId)});
        const remapLine = (l: LabelLine): LabelLine => ({...l, labelId: remapLabelId(l.labelId)});
        const remapPolygon = (p: LabelPolygon): LabelPolygon => ({...p, labelId: remapLabelId(p.labelId)});

        // Index existing by filename → position in working array
        const nameToIndex: Map<string, number> = new Map();
        const merged: ImageData[] = existing.slice();
        existing.forEach((img: ImageData, idx: number) => {
            nameToIndex.set(img.fileData.name, idx);
        });

        const mergedIds: string[] = [];

        for (const inc of incoming) {
            const fileName = inc.fileData.name;
            const existingIdx = nameToIndex.get(fileName);
            const remappedRects = inc.labelRects.map(remapRect);
            const remappedPoints = inc.labelPoints.map(remapPoint);
            const remappedLines = inc.labelLines.map(remapLine);
            const remappedPolygons = inc.labelPolygons.map(remapPolygon);

            if (existingIdx !== undefined) {
                const target = merged[existingIdx];
                merged[existingIdx] = {
                    ...target,
                    labelRects: [...target.labelRects, ...remappedRects],
                    labelPoints: [...target.labelPoints, ...remappedPoints],
                    labelLines: [...target.labelLines, ...remappedLines],
                    labelPolygons: [...target.labelPolygons, ...remappedPolygons]
                };
                mergedIds.push(target.id);
            } else {
                const newImage: ImageData = {
                    ...inc,
                    labelRects: remappedRects,
                    labelPoints: remappedPoints,
                    labelLines: remappedLines,
                    labelPolygons: remappedPolygons
                };
                nameToIndex.set(fileName, merged.length);
                merged.push(newImage);
                mergedIds.push(inc.id);
            }
        }

        return { merged, mergedIds };
    }
}
