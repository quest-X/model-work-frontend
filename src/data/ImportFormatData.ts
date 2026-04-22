import {LabelType} from './enums/LabelType';
import {ILabelFormatData} from '../interfaces/ILabelFormatData';
import {AnnotationFormatType} from './enums/AnnotationFormatType';
import {Language, LanguageConfig} from './LanguageConfig';

export type ImportFormatDataMap = Record<LabelType, ILabelFormatData[]>

export const getImportFormatData = (language: Language): ImportFormatDataMap => {
    const texts = LanguageConfig[language];
    
    return {
        [LabelType.RECT]: [
            {
                type: AnnotationFormatType.COCO,
                label: texts.formats.import.cocoRect
            },
            {
                type: AnnotationFormatType.YOLO,
                label: texts.formats.import.yoloRect
            },
            {
                type: AnnotationFormatType.VOC,
                label: texts.formats.import.vocRect
            },
            {
                type: AnnotationFormatType.LABELME,
                label: texts.formats.import.labelmeRect
            }
        ],
        [LabelType.POINT]: [],
        [LabelType.LINE]: [],
        [LabelType.POLYGON]: [
            {
                type: AnnotationFormatType.COCO,
                label: texts.formats.import.cocoPolygon
            },
            {
                type: AnnotationFormatType.VGG,
                label: texts.formats.import.vggPolygon
            },
            {
                type: AnnotationFormatType.LABELME,
                label: texts.formats.import.labelmePolygon
            }
        ],
        [LabelType.IMAGE_RECOGNITION]: []
    };
};

// 保持向后兼容性，默认使用英文
export const ImportFormatData: ImportFormatDataMap = getImportFormatData(Language.ENGLISH);
