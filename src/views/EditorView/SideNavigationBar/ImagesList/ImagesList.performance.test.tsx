import {ImagesList} from './ImagesList';
import {store} from '../../../../index';
import {ImageActions} from '../../../../logic/actions/ImageActions';
import {ImageDataUtil} from '../../../../utils/ImageDataUtil';
import {Language} from '../../../../data/LanguageConfig';
import {LabelType} from '../../../../data/enums/LabelType';
import {selectImageRange} from '../../../../store/labels/actionCreators';

jest.mock('../../../../index', () => ({store: {dispatch: jest.fn()}}));
jest.mock('../../../../logic/actions/ImageActions', () => ({ImageActions: {goToImageByIndex: jest.fn()}}));

it('collapses a 10,000-frame selection with one selection action', () => {
    const template = ImageDataUtil.createImageDataFromFileData(new File([], 'frame.jpg'));
    const imagesData = Array.from({length: 10000}, (_, index) => ({...template, id: String(index), isSelected: true}));
    const list = new ImagesList({imagesData, activeImageIndex: 0, activeLabelType: LabelType.ALL, imageAIStates: new Map(), language: Language.ENGLISH});
    jest.spyOn(list, 'setState').mockImplementation(() => undefined);
    list['onClickHandler'](42);
    expect(ImageActions.goToImageByIndex).toHaveBeenCalledWith(42);
    expect(store.dispatch).toHaveBeenCalledTimes(1);
    expect(store.dispatch).toHaveBeenCalledWith(selectImageRange(42, 42));
});
