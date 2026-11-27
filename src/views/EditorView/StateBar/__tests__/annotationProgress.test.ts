import {ImageData, LabelRect} from '../../../../store/labels/types';
import {computeAnnotationProgress} from '../annotationProgress';

const rect = (id: string, labelId: string | null): LabelRect => ({
    id,
    labelId,
    isVisible: true,
    rect: {x: 0, y: 0, width: 10, height: 10},
    isCreatedByAI: false,
    status: 'ACCEPTED' as LabelRect['status'],
    suggestedLabel: '',
});

const image = (partial: Partial<ImageData> = {}): ImageData => ({
    id: partial.id || 'image',
    fileData: null as unknown as File,
    loadStatus: true,
    labelRects: [],
    labelPoints: [],
    labelLines: [],
    labelPolygons: [],
    labelNameIds: [],
    isVisitedByRoboflowAPI: false,
    ...partial,
});

describe('computeAnnotationProgress', () => {
    it('reports zero for an empty project', () => {
        expect(computeAnnotationProgress([])).toMatchObject({
            annotatedImages: 0, totalImages: 0, totalShapes: 0, labeledShapes: 0,
            percent: 0, complete: false,
        });
    });

    it('fills the first half when images have unlabeled annotations', () => {
        const images = [image({labelRects: [rect('r1', null)]})];
        expect(computeAnnotationProgress(images)).toMatchObject({
            annotatedImages: 1, totalImages: 1, totalShapes: 1, labeledShapes: 0,
            percent: 50, complete: false,
        });
    });

    it('reaches 100% and complete when every annotation has a label', () => {
        const images = [
            image({labelRects: [rect('r1', 'label-a')]}),
            image({labelRects: [rect('r2', 'label-b'), rect('r3', 'label-a')]}),
        ];
        expect(computeAnnotationProgress(images)).toMatchObject({
            percent: 100, complete: true,
        });
    });

    it('spreads the second half across labeled shapes', () => {
        const images = [image({labelRects: [rect('r1', 'label-a'), rect('r2', null)]})];
        expect(computeAnnotationProgress(images)).toMatchObject({
            percent: 75, complete: false,
        });
    });

    it('does not complete while some images are unannotated', () => {
        const images = [
            image({labelRects: [rect('r1', 'label-a')]}),
            image(),
        ];
        expect(computeAnnotationProgress(images)).toMatchObject({
            annotatedImages: 1, totalImages: 2, percent: 75, complete: false,
        });
    });

    it('treats image-level tags as annotations and labels', () => {
        const images = [
            image({labelNameIds: ['tag-a']}),
            image({labelNameIds: ['tag-b']}),
        ];
        expect(computeAnnotationProgress(images)).toMatchObject({
            annotatedImages: 2, totalShapes: 0, labeledShapes: 0,
            percent: 100, complete: true,
        });
    });

    it('counts polygons, points and lines as shapes', () => {
        const images = [image({
            labelRects: [rect('r1', 'label-a')],
            labelPolygons: [{
                id: 'p1', labelId: null, isVisible: true, vertices: [],
                isCreatedByAI: false, status: 'ACCEPTED' as never, suggestedLabel: '',
            }],
            labelPoints: [{
                id: 'pt1', labelId: 'label-a', isVisible: true, point: {x: 0, y: 0},
                isCreatedByAI: false, status: 'ACCEPTED' as never, suggestedLabel: '',
            }],
            labelLines: [{
                id: 'l1', labelId: null, isVisible: true, line: {start: {x: 0, y: 0}, end: {x: 1, y: 1}},
                isCreatedByAI: false, status: 'ACCEPTED' as never, suggestedLabel: '',
            }],
        })];
        expect(computeAnnotationProgress(images)).toMatchObject({
            totalShapes: 4, labeledShapes: 2, percent: 75, complete: false,
        });
    });
});
