import React from 'react';
import {act, render} from '@testing-library/react';
import {ImageRepository} from '../../../../../logic/imageRepository/ImageRepository';
import {ImageData} from '../../../../../store/labels/types';
import {FileUtil} from '../../../../../utils/FileUtil';
import {ImageDataUtil} from '../../../../../utils/ImageDataUtil';
import {ImagePreview} from '../ImagePreview';
import {store} from '../../../../../index';
import {LabelUtil} from '../../../../../utils/LabelUtil';
import configureStore from '../../../../../configureStore';
import {EditorModel} from '../../../../../staticModels/EditorModel';
import {FrameExtractorService} from '../../../../../services/FrameExtractorService';

jest.mock('../../../../../index', () => ({store: {getState: jest.fn(() => ({labels: {imagesData: []}}))}}));

const imageData = (id: string): ImageData => ({
    ...ImageDataUtil.createImageDataFromFileData(new File([id], `${id}.jpg`, {type: 'image/jpeg'})),
    id,
});

describe('ImagePreview rapid switching', () => {
    beforeEach(() => {
        jest.mocked(store.getState).mockReturnValue(configureStore().getState());
        Object.defineProperty(URL, 'revokeObjectURL', {
            configurable: true,
            value: jest.fn(),
        });
        ImageRepository.clearAllCache();
    });

    it('keeps annotations added while a thumbnail was loading, even before React receives new props', async () => {
        let finishLoad: (image: HTMLImageElement) => void;
        jest.spyOn(FileUtil, 'loadImage').mockImplementation(() => new Promise(resolve => { finishLoad = resolve; }));
        const original = imageData('inferred-frame');
        const props = {imageData: original, style: {}, size: {width: 150, height: 150},
            updateImageDataById: jest.fn(), deleteImageById: jest.fn(), deleteSelectedImages: jest.fn()};
        render(<ImagePreview {...props}/>);
        const latest = {...original, labelRects: [LabelUtil.createLabelRect('cat', {x: 1, y: 2, width: 3, height: 4})]};
        const current = store.getState();
        jest.mocked(store.getState).mockReturnValue({...current, labels: {...current.labels, imagesData: [latest]}});

        await act(async () => { finishLoad(new Image()); });

        expect(props.updateImageDataById).toHaveBeenCalledWith(original.id,
            expect.objectContaining({loadStatus: true, labelRects: latest.labelRects}));
    });

    afterEach(() => {
        jest.restoreAllMocks();
        EditorModel.videoSessionId = '';
        ImageRepository.clearAllCache();
    });

    it('shows a playback thumbnail while an older sidebar frame request is still pending', async () => {
        let finishFetch: (frames: File[]) => void;
        jest.spyOn(FrameExtractorService, 'fetchFrameRange').mockImplementation(() =>
            new Promise(resolve => { finishFetch = resolve; }));
        EditorModel.videoSessionId = 'test-session';
        const frame = {...imageData('video-frame'),
            fileData: new File([], 'frame_000000.jpg', {type: 'image/jpeg'}), loadStatus: false};
        const props = {imageData: frame, style: {}, size: {width: 150, height: 150},
            updateImageDataById: jest.fn(), deleteImageById: jest.fn(), deleteSelectedImages: jest.fn()};
        const {container, rerender} = render(<ImagePreview {...props}/>);
        expect(FrameExtractorService.fetchFrameRange).toHaveBeenCalledWith('test-session', 0, 1);

        const thumbnail = new Image();
        thumbnail.src = 'blob:playback-frame';
        thumbnail.width = 200;
        thumbnail.height = 120;
        ImageRepository.storeImage(frame.id, thumbnail);
        rerender(<ImagePreview {...props} imageData={{...frame, loadStatus: true}}/>);
        expect(container.querySelector('img.Image')?.getAttribute('src')).toBe('blob:playback-frame');

        await act(async () => { finishFetch([]); });
        expect(container.querySelector('img.Image')?.getAttribute('src')).toBe('blob:playback-frame');
    });

    it('discards a late image load after the preview has switched to another image', async () => {
        const resolvers = new Map<string, (image: HTMLImageElement) => void>();
        jest.spyOn(FileUtil, 'loadImage').mockImplementation(file => new Promise(resolve => {
            resolvers.set(file.name, resolve);
        }));
        const oldData = imageData('old-frame');
        const newData = imageData('new-frame');
        const props = {
            imageData: oldData,
            style: {},
            size: {width: 150, height: 150},
            updateImageDataById: jest.fn(),
            deleteImageById: jest.fn(),
            deleteSelectedImages: jest.fn(),
        };
        const {rerender} = render(<ImagePreview {...props}/>);
        rerender(<ImagePreview {...props} imageData={newData}/>);

        const lateImage = new Image();
        lateImage.src = 'blob:old-frame';
        await act(async () => {
            resolvers.get('old-frame.jpg')(lateImage);
        });

        expect(ImageRepository.getById('old-frame')).toBeUndefined();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old-frame');

        const currentImage = new Image();
        currentImage.src = 'blob:new-frame';
        await act(async () => {
            resolvers.get('new-frame.jpg')(currentImage);
        });

        expect(ImageRepository.getById('new-frame')).toBe(currentImage);
        expect(props.updateImageDataById).toHaveBeenCalledWith(
            'new-frame',
            expect.objectContaining({loadStatus: true}),
        );
    });

    it('reuses a pending thumbnail when scrolling stops', () => {
        const load = jest.spyOn(FileUtil, 'loadImage').mockImplementation(() => new Promise(() => undefined));
        const props = {imageData: imageData('pending'), style: {}, size: {width: 150, height: 150},
            updateImageDataById: jest.fn(), deleteImageById: jest.fn(), deleteSelectedImages: jest.fn()};
        const {rerender} = render(<ImagePreview {...props} isScrolling/>);
        rerender(<ImagePreview {...props} isScrolling={false}/>);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('reloads an evicted thumbnail without rewriting an already loaded frame', async () => {
        const image = new Image();
        image.src = 'blob:evicted-reloaded';
        jest.spyOn(FileUtil, 'loadImage').mockResolvedValue(image);
        const props = {imageData: {...imageData('evicted'), loadStatus: true}, style: {}, size: {width: 150, height: 150},
            updateImageDataById: jest.fn(), deleteImageById: jest.fn(), deleteSelectedImages: jest.fn()};
        render(<ImagePreview {...props}/>);
        await act(async () => undefined);
        expect(ImageRepository.getById('evicted')).toBe(image);
        expect(props.updateImageDataById).not.toHaveBeenCalled();
    });

    it('refreshes preview positions and same-count annotation changes', () => {
        const props = {imageData: imageData('position'), style: {left: 0}, size: {width: 150, height: 150},
            updateImageDataById: jest.fn(), deleteImageById: jest.fn(), deleteSelectedImages: jest.fn()};
        const preview = new ImagePreview(props);
        expect(preview.shouldComponentUpdate({...props, style: {left: 150}}, preview.state)).toBe(true);
        expect(preview.shouldComponentUpdate({...props, imageData: {...props.imageData}}, preview.state)).toBe(true);
        expect(preview.shouldComponentUpdate({...props, isFirstSelected: true}, preview.state)).toBe(true);
    });

    it('uses the latest indexed frame without scanning the dataset', async () => {
        const original = imageData('indexed');
        const latest = {...original, labelRects: [LabelUtil.createLabelRect('cat', {x: 1, y: 2, width: 3, height: 4})]};
        const images = [latest];
        const scan = jest.spyOn(images, 'find');
        const state = store.getState();
        jest.mocked(store.getState).mockReturnValue({...state, labels: {...state.labels, imagesData: images}});
        const image = new Image();
        image.src = 'blob:indexed';
        jest.spyOn(FileUtil, 'loadImage').mockResolvedValue(image);
        const props = {imageData: original, imageIndex: 0, style: {}, size: {width: 150, height: 150},
            updateImageDataById: jest.fn(), deleteImageById: jest.fn(), deleteSelectedImages: jest.fn()};
        render(<ImagePreview {...props}/>);
        await act(async () => undefined);
        expect(scan).not.toHaveBeenCalled();
        expect(props.updateImageDataById).toHaveBeenCalledWith('indexed', expect.objectContaining({labelRects: latest.labelRects}));
    });
});
