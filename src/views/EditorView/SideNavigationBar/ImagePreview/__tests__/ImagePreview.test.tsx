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
        ImageRepository.clearAllCache();
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
});
