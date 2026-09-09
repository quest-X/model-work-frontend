import {EditorData} from '../../../data/EditorData';
import {ImageData} from '../../../store/labels/types';
import {LabelStatus} from '../../../data/enums/LabelStatus';
import {LabelType} from '../../../data/enums/LabelType';
import {EditorModel} from '../../../staticModels/EditorModel';
import {RenderEngineUtil} from '../../../utils/RenderEngineUtil';
import {DrawUtil} from '../../../utils/DrawUtil';
import {GeneralSelector} from '../../../store/selectors/GeneralSelector';
import {LabelsSelector} from '../../../store/selectors/LabelsSelector';
import {AllLabelsRenderEngine} from '../AllLabelsRenderEngine';
import {OverlayRenderEngine} from '../OverlayRenderEngine';
import {RectRenderEngine} from '../RectRenderEngine';
import {PolygonRenderEngine} from '../PolygonRenderEngine';
import {SmartAnnotationActions} from '../../actions/SmartAnnotationActions';

const data: EditorData = {
    viewPortContentSize: {width: 100, height: 100}, viewPortSize: {width: 100, height: 100},
    realImageSize: {width: 100, height: 100}, defaultRenderImageRect: {x: 0, y: 0, width: 100, height: 100},
    viewPortContentImageRect: {x: 0, y: 0, width: 100, height: 100},
    absoluteViewPortContentScrollPosition: {x: 0, y: 0}, mousePositionOnViewPortContent: null,
    activeKeyCombo: [], zoom: 1,
};
const image: ImageData = {
    id: 'image-1', fileData: new File(['image'], 'image.png'), loadStatus: true,
    labelPoints: [], labelLines: [], labelRects: [], labelPolygons: [], labelNameIds: [],
    isVisitedByRoboflowAPI: false,
};

afterEach(() => {
    jest.restoreAllMocks();
    EditorModel.playbackImageData = null;
});

it('preserves dashed and per-arrow colors while rejecting malformed overlay geometry', () => {
    EditorModel.playbackImageData = {...image, labelPolygons: [{
        id: 'overlay', labelId: null, isVisible: true, isCreatedByAI: true,
        status: LabelStatus.ACCEPTED, suggestedLabel: '', vertices: [], extra: {overlays: [
            {type: 'hline', y: 4, color: '#red', dashed: true},
            {type: 'point', x: NaN, y: 1},
            {type: 'arrows', points: [[1, 1, 10, 0, '#blue'], [1]]},
            {type: 'text', x: 5, y: 6, text: 'label', anchor: 'invalid'},
        ]},
    }]};
    jest.spyOn(RenderEngineUtil, 'transferPointFromImageToViewPortContent').mockImplementation(point => point);
    const dashed = jest.spyOn(DrawUtil, 'drawDashedLine').mockImplementation(() => undefined);
    const line = jest.spyOn(DrawUtil, 'drawLine').mockImplementation(() => undefined);
    const point = jest.spyOn(DrawUtil, 'drawCircleWithFill').mockImplementation(() => undefined);
    const text = jest.spyOn(DrawUtil, 'drawText').mockImplementation(() => undefined);
    const canvas = document.createElement('canvas');
    new OverlayRenderEngine(canvas).render(data);
    expect(dashed).toHaveBeenCalledWith(canvas, {x: 0, y: 4}, {x: 100, y: 4}, '#red', 1.5);
    expect(line).toHaveBeenCalledTimes(3);
    expect(line).toHaveBeenCalledWith(canvas, {x: 1, y: 1}, {x: 11, y: 1}, '#blue', 1.5);
    expect(point).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledWith(canvas, 'label', 14, {x: 5, y: 6}, '#00d96a', false, 'left');
});

