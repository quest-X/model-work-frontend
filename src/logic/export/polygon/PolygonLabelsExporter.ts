import {AnnotationFormatType} from "../../../data/enums/AnnotationFormatType";
import {VGGExporter} from "./VGGExporter";
import {COCOExporter} from "./COCOExporter";
import {ExportMode} from '../../../views/PopupView/ExportLabelsPopup/ExportLabelPopup';

export class PolygonLabelsExporter {
    public static export(exportFormatType: AnnotationFormatType, mode: ExportMode = 'simple'): void {
        switch (exportFormatType) {
            case AnnotationFormatType.VGG:
                VGGExporter.export(mode);
                break;
            case AnnotationFormatType.COCO:
                COCOExporter.export(mode);
                break;
            default:
                return;
        }
    }
}
