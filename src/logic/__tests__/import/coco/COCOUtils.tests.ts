import {COCOUtils} from "../../../import/coco/COCOUtils";
import {isEqual} from "lodash";
import {COCOImporter} from "../../../import/coco/COCOImporter";
import {COCOAnnotationDeserializationError, COCOAnnotationReadingError, COCOFormatValidationError} from "../../../import/coco/COCOErrors";
import {LabelType} from "../../../../data/enums/LabelType";

describe('COCOUtils bbox2rect method', () => {
    it('should return valid IRect', () => {
        // given
        const x = 10, y = 20, width= 30, height = 40;
        const bbox: [number, number, number, number] = [x, y, width, height]

        // when
        const result = COCOUtils.bbox2rect(bbox);

        // then
        const expectedResult = {
            x: x,
            y: y,
            width: width,
            height: height
        }
        expect(result).toEqual(expectedResult);
    });
});

describe('COCOUtils segmentation2vertices method', () => {
    it('should return valid array of polygon vertices', () => {
        // given
        const p1x = 10, p1y = 20, p2x = 30, p2y = 40, p3x = 50, p3y = 60;
        const segmentation: number[][] = [[p1x, p1y, p2x, p2y, p3x, p3y]];

        // when
        const result = COCOUtils.segmentation2vertices(segmentation);

        // then
        const expectedResult = [[
            {x: p1x, y: p1y},
            {x: p2x, y: p2y},
            {x: p3x, y: p3y}
        ]]
        expect(isEqual(result, expectedResult)).toBe(true);
    });
});

describe('COCO file reader failures', () => {
    afterEach(() => jest.restoreAllMocks());

    it('keeps successful reads, JSON errors and required-key validation', async () => {
        const read = (text: string) => new Promise((resolve, reject) => {
            new COCOImporter([LabelType.RECT]).import(
                [new File([text], 'annotations.json')],
                (imagesData, labelNames) => resolve({imagesData, labelNames}),
                reject,
            );
        });
        await expect(read('{"images":[],"annotations":[],"categories":[]}'))
            .resolves.toEqual({imagesData: [], labelNames: []});
        await expect(read('{')).rejects.toBeInstanceOf(COCOAnnotationDeserializationError);
        await expect(read('{}')).rejects.toBeInstanceOf(COCOFormatValidationError);
    });

    it('reports one reading error when an error event is followed by loadend', () => {
        const reader = new FileReader();
        jest.spyOn(window, 'FileReader').mockImplementation(() => reader);
        jest.spyOn(reader, 'readAsText').mockImplementation(() => undefined);
        const success = jest.fn();
        const failure = jest.fn();
        new COCOImporter([LabelType.RECT]).import([new File([''], 'annotations.json')], success, failure);

        reader.dispatchEvent(new ProgressEvent('error'));
        reader.dispatchEvent(new ProgressEvent('loadend'));

        expect(success).not.toHaveBeenCalled();
        expect(failure).toHaveBeenCalledTimes(1);
        expect(failure).toHaveBeenCalledWith(expect.any(COCOAnnotationReadingError));
    });
});
