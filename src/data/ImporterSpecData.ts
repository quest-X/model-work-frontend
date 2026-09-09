import {AnnotationFormatType} from './enums/AnnotationFormatType';
import {AnnotationImporter} from '../logic/import/AnnotationImporter';
import {LabelType} from './enums/LabelType';
import {COCOImporter} from '../logic/import/coco/COCOImporter';
import {YOLOImporter} from '../logic/import/yolo/YOLOImporter';
import {VOCImporter} from '../logic/import/voc/VOCImporter';
import {VGGImporter} from '../logic/import/vgg/VGGImporter';
import {LabelMeImporter} from '../logic/import/labelme/LabelMeImporter';

export type ImporterSpecDataMap = Record<AnnotationFormatType, new (labelType: LabelType[]) => AnnotationImporter>;


export const ImporterSpecData: ImporterSpecDataMap = {
    [AnnotationFormatType.COCO]: COCOImporter,
    [AnnotationFormatType.CSV]: undefined,
    [AnnotationFormatType.JSON]: undefined,
    [AnnotationFormatType.VGG]: VGGImporter,
    [AnnotationFormatType.VOC]: VOCImporter,
    [AnnotationFormatType.YOLO]: YOLOImporter,
    [AnnotationFormatType.LABELME]: LabelMeImporter
}
