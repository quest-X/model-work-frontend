import {VideoPrimaryRenderEngine} from '../VideoPrimaryRenderEngine';
import {VideoSelector} from '../../../store/selectors/VideoSelector';
import {EditorModel} from '../../../staticModels/EditorModel';

jest.mock('../../../index', () => ({store: {getState: jest.fn(() => ({})), dispatch: jest.fn()}}));

jest.mock('../../../store/selectors/VideoSelector', () => ({VideoSelector: {isVideoPlaying: jest.fn()}}));

afterEach(() => { jest.restoreAllMocks(); EditorModel.videoElement = null; EditorModel.videoFrameImage = null; });

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
