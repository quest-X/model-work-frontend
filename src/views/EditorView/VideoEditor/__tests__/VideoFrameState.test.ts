import {createVideoFramePlaceholders, getPlaybackFrame} from '../VideoFrameState';
import {LabelUtil} from '../../../../utils/LabelUtil';

it('creates distinct unloaded frame records and only selects the first placeholder', () => {
    const file = new File(['video'], 'video.mp4');
    const frames = createVideoFramePlaceholders(file, 3);
    expect(new Set(frames.map(frame => frame.id)).size).toBe(3);
    expect(frames.every(frame => frame.fileData === file && !frame.loadStatus)).toBe(true);
    expect(frames.map(frame => !!frame.isSelected)).toEqual([true, false, false]);
    expect(createVideoFramePlaceholders(file, 0)).toEqual([]);
});

it('uses pending detection results only for an existing frame with no rectangles', () => {
    const frames = createVideoFramePlaceholders(new File(['video'], 'video.mp4'), 2);
    const rect = LabelUtil.createLabelRect(null, {x: 0, y: 0, width: 10, height: 10});
    const latest = [{...frames[0], labelRects: [rect]}, {...frames[1], labelRects: [rect]}];
    expect(getPlaybackFrame(frames, latest, 0)).toBe(latest[0]);
    frames[0].labelRects.push(rect);
    expect(getPlaybackFrame(frames, latest, 0)).toBe(frames[0]);
    expect(getPlaybackFrame([], latest, 0)).toBeNull();
    expect(getPlaybackFrame(frames, null, 1)).toBe(frames[1]);
});
