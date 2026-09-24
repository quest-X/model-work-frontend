import React from 'react';
import {act, render} from '@testing-library/react';
import {AIActions} from '../../../../logic/actions/AIActions';
import {EditorActions} from '../../../../logic/actions/EditorActions';
import {ViewPortActions} from '../../../../logic/actions/ViewPortActions';
import {ImageRepository} from '../../../../logic/imageRepository/ImageRepository';
import {VideoSelector} from '../../../../store/selectors/VideoSelector';
import {ImageData} from '../../../../store/labels/types';
import {FileUtil} from '../../../../utils/FileUtil';
import {ImageDataUtil} from '../../../../utils/ImageDataUtil';
import {LabelType} from '../../../../data/enums/LabelType';
import {Editor} from '../Editor';

const imageData = (id: string): ImageData => ({
    ...ImageDataUtil.createImageDataFromFileData(new File([id], `${id}.jpg`, {type: 'image/jpeg'})),
    id,
    loadStatus: true,
});

describe('Editor rapid switching', () => {
    beforeEach(() => {
        Object.defineProperty(URL, 'revokeObjectURL', {
            configurable: true,
            value: jest.fn(),
        });
        ImageRepository.clearAllCache();
        jest.spyOn(VideoSelector, 'isVideoMode').mockReturnValue(false);
        jest.spyOn(EditorActions, 'mountRenderEnginesAndHelpers').mockImplementation(() => undefined);
        jest.spyOn(EditorActions, 'fullRender').mockImplementation(() => undefined);
        jest.spyOn(ViewPortActions, 'updateViewPortSize').mockImplementation(() => undefined);
        jest.spyOn(ViewPortActions, 'updateDefaultViewPortImageRect').mockImplementation(() => undefined);
        jest.spyOn(ViewPortActions, 'resizeViewPortContent').mockImplementation(() => undefined);
        jest.spyOn(EditorActions, 'setLoadingStatus').mockImplementation(() => undefined);
        jest.spyOn(EditorActions, 'setActiveImage').mockImplementation(() => undefined);
        jest.spyOn(AIActions, 'detect').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        ImageRepository.clearAllCache();
    });

    it('reloads a repository miss and ignores the previous image when it resolves late', async () => {
        const resolvers = new Map<string, (image: HTMLImageElement) => void>();
        jest.spyOn(FileUtil, 'loadImage').mockImplementation(file => new Promise(resolve => {
            resolvers.set(file.name, resolve);
        }));
        const oldData = imageData('old-frame');
        const newData = imageData('new-frame');
        const updateImageDataById = jest.fn();
        const props = {
            size: {width: 800, height: 600},
            imageData: oldData,
            activeLabelType: LabelType.RECT,
            updateImageDataById,
            activePopupType: null,
            activeLabelId: null,
            customCursorStyle: null,
            imageDragMode: false,
            zoom: 1,
        };
        const {rerender} = render(<Editor {...props}/>);
        rerender(<Editor {...props} imageData={newData}/>);

        const lateImage = new Image();
        lateImage.src = 'blob:old-frame';
        await act(async () => {
            resolvers.get('old-frame.jpg')(lateImage);
        });

        expect(ImageRepository.getById('old-frame')).toBeUndefined();
        expect(EditorActions.setActiveImage).not.toHaveBeenCalled();

        const currentImage = new Image();
        currentImage.src = 'blob:new-frame';
        await act(async () => {
            resolvers.get('new-frame.jpg')(currentImage);
        });

        expect(ImageRepository.getById('new-frame')).toBe(currentImage);
        expect(EditorActions.setActiveImage).toHaveBeenCalledWith(currentImage);
        expect(updateImageDataById).toHaveBeenCalledWith(
            'new-frame',
            expect.objectContaining({loadStatus: true}),
        );
    });
});
