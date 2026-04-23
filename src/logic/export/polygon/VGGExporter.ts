import {ImageData, LabelName, LabelPolygon} from "../../../store/labels/types";
import {VGGFileData, VGGObject, VGGPolygon, VGGRegionsData} from "../../../data/labels/VGG";
import {findLast} from "lodash";
import {IPoint} from "../../../interfaces/IPoint";
import {LabelsSelector} from "../../../store/selectors/LabelsSelector";
import {ExporterUtil} from "../../../utils/ExporterUtil";
import JSZip from 'jszip';
import {saveAs} from 'file-saver';
import {DatasetSplitUtil} from '../../../utils/DatasetSplitUtil';
import {ExportMode} from '../../../views/PopupView/ExportLabelsPopup/ExportLabelPopup';
import {VideoSelector} from '../../../store/selectors/VideoSelector';
import {FrameExtractorService} from '../../../services/FrameExtractorService';

export class VGGExporter {
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

        if (mode === 'complete') {
            const zip = new JSZip();
            const split = DatasetSplitUtil.split(imagesData);
            const sessionId = VideoSelector.getActiveVideo()?.sessionId;

            for (const [splitName, splitImages] of Object.entries(split)) {
                const vggObj = VGGExporter.mapImagesDataToVGGObject(splitImages, labelNames);
                zip.file(`${splitName}.json`, JSON.stringify(vggObj, null, 2));

                for (const imageData of splitImages) {
                    if (imageData.fileData) {
                        const file = await VGGExporter.resolveFileData(imageData, sessionId);
                        zip.file(`images/${splitName}/${file.name}`, file);
                    }
                }
            }

            const content = await zip.generateAsync({type:'blob'});
            saveAs(content, `${ExporterUtil.getExportFileName('vgg_full')}.zip`);
        } else {
            const content: string = JSON.stringify(VGGExporter.mapImagesDataToVGGObject(imagesData, labelNames));
            const fileName: string = `${ExporterUtil.getExportFileName('vgg_simple')}.json`;
            ExporterUtil.saveAs(content, fileName);
        }
    }

    private static mapImagesDataToVGGObject(imagesData: ImageData[], labelNames: LabelName[]): VGGObject {
        return imagesData.reduce((data: VGGObject, image: ImageData) => {
            const fileData: VGGFileData | null = VGGExporter.mapImageDataToVGGFileData(image, labelNames);
            if (fileData) {
                data[image.fileData.name] = fileData
            }
            return data;
        }, {});
    }

    private static mapImageDataToVGGFileData(imageData: ImageData, labelNames: LabelName[]): VGGFileData | null {
        const regionsData: VGGRegionsData | null = VGGExporter.mapImageDataToVGG(imageData, labelNames);
        if (!regionsData) return null;
        return {
            fileref: "",
            size: imageData.fileData.size,
            filename: imageData.fileData.name,
            base64_img_data: "",
            file_attributes: {},
            regions: regionsData
        }
    }

    public static mapImageDataToVGG(imageData: ImageData, labelNames: LabelName[]): VGGRegionsData | null {
        if (!imageData.loadStatus || !imageData.labelPolygons || !imageData.labelPolygons.length ||
            !labelNames || !labelNames.length) return null;

        const validLabels: LabelPolygon[] = VGGExporter.getValidPolygonLabels(imageData);

        if (!validLabels.length) return null;

        return validLabels.reduce((data: VGGRegionsData, label: LabelPolygon, index: number) => {
            const labelName: LabelName = findLast(labelNames, {id: label.labelId});
            if (labelName) {
                data[index.toString()] = {
                    shape_attributes: VGGExporter.mapPolygonToVGG(label.vertices),
                    region_attributes: {
                        label: labelName.name
                    }
                };
            }
            return data;
        }, {})
    }

    public static getValidPolygonLabels(imageData: ImageData): LabelPolygon[] {
        return imageData.labelPolygons.filter((label: LabelPolygon) =>
            label.labelId !== null && !!label.vertices.length);
    }

    public static mapPolygonToVGG(path: IPoint[]): VGGPolygon | null {
        if (!path || !path.length) return null;

        const all_points_x: number[] = path.map((point: IPoint) => point.x).concat(path[0].x);
        const all_points_y: number[] = path.map((point: IPoint) => point.y).concat(path[0].y);
        return {
            name: "polygon",
            all_points_x,
            all_points_y
        }
    }
}