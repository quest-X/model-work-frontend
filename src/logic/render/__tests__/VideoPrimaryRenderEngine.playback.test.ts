import {VideoPrimaryRenderEngine} from '../VideoPrimaryRenderEngine';
import {VideoSelector} from '../../../store/selectors/VideoSelector';
import {EditorModel} from '../../../staticModels/EditorModel';
import {ViewPortActions} from '../../actions/ViewPortActions';

jest.mock('../../../index', () => ({store: {getState: jest.fn(() => ({})), dispatch: jest.fn()}}));

jest.mock('../../../store/selectors/VideoSelector', () => ({VideoSelector: {isVideoPlaying: jest.fn()}}));

afterEach(() => { jest.restoreAllMocks(); EditorModel.videoElement = null; EditorModel.videoFrameImage = null; EditorModel.videoFrameCanvas = null; });

it('renders the current native video during playback and the editable image while paused', () => {
    const canvas = document.createElement('canvas');
    const drawImage = jest.fn();
    jest.spyOn(canvas, 'getContext').mockReturnValue({drawImage} as unknown as CanvasRenderingContext2D);
    const video = document.createElement('video');
    Object.defineProperties(video, {paused: {value: false}, readyState: {value: 4}});
    EditorModel.videoElement = video;
    EditorModel.videoFrameImage = new Image();
    const image = new Image();
    const rect = {x: 3, y: 4, width: 300, height: 400};
    const engine = new VideoPrimaryRenderEngine(canvas);
    jest.mocked(VideoSelector.isVideoPlaying).mockReturnValue(true);
    engine.drawImage(image, rect);
    expect(drawImage).toHaveBeenLastCalledWith(video, 3, 4, 300, 400);
    jest.mocked(VideoSelector.isVideoPlaying).mockReturnValue(false);
    engine.drawImage(image, rect);
    expect(drawImage).toHaveBeenLastCalledWith(image, 3, 4, 300, 400);
});

it('keeps native playback on the compositor and aligns zoom and scrolling without per-frame layout reads', () => {
    const canvas = document.createElement('canvas');
    const drawImage = jest.fn();
    jest.spyOn(canvas, 'getContext').mockReturnValue({drawImage} as unknown as CanvasRenderingContext2D);
    const host = document.createElement('div');
    const video = document.createElement('video');
    host.appendChild(video);
    Object.defineProperties(video, {paused: {value: false}, readyState: {value: 4}});
    EditorModel.videoElement = video;
    jest.mocked(VideoSelector.isVideoPlaying).mockReturnValue(true);
    const canvasBounds = jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({left: 80, top: 50} as DOMRect);
    const hostBounds = jest.spyOn(host, 'getBoundingClientRect').mockReturnValue({left: 20, top: 10} as DOMRect);
    const scroll = jest.spyOn(ViewPortActions, 'getAbsoluteScrollPosition').mockReturnValue({x: 0, y: 0});
    const rect = {x: 3, y: 4, width: 300, height: 400};
    const engine = new VideoPrimaryRenderEngine(canvas);
    for (let frame = 0; frame < 60; frame++) engine.drawImage(new Image(), rect);
    expect(drawImage).not.toHaveBeenCalled();
    expect(video.style).toMatchObject({position: 'absolute', left: '63px', top: '44px', width: '300px', height: '400px'});
    expect(canvasBounds).toHaveBeenCalledTimes(1);
    expect(hostBounds).toHaveBeenCalledTimes(1);

    scroll.mockReturnValue({x: 30, y: 40});
    canvasBounds.mockReturnValue({left: 50, top: 10} as DOMRect);
    engine.drawImage(new Image(), {...rect, width: 600, height: 800});
    expect(video.style).toMatchObject({left: '33px', top: '4px', width: '600px', height: '800px'});
    expect(drawImage).not.toHaveBeenCalled();
    video.style.position = 'static';
    engine.drawImage(new Image(), {...rect, width: 600, height: 800});
    expect(video.style.position).toBe('absolute');
});

it('uses the paused decoded snapshot at full viewport scale and preserves the FramePlayer fallback', () => {
    const canvas = document.createElement('canvas');
    const drawImage = jest.fn();
    jest.spyOn(canvas, 'getContext').mockReturnValue({drawImage} as unknown as CanvasRenderingContext2D);
    EditorModel.videoElement = document.createElement('video');
    EditorModel.videoFrameCanvas = document.createElement('canvas');
    jest.mocked(VideoSelector.isVideoPlaying).mockReturnValue(false);
    const image = new Image();
    const rect = {x: 3, y: 4, width: 300, height: 400};
    const engine = new VideoPrimaryRenderEngine(canvas);
    engine.drawImage(image, rect);
    expect(drawImage).toHaveBeenLastCalledWith(EditorModel.videoFrameCanvas, 3, 4, 300, 400);
    EditorModel.videoElement = null;
    engine.drawImage(image, rect);
    expect(drawImage).toHaveBeenLastCalledWith(image, 3, 4, 300, 400);
});
