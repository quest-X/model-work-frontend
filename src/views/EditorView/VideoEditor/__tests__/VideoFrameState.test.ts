import {createVideoFramePlaceholders, getPlaybackFrame} from '../VideoFrameState';
import {LabelUtil} from '../../../../utils/LabelUtil';

it('creates distinct unloaded frame records without selecting an inference range', () => {
    const frames = createVideoFramePlaceholders(3);
    expect(new Set(frames.map(frame => frame.id)).size).toBe(3);
    expect(frames.every(frame => frame.fileData.size === 0 && !frame.loadStatus)).toBe(true);
    expect(frames.map(frame => frame.fileData.name)).toEqual(['frame_000000.jpg', 'frame_000001.jpg', 'frame_000002.jpg']);
    expect(frames.every(frame => !frame.isSelected)).toBe(true);
    expect(createVideoFramePlaceholders(0)).toEqual([]);
});

it('uses pending detection results only for an existing frame with no rectangles', () => {
    const frames = createVideoFramePlaceholders(2);
    const rect = LabelUtil.createLabelRect(null, {x: 0, y: 0, width: 10, height: 10});
    const latest = [{...frames[0], labelRects: [rect]}, {...frames[1], labelRects: [rect]}];
    expect(getPlaybackFrame(frames, latest, 0)).toBe(latest[0]);
    frames[0].labelRects.push(rect);
    expect(getPlaybackFrame(frames, latest, 0)).toBe(frames[0]);
    expect(getPlaybackFrame([], latest, 0)).toBeNull();
    expect(getPlaybackFrame(frames, null, 1)).toBe(frames[1]);
});
