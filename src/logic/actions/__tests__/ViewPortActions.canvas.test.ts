import {ViewPortActions} from '../ViewPortActions';
import {EditorModel} from '../../../staticModels/EditorModel';

jest.mock('../../../index', () => ({store: {getState: jest.fn(() => ({})), dispatch: jest.fn()}}));

afterEach(() => { jest.restoreAllMocks(); EditorModel.canvas = null; });

it('preserves the canvas buffer when playback requests the same dimensions', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    EditorModel.canvas = canvas;
    const width = jest.spyOn(canvas, 'width', 'set');
    const height = jest.spyOn(canvas, 'height', 'set');
    for (let frame = 0; frame < 60; frame++) ViewPortActions.resizeCanvas({width: 1920.5, height: 1080.5});
    expect(width).not.toHaveBeenCalled();
    expect(height).not.toHaveBeenCalled();
    ViewPortActions.resizeCanvas({width: 960, height: 1080});
    expect(width).toHaveBeenCalledTimes(1);
    expect(height).not.toHaveBeenCalled();
});
