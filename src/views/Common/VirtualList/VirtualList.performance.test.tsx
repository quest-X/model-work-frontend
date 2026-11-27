import {VirtualList} from './VirtualList';
import {VirtualListUtil} from '../../../utils/VirtualListUtil';
import {RectUtil} from '../../../utils/RectUtil';

describe('VirtualList visible rows', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([0, 150, 151, 14999, 1000000])('preserves visible cells and positions at scroll offset %i', y => {
        const size = {width: 340, height: 600};
        const childSize = {width: 150, height: 150};
        const viewport = {x: 0, y: y - 200, width: size.width, height: size.height + 400};
        const anchors = VirtualListUtil.calculateAnchorPoints(size, childSize, 1000);
        const expected = anchors.flatMap((anchor, index) => RectUtil.intersect(viewport, {...anchor, ...childSize}) ? [index] : []);
        const childRender = jest.fn(index => index);
        const list = new VirtualList({size, childSize, childCount: 1000, overScanHeight: 200, childRender});
        list['calculate'](size, childSize, 1000);
        list.state = {viewportRect: {x: 0, y, ...size}, isScrolling: false};

        expect(list['getChildren']()).toEqual(expected);
        childRender.mock.calls.forEach(([index], call) => {
            expect((childRender.mock.calls[call] as unknown[])[3]).toMatchObject({left: anchors[index].x, top: anchors[index].y});
        });
    });

    it('keeps layout and render work bounded with 100,000 frames', () => {
        const size = {width: 340, height: 600};
        const childSize = {width: 150, height: 150};
        const anchors = jest.spyOn(VirtualListUtil, 'calculateAnchorPoints');
        const intersections = jest.spyOn(RectUtil, 'intersect');
        const list = new VirtualList({size, childSize, childCount: 100000, overScanHeight: 200, childRender: index => index});
        list['calculate'](size, childSize, 100000);
        list.state = {viewportRect: {x: 0, y: 750000, ...size}, isScrolling: false};

        expect(list['getChildren']().length).toBeGreaterThan(0);
        expect(anchors).not.toHaveBeenCalled();
        expect(intersections.mock.calls.length).toBeLessThanOrEqual(20);
    });
});
