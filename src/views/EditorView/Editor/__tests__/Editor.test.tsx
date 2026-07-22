import {AIActions} from '../../../../logic/actions/AIActions';
import {EditorActions} from '../../../../logic/actions/EditorActions';
import {ImageRepository} from '../../../../logic/imageRepository/ImageRepository';
import {VideoSelector} from '../../../../store/selectors/VideoSelector';
import {ImageData} from '../../../../store/labels/types';
import {FileUtil} from '../../../../utils/FileUtil';
import {LabelType} from '../../../../data/enums/LabelType';
import {Editor} from '../Editor';

const imageData = (id: string): ImageData => ({
    id,
    loadStatus: true,
    fileData: new File([id], `${id}.jpg`, {type: 'image/jpeg'}),
} as ImageData);

describe('Editor rapid switching', () => {
    beforeEach(() => {
        Object.defineProperty(URL, 'revokeObjectURL', {
            configurable: true,
            value: jest.fn(),
        });
        ImageRepository.clearAllCache();
        jest.spyOn(VideoSelector, 'isVideoMode').mockReturnValue(false);
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
        const editor = new Editor(props);
        (editor as any).mounted = true;
        (editor as any).updateModelAndRender = jest.fn();

        await (editor as any).loadImage(oldData);
        (editor as any).props = {...props, imageData: newData};
        await (editor as any).loadImage(newData);

        const lateImage = new Image();
        lateImage.src = 'blob:old-frame';
        resolvers.get('old-frame.jpg')(lateImage);
        await Promise.resolve();

        expect(ImageRepository.getById('old-frame')).toBeUndefined();
        expect(EditorActions.setActiveImage).not.toHaveBeenCalled();

        const currentImage = new Image();
        currentImage.src = 'blob:new-frame';
        resolvers.get('new-frame.jpg')(currentImage);
        await Promise.resolve();

        expect(ImageRepository.getById('new-frame')).toBe(currentImage);
        expect(EditorActions.setActiveImage).toHaveBeenCalledWith(currentImage);
        expect(updateImageDataById).toHaveBeenCalledWith(
            'new-frame',
            expect.objectContaining({loadStatus: true}),
        );
    });
});
