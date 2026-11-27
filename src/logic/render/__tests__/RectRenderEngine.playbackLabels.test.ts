import {RectRenderEngine} from '../RectRenderEngine';
import {VideoSelector} from '../../../store/selectors/VideoSelector';
import {LabelsSelector} from '../../../store/selectors/LabelsSelector';
import {GeneralSelector} from '../../../store/selectors/GeneralSelector';
import {DrawUtil} from '../../../utils/DrawUtil';
import {LabelUtil} from '../../../utils/LabelUtil';
import {LabelStatus} from '../../../data/enums/LabelStatus';

jest.mock('../../../index', () => ({store: {getState: jest.fn(() => ({})), dispatch: jest.fn()}}));
afterEach(() => jest.restoreAllMocks());

it('paints accepted labels and confidence with the decoded frame and restores DOM labels on pause', () => {
    const playing = jest.spyOn(VideoSelector, 'isVideoPlaying').mockReturnValue(true);
    jest.spyOn(LabelsSelector, 'getLabelNameById').mockReturnValue({id: 'dog', name: 'Dog', color: '#fff'});
    jest.spyOn(GeneralSelector, 'getEnablePerClassColorationStatus').mockReturnValue(false);
    jest.spyOn(DrawUtil, 'drawRectWithFill').mockImplementation(() => undefined);
    const drawText = jest.spyOn(DrawUtil, 'drawText').mockImplementation(() => undefined);
    const engine = new RectRenderEngine(document.createElement('canvas'));
    const rect = {x: 1, y: 2, width: 10, height: 20};
    const label = {...LabelUtil.createLabelRect('dog', rect), status: LabelStatus.ACCEPTED, confidence: 0.85};
    engine['drawLabelText'](label, rect);
    expect(drawText).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 'Dog 85.0%', 12,
        expect.any(Object), '#000000', true, 'center');
    drawText.mockClear();
    playing.mockReturnValue(false);
    engine['drawLabelText'](label, rect);
    expect(drawText).not.toHaveBeenCalled();
});
