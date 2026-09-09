import {getFrameAvailability} from '../FramePlayer';

it('reports the first cache gap and required buffer without exceeding the end of the video', () => {
    const image = new Image();
    const cache = new Map([[2, image], [3, image], [5, image]]);
    expect(getFrameAvailability(cache, 2, 10, 8, 4)).toEqual({target: 4, backgroundLoad: {ahead: 2, min: 4}});
    cache.set(4, image);
    expect(getFrameAvailability(cache, 2, 6, 8, 4)).toEqual({target: -1, backgroundLoad: null});
    expect(getFrameAvailability(cache, 5, 6, 8, 4)).toEqual({target: -1, backgroundLoad: null});
    expect(getFrameAvailability(cache, -1, 6, 8, 4)).toEqual({target: 0, backgroundLoad: {ahead: 0, min: 4}});
});
