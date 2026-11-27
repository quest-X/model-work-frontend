import {labelsReducer} from '../reducer';
import {selectAllImages, selectImageRange, updateActiveImageIndex} from '../actionCreators';
import {ImageDataUtil} from '../../../utils/ImageDataUtil';

const stateWithSelection = () => ({
    ...labelsReducer(undefined, selectAllImages(false)),
    imagesData: Array.from({length: 4}, (_, index) => ({
        ...ImageDataUtil.createImageDataFromFileData(new File([], `${index}.jpg`)),
        isSelected: index === 1,
    })),
});

describe('annotation selection identity', () => {
    it('preserves the state for an unchanged selection or active frame', () => {
        const state = stateWithSelection();
        expect(labelsReducer(state, selectImageRange(1, 1))).toBe(state);
        expect(labelsReducer(state, updateActiveImageIndex(state.activeImageIndex))).toBe(state);
        const all = labelsReducer(state, selectAllImages(true));
        expect(labelsReducer(all, selectAllImages(true))).toBe(all);
    });

    it('only replaces frames whose selection changes, preserving annotation arrays', () => {
        const state = stateWithSelection();
        const next = labelsReducer(state, selectImageRange(2, 1));
        expect(next.imagesData.map(image => image.isSelected)).toEqual([false, true, true, false]);
        [0, 1, 3].forEach(index => expect(next.imagesData[index]).toBe(state.imagesData[index]));
        expect(next.imagesData[2].labelRects).toBe(state.imagesData[2].labelRects);
        const cleared = labelsReducer(next, selectAllImages(false));
        expect(cleared.imagesData[0]).toBe(next.imagesData[0]);
        expect(cleared.imagesData.every(image => !image.isSelected)).toBe(true);
    });
});
