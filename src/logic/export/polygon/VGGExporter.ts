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

export class VGGExporter {
    public static export(mode: ExportMode = 'simple'): void {
        const imagesData: ImageData[] = LabelsSelector.getImagesData();
        const labelNames: LabelName[] = LabelsSelector.getLabelNames();

        if (mode === 'complete') {
            const zip = new JSZip();
            const split = DatasetSplitUtil.split(imagesData);

            for (const [splitName, splitImages] of Object.entries(split)) {
                const vggObj = VGGExporter.mapImagesDataToVGGObject(splitImages, labelNames);
                zip.file(`${splitName}.json`, JSON.stringify(vggObj, null, 2));

                for (const imageData of splitImages) {
                    if (imageData.fileData) {
                        zip.file(`images/${splitName}/${imageData.fileData.name}`, imageData.fileData);
                    }
                }
            }

            zip.generateAsync({type:'blob'}).then((content: Blob) => {
                saveAs(content, `${ExporterUtil.getExportFileName('vgg_full')}.zip`);
            });
        } else {
            const content: string = JSON.stringify(VGGExporter.mapImagesDataToVGGObject(imagesData, labelNames));
            const fileName: string = `${ExporterUtil.getExportFileName('vgg_simple')}.json`;
            ExporterUtil.saveAs(content, fileName);
        }
    }

    private static mapImagesDataToVGGObject(imagesData: ImageData[], labelNames: LabelName[]): VGGObject {
        return imagesData.reduce((data: VGGObject, image: ImageData) => {
            const fileData: VGGFileData = VGGExporter.mapImageDataToVGGFileData(image, labelNames);
            if (!!fileData) {
                data[image.fileData.name] = fileData
            }
            return data;
        }, {});
    }

    private static mapImageDataToVGGFileData(imageData: ImageData, labelNames: LabelName[]): VGGFileData {
        const regionsData: VGGRegionsData = VGGExporter.mapImageDataToVGG(imageData, labelNames);
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

    public static mapImageDataToVGG(imageData: ImageData, labelNames: LabelName[]): VGGRegionsData {
        if (!imageData.loadStatus || !imageData.labelPolygons || !imageData.labelPolygons.length ||
            !labelNames || !labelNames.length) return null;

        const validLabels: LabelPolygon[] = VGGExporter.getValidPolygonLabels(imageData);

        if (!validLabels.length) return null;

        return validLabels.reduce((data: VGGRegionsData, label: LabelPolygon, index: number) => {
            const labelName: LabelName = findLast(labelNames, {id: label.labelId});
            if (!!labelName) {
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

    public static mapPolygonToVGG(path: IPoint[]): VGGPolygon {
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