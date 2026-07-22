import {VirtualListUtil} from '../VirtualListUtil';

describe('VirtualListUtil', () => {
    it('keeps finite layout values when the viewport is narrower than one child', () => {
        const listSize = {width: 0, height: 600};
        const childSize = {width: 150, height: 150};
        const grid = VirtualListUtil.calculateGridSize(listSize, childSize, 12);
        const content = VirtualListUtil.calculateContentSize(listSize, childSize, grid);
        const anchors = VirtualListUtil.calculateAnchorPoints(listSize, childSize, 12);

        expect(grid).toEqual({width: 1, height: 12});
        expect(Number.isFinite(content.height)).toBe(true);
        expect(anchors.every(anchor => Number.isFinite(anchor.x) && Number.isFinite(anchor.y))).toBe(true);
    });
});
