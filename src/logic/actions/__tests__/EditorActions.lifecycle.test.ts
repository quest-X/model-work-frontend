import {EditorActions} from '../EditorActions';
import {EditorModel} from '../../../staticModels/EditorModel';
import {DrawUtil} from '../../../utils/DrawUtil';
import {EditorData} from '../../../data/EditorData';

jest.mock('../../../index', () => ({store: {getState: jest.fn(() => ({})), dispatch: jest.fn()}}));

afterEach(() => {
    jest.restoreAllMocks();
    EditorModel.canvas = null;
    EditorModel.primaryRenderingEngine = null;
    EditorModel.supportRenderingEngine = null;
});

it.each(['canvas', 'engine'])('ignores a late render when the %s is unmounted', missing => {
    const render = jest.fn();
    EditorModel.canvas = missing === 'canvas' ? null : document.createElement('canvas');
    EditorModel.primaryRenderingEngine = missing === 'engine'
        ? null : {render} as unknown as typeof EditorModel.primaryRenderingEngine;
    const getData = jest.spyOn(EditorActions, 'getEditorData');
    expect(() => EditorActions.fullRender()).not.toThrow();
    expect(getData).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
});

it('still renders annotations and geometry when the canvas is mounted', () => {
    EditorModel.canvas = document.createElement('canvas');
    const primary = jest.fn();
    const support = jest.fn();
    EditorModel.primaryRenderingEngine = {render: primary} as unknown as typeof EditorModel.primaryRenderingEngine;
    EditorModel.supportRenderingEngine = {render: support} as unknown as typeof EditorModel.supportRenderingEngine;
    const data = {
        viewPortContentImageRect: {x: 0, y: 0, width: 100, height: 100},
        realImageSize: {width: 100, height: 100},
    } as EditorData;
    jest.spyOn(EditorActions, 'getEditorData').mockReturnValue(data);
    jest.spyOn(DrawUtil, 'clearCanvas').mockImplementation(() => undefined);
    EditorActions.fullRender();
    expect(EditorModel.canvas.dataset.annotationGeometry).toBe(JSON.stringify({
        imageRect: data.viewPortContentImageRect, imageSize: data.realImageSize,
    }));
    expect(primary).toHaveBeenCalledWith(data);
    expect(support).toHaveBeenCalledWith(data);
});
