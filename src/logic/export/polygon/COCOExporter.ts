import {ImageData, LabelName, LabelPolygon} from "../../../store/labels/types";
import {LabelsSelector} from "../../../store/selectors/LabelsSelector";
import {GeneralSelector} from "../../../store/selectors/GeneralSelector";
import {ImageRepository} from "../../imageRepository/ImageRepository";
import {ExporterUtil} from "../../../utils/ExporterUtil";
import {
    COCOAnnotation, COCOBBox,
    COCOCategory,
    COCOImage,
    COCOInfo,
    COCOObject,
    COCOSegmentation
} from "../../../data/labels/COCO";
import {flatten} from "lodash";
import {IPoint} from "../../../interfaces/IPoint";
import JSZip from 'jszip';
import {saveAs} from 'file-saver';
import {DatasetSplitUtil} from '../../../utils/DatasetSplitUtil';
import {ExportMode} from '../../../views/PopupView/ExportLabelsPopup/ExportLabelPopup';
import {VideoSelector} from '../../../store/selectors/VideoSelector';
import {FrameExtractorService} from '../../../services/FrameExtractorService';

export type LabelDataMap = { [key: string]: number; }

export class COCOExporter {
    private static async resolveFileData(imageData: ImageData, sessionId?: string): Promise<File> {
        if (!imageData.fileData || imageData.fileData.size > 0 || !sessionId) {
            return imageData.fileData;
        }
        const match = imageData.fileData.name.match(/(\d+)\.jpg$/);
        const frameIdx = match ? parseInt(match[1], 10) : 0;
        const frames = await FrameExtractorService.fetchFrameRange(sessionId, frameIdx, 1);
        return frames[0] ?? imageData.fileData;
    }

    public static async export(mode: ExportMode = 'simple'): Promise<void> {
        const imagesData: ImageData[] = LabelsSelector.getImagesData();
        const labelNames: LabelName[] = LabelsSelector.getLabelNames();
        const projectName: string = GeneralSelector.getProjectName();

        if (mode === 'complete') {
            const zip = new JSZip();
            const split = DatasetSplitUtil.split(imagesData);
            const sessionId = VideoSelector.getActiveVideo()?.sessionId;

            for (const [splitName, splitImages] of Object.entries(split)) {
                const cocoObj = COCOExporter.mapImagesDataToCOCOObject(splitImages, labelNames, projectName);
                zip.file(`${splitName}.json`, JSON.stringify(cocoObj, null, 2));

                for (const imageData of splitImages) {
                    if (imageData.fileData) {
                        const file = await COCOExporter.resolveFileData(imageData, sessionId);
                        zip.file(`images/${splitName}/${file.name}`, file);
                    }
                }
            }

            const content = await zip.generateAsync({type:'blob'});
            saveAs(content, `${ExporterUtil.getExportFileName('coco_full')}.zip`);
        } else {
            const COCOObj = COCOExporter.mapImagesDataToCOCOObject(imagesData, labelNames, projectName);
            const content: string = JSON.stringify(COCOObj);
            const fileName: string = `${ExporterUtil.getExportFileName('coco_simple')}.json`;
            ExporterUtil.saveAs(content, fileName);
        }
    }

    private static mapImagesDataToCOCOObject(
        imagesData: ImageData[],
        labelNames: LabelName[],
        projectName: string
    ): COCOObject {
        const annotatedImages = imagesData
            .filter(d => d.loadStatus && d.labelPolygons.length !== 0);
        return {
            "info": COCOExporter.getInfoComponent(projectName),
            "images": COCOExporter.getImagesComponent(annotatedImages),
            "annotations": COCOExporter.getAnnotationsComponent(annotatedImages, labelNames),
            "categories": COCOExporter.getCategoriesComponent(labelNames)
        }
    }

    public static getInfoComponent(description: string): COCOInfo {
        return {
            "description": description
        }
    }

    public static getCategoriesComponent(labelNames: LabelName[]): COCOCategory[] {
        return labelNames.map((labelName: LabelName, index: number) => {
            return {
                "id": index + 1,
                "name": labelName.name
            }
        })
    }

    public static getImagesComponent(imagesData: ImageData[]): COCOImage[] {
        return imagesData
            .map((imageData: ImageData, index: number) => {
                const image: HTMLImageElement = ImageRepository.getById(imageData.id);
                if (!image) return null;
                return {
                    "id": index + 1,
                    "width": image.width,
                    "height": image.height,
                    "file_name": imageData.fileData.name
                }
            })
            .filter((img): img is COCOImage => img !== null)
    }

    public static getAnnotationsComponent(imagesData: ImageData[], labelNames: LabelName[]): COCOAnnotation[] {
        const labelsMap: LabelDataMap = COCOExporter.mapLabelsData(labelNames);
        let id = 0;
        return imagesData.flatMap((imageData: ImageData, index: number) =>
            imageData.labelPolygons
                .filter((labelPolygon: LabelPolygon) => labelPolygon.labelId !== null)
                .map((labelPolygon: LabelPolygon) => ({
                    "id": id++,
                    "iscrowd": 0,
                    "image_id": index + 1,
                    "category_id": labelsMap[labelPolygon.labelId],
                    "segmentation": COCOExporter.getCOCOSegmentation(labelPolygon.vertices),
                    "bbox": COCOExporter.getCOCOBbox(labelPolygon.vertices),
                    "area": COCOExporter.getCOCOArea(labelPolygon.vertices)
                }))
        );
    }

    public static mapLabelsData(labelNames: LabelName[]): LabelDataMap {
        return labelNames.reduce((data: LabelDataMap, label: LabelName, index: number) => {
            data[label.id] = index + 1;
            return data;
        }, {})
    }

    public static getCOCOSegmentation(vertices: IPoint[]): COCOSegmentation {
        const points: number[][] = vertices.map((point: IPoint) => [point.x, point.y]);
        return [flatten(points)];
    }

    public static getCOCOBbox(vertices: IPoint[]): COCOBBox {
        if (vertices.length === 0) return [0, 0, 0, 0];
        let xMin: number = vertices[0].x;
        let xMax: number = vertices[0].x;
        let yMin: number = vertices[0].y;
        let yMax: number = vertices[0].y;
        for (const vertex of vertices){
            if (xMin > vertex.x) xMin = vertex.x;
            if (xMax < vertex.x) xMax = vertex.x;
            if (yMin > vertex.y) yMin = vertex.y;
            if (yMax < vertex.y) yMax = vertex.y;
        }
        return [xMin, yMin, xMax - xMin, yMax - yMin];
    }

    public static getCOCOArea(vertices: IPoint[]): number {
        if (vertices.length === 0) return 0;
        let area = 0;
        let j = vertices.length - 1;
        for (let  i = 0; i < vertices.length; i++) {
            area += (vertices[j].x + vertices[i].x) * (vertices[j].y - vertices[i].y);
            j = i;
        }
        return Math.abs(area/2);
    }
}