import {ImageData} from '../../../store/labels/types';

export interface AnnotationProgress {
    /** 至少有一个标注（任意类型）的图片数。 */
    annotatedImages: number;
    totalImages: number;
    /** 所有图片里的形状标注总数（矩形/多边形/点/线）。 */
    totalShapes: number;
    /** 已指定标签的形状标注数。 */
    labeledShapes: number;
    /** 0–100，前半段看标注覆盖率，后半段看标签完成度。 */
    percent: number;
    /** 所有图片都有标注，且不存在未指定标签的标注。 */
    complete: boolean;
}

const shapeLists = (image: ImageData) => [
    image.labelRects,
    image.labelPoints,
    image.labelPolygons,
    image.labelLines,
];

export const computeAnnotationProgress = (imagesData: ImageData[]): AnnotationProgress => {
    let annotatedImages = 0;
    let totalShapes = 0;
    let labeledShapes = 0;

    imagesData.forEach(image => {
        let hasAnnotation = image.labelNameIds.length > 0;
        shapeLists(image).forEach(shapes => {
            if (shapes.length > 0) hasAnnotation = true;
            totalShapes += shapes.length;
            shapes.forEach(shape => {
                if (shape.labelId) labeledShapes += 1;
            });
        });
        if (hasAnnotation) annotatedImages += 1;
    });

    const totalImages = imagesData.length;
    const annotationRatio = totalImages > 0 ? annotatedImages / totalImages : 0;
    // 没有任何形状标注时（例如整图打标签），只要已开始标注就视为标签部分已完成。
    const labelRatio = totalShapes > 0
        ? labeledShapes / totalShapes
        : (annotatedImages > 0 ? 1 : 0);
    const percent = annotationRatio * 50 + labelRatio * 50;
    const complete = totalImages > 0
        && annotatedImages === totalImages
        && labeledShapes === totalShapes;

    return {annotatedImages, totalImages, totalShapes, labeledShapes, percent, complete};
};
