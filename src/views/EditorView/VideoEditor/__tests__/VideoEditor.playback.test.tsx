import React from 'react';
import {render} from '@testing-library/react';
import {VideoEditor} from '../VideoEditor';
import {createVideoFramePlaceholders} from '../VideoFrameState';
import {EditorModel} from '../../../../staticModels/EditorModel';
import {EditorActions} from '../../../../logic/actions/EditorActions';
import {ViewPortActions} from '../../../../logic/actions/ViewPortActions';
import {Language} from '../../../../data/LanguageConfig';
import {VideoData} from '../../../../store/video/types';

let mockTimeUpdate: (time: number, frame: number) => void;
jest.mock('../../VideoPlayer/VideoPlayer', () => ({__esModule: true, default: (props: {onTimeUpdate: typeof mockTimeUpdate}) => {
    mockTimeUpdate = props.onTimeUpdate;
    return null;
}}));
jest.mock('../../FramePlayer/FramePlayer', () => ({__esModule: true, default: () => null}));
jest.mock('../../VideoTimeline/VideoTimeline', () => ({__esModule: true, default: () => null}));
jest.mock('../../Editor/Editor', () => ({__esModule: true, default: () => null}));
jest.mock('../../../../index', () => ({store: {getState: jest.fn(() => ({labels: {imagesData: []}}))}}));
jest.mock('../../../../logic/actions/EditorActions', () => ({EditorActions: {setActiveImage: jest.fn(), fullRender: jest.fn()}}));
jest.mock('../../../../logic/actions/ViewPortActions', () => ({ViewPortActions: {resizeViewPortContent: jest.fn()}}));
jest.mock('../../../../logic/imageRepository/ImageRepository', () => ({ImageRepository: {getById: jest.fn(), saveFileCache: jest.fn()}}));

beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: jest.fn(() => 'blob:video')});
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: jest.fn()});
    EditorModel.videoFrameImage = new Image(1920, 1080);
    EditorModel.canvas = document.createElement('canvas');
});
afterEach(() => {
    jest.restoreAllMocks();
    EditorModel.videoFrameImage = null;
    EditorModel.canvas = null;
    EditorModel.playbackImageData = null;
});

const fixture = () => {
    const frames = createVideoFramePlaceholders(120);
    const activeVideo: VideoData = {id: 'video', fileData: new File(['video'], 'video.mp4', {type: 'video/mp4'}),
        duration: 2, fps: 60, totalFrames: 120, videoSize: {width: 1920, height: 1080},
        loadStatus: true, currentFrame: 0, currentTime: 0, isPlaying: true, frames: new Map()};
    const props = {activeVideo, imagesData: frames, activeImageIndex: 0, language: Language.ENGLISH,
        editorSize: {width: 1000, height: 800}, updateVideoCurrentFrame: jest.fn(), updateVideoPlayingStatus: jest.fn(),
        updateVideoMetadata: jest.fn(), updateImageDataById: jest.fn(), updateImageData: jest.fn(),
        updateActiveImageIndex: jest.fn(), addImageData: jest.fn(), toggleImageSelection: jest.fn()};
    return {frames, props};
};

it('renders every decoded frame while throttling controls and avoids a second render from Redux', () => {
    const {frames, props} = fixture();
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const view = render(<VideoEditor {...props}/>);
    jest.mocked(EditorActions.fullRender).mockClear();
    expect(view.container.querySelector('.native-video-playing')).not.toBeNull();
    for (let frame = 1; frame <= 60; frame++) {
        now = 1000 + frame * 1000 / 60;
        mockTimeUpdate(frame / 60, frame);
        expect(EditorModel.playbackImageData).toBe(frames[frame]);
    }
    expect(EditorActions.fullRender).toHaveBeenCalledTimes(60);
    expect(ViewPortActions.resizeViewPortContent).toHaveBeenCalledTimes(60);
    expect(props.updateVideoCurrentFrame.mock.calls.length).toBeLessThanOrEqual(11);
    expect(props.updateActiveImageIndex.mock.calls.length).toBeLessThanOrEqual(6);
    mockTimeUpdate(1, 60);
    expect(EditorActions.fullRender).toHaveBeenCalledTimes(60);
    view.rerender(<VideoEditor {...props} activeVideo={{...props.activeVideo, currentFrame: 60, currentTime: 1}}/>);
    expect(EditorActions.fullRender).toHaveBeenCalledTimes(60);
});

it('commits the last frame immediately and restores paused rendering', () => {
    const {frames, props} = fixture();
    jest.spyOn(Date, 'now').mockReturnValue(1);
    const view = render(<VideoEditor {...props}/>);
    jest.mocked(EditorActions.fullRender).mockClear();
    mockTimeUpdate(119 / 60, 119);
    expect(props.updateVideoCurrentFrame).toHaveBeenLastCalledWith('video', 119, 119 / 60);
    expect(props.updateActiveImageIndex).toHaveBeenLastCalledWith(119);
    expect(EditorModel.playbackImageData).toBe(frames[119]);
    view.rerender(<VideoEditor {...props} activeVideo={{...props.activeVideo, isPlaying: false, currentFrame: 119}}/>);
    expect(view.container.querySelector('.native-video-playing')).toBeNull();
    expect(EditorActions.fullRender).toHaveBeenCalledTimes(2);
});

it('keeps the extracted-frame player opaque during playback', () => {
    const {props} = fixture();
    const view = render(<VideoEditor {...props} activeVideo={{...props.activeVideo,
        fileData: new File([], 'restored.mp4'), sessionId: 'frames-only'}}/>);
    expect(view.container.querySelector('.video-playing')).not.toBeNull();
    expect(view.container.querySelector('.native-video-playing')).toBeNull();
});
