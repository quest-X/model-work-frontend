import {LabelType} from '../enums/LabelType';
import {ProjectType} from '../enums/ProjectType';
import {Language, LanguageConfig} from '../LanguageConfig';

export interface ILabelToolkit {
    labelType: LabelType;
    headerText: string;
    imageSrc: string;
    imageAlt: string;
    projectType: ProjectType;
}

export const getLabelToolkitData = (language: Language): ILabelToolkit[] => {
    const texts = LanguageConfig[language];
    
    return [
        {
            labelType: LabelType.ALL,
            headerText: texts.labelTypes.all,
            imageSrc: 'ico/tags.png', // 临时使用tags图标
            imageAlt: 'all-labels',
            projectType: ProjectType.OBJECT_DETECTION,
        },
        {
            labelType: LabelType.IMAGE_RECOGNITION,
            headerText: texts.labelTypes.imageRecognition,
            imageSrc: 'ico/object.png',
            imageAlt: 'object',
            projectType: ProjectType.IMAGE_RECOGNITION,
        },
        {
            labelType: LabelType.RECT,
            headerText: texts.labelTypes.rect,
            imageSrc: 'ico/rectangle.png',
            imageAlt: 'rectangle',
            projectType: ProjectType.OBJECT_DETECTION,
        },
        {
            labelType: LabelType.POINT,
            headerText: texts.labelTypes.point,
            imageSrc: 'ico/point.png',
            imageAlt: 'point',
            projectType: ProjectType.OBJECT_DETECTION,
        },
        {
            labelType: LabelType.LINE,
            headerText: texts.labelTypes.line,
            imageSrc: 'ico/line.png',
            imageAlt: 'line',
            projectType: ProjectType.OBJECT_DETECTION,
        },
        {
            labelType: LabelType.POLYGON,
            headerText: texts.labelTypes.polygon,
            imageSrc: 'ico/polygon.png',
            imageAlt: 'polygon',
            projectType: ProjectType.OBJECT_DETECTION,
        },
    ];
};

// 保持向后兼容性，默认使用英文
export const LabelToolkitData: ILabelToolkit[] = getLabelToolkitData(Language.ENGLISH);