it('preserves label filtering, smart-mode drawing and drag-only fine erasing', () => {
    EditorModel.playbackImageData = image;
    const smart = jest.spyOn(GeneralSelector, 'getSmartAnnotationActiveStatus').mockReturnValue(false);
    jest.spyOn(GeneralSelector, 'getTrackingMode').mockReturnValue(false);
    const eraser = jest.spyOn(GeneralSelector, 'getEraserMode').mockReturnValue(false);
    jest.spyOn(GeneralSelector, 'getEraserFineMode').mockReturnValue(true);
    jest.spyOn(LabelsSelector, 'getActiveLabelViewType').mockReturnValue(LabelType.RECT);
    const rect = jest.spyOn(RectRenderEngine.prototype, 'drawExistingRects').mockImplementation(() => undefined);
    const smartRect = jest.spyOn(RectRenderEngine.prototype, 'render').mockImplementation(() => undefined);
    const polygon = jest.spyOn(PolygonRenderEngine.prototype, 'drawExistingLabels').mockImplementation(() => undefined);
    const erase = jest.spyOn(PolygonRenderEngine.prototype, 'eraseVerticesNearPointAll').mockImplementation(() => undefined);
    const engine = new AllLabelsRenderEngine(document.createElement('canvas'));
    engine.render(data);
    expect(rect).toHaveBeenCalledTimes(1);
    expect(polygon).not.toHaveBeenCalled();
    smart.mockReturnValue(true);
    engine.render(data);
    expect(smartRect).toHaveBeenCalledTimes(1);
    expect(polygon).toHaveBeenCalledTimes(1);
    smart.mockReturnValue(false);
    eraser.mockReturnValue(true);
    engine.update({...data, event: new MouseEvent('mousemove')});
    expect(erase).not.toHaveBeenCalled();
    engine.update({...data, event: new MouseEvent('mousedown', {button: 0})});
    engine.update({...data, event: new MouseEvent('mousemove')});
    engine.update({...data, event: new MouseEvent('mouseup')});
    engine.update({...data, event: new MouseEvent('mousemove')});
    expect(erase).toHaveBeenCalledTimes(2);
});


it('preserves the smart prompt click tolerance and ignores non-left clicks', () => {
    jest.spyOn(GeneralSelector, 'getImageDragModeStatus').mockReturnValue(false);
    jest.spyOn(GeneralSelector, 'getSmartAnnotationActiveStatus').mockReturnValue(true);
    jest.spyOn(GeneralSelector, 'getSamNegativeMode').mockReturnValue(true);
    jest.spyOn(LabelsSelector, 'getActiveImageData').mockReturnValue({...image, labelRects: []});
    jest.spyOn(LabelsSelector, 'getActiveRectLabel').mockReturnValue(null);
    jest.spyOn(RenderEngineUtil, 'isMouseOverImage').mockReturnValue(true);
    jest.spyOn(RenderEngineUtil, 'isMouseOverCanvas').mockReturnValue(true);
    jest.spyOn(RenderEngineUtil, 'transferPointFromViewPortContentToImage').mockImplementation(point => point);
    const point = jest.spyOn(SmartAnnotationActions, 'addPoint').mockImplementation(() => undefined);
    const bbox = jest.spyOn(SmartAnnotationActions, 'addBbox').mockImplementation(() => undefined);
    const engine = new RectRenderEngine(document.createElement('canvas'));
    const start = {...data, mousePositionOnViewPortContent: {x: 10, y: 10}};
    engine.mouseDownHandler({...start, event: new MouseEvent('mousedown', {button: 2})});
    engine.mouseUpHandler(start);
    expect(point).not.toHaveBeenCalled();
    engine.mouseDownHandler({...start, event: new MouseEvent('mousedown', {button: 0})});
    engine.mouseUpHandler({...start, mousePositionOnViewPortContent: {x: 13, y: 10}});
    expect(point).toHaveBeenCalledWith({x: 10, y: 10}, true);
    engine.mouseDownHandler({...start, event: new MouseEvent('mousedown', {button: 0})});
    engine.mouseUpHandler({...start, mousePositionOnViewPortContent: {x: 20, y: 30}});
    expect(bbox).toHaveBeenCalledWith({x: 10, y: 10, width: 10, height: 20});
    expect(engine.isInProgress()).toBe(false);
});
