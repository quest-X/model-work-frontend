import React from 'react';
import {act, render} from '@testing-library/react';
import {ImageRepository} from '../../../../../logic/imageRepository/ImageRepository';
import {ImageData} from '../../../../../store/labels/types';
import {FileUtil} from '../../../../../utils/FileUtil';
import {ImageDataUtil} from '../../../../../utils/ImageDataUtil';
import {ImagePreview} from '../ImagePreview';

const imageData = (id: string): ImageData => ({
    ...ImageDataUtil.createImageDataFromFileData(new File([id], `${id}.jpg`, {type: 'image/jpeg'})),
    id,
});

describe('ImagePreview rapid switching', () => {
    beforeEach(() => {
        Object.defineProperty(URL, 'revokeObjectURL', {
            configurable: true,
            value: jest.fn(),
        });
        ImageRepository.clearAllCache();
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
