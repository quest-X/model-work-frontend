import {ILabelFormatData} from '../interfaces/ILabelFormatData';
import {LabelType} from './enums/LabelType';
import {AnnotationFormatType} from './enums/AnnotationFormatType';
import {Language, LanguageConfig} from './LanguageConfig';

export type ExportFormatDataMap = Record<LabelType, ILabelFormatData[]>;

export const getExportFormatData = (language: Language): ExportFormatDataMap => {
    const texts = LanguageConfig[language];
    
    return {
        [LabelType.RECT]: [
            {
                type: AnnotationFormatType.YOLO,
                label: texts.formats.export.yoloRect
            },
            {
                type: AnnotationFormatType.VOC,
                label: texts.formats.export.vocRect
            },
            {
                type: AnnotationFormatType.CSV,
                label: texts.formats.export.csvGeneric
            }
        ],
        [LabelType.POINT]: [
            {
                type: AnnotationFormatType.CSV,
                label: texts.formats.export.csvGeneric
            }
        ],
        [LabelType.LINE]: [
            {
                type: AnnotationFormatType.CSV,
                label: texts.formats.export.csvGeneric
            }
        ],
        [LabelType.POLYGON]: [
            {
                type: AnnotationFormatType.VGG,
                label: texts.formats.export.vggPolygon
            },
            {
                type: AnnotationFormatType.COCO,
                label: texts.formats.export.cocoPolygon
            }
        ],
        [LabelType.IMAGE_RECOGNITION]: [
            {
                type: AnnotationFormatType.CSV,
                label: texts.formats.export.csvGeneric
            },
            {
                type: AnnotationFormatType.JSON,
                label: texts.formats.export.jsonImageRecognition
            }
        ]
    };
};

// 保持向后兼容性，默认使用英文
export const ExportFormatData: ExportFormatDataMap = getExportFormatData(Language.ENGLISH);
