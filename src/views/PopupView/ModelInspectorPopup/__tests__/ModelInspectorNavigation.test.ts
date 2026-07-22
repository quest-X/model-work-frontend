import {store} from '../../../../index';
import {ViewPortActions} from '../../../../logic/actions/ViewPortActions';
import {Action} from '../../../../store/Actions';
import {LabelsSelector} from '../../../../store/selectors/LabelsSelector';
import {navigateInspectorImage} from '../ModelInspectorNavigation';

jest.mock('../../../../index', () => ({
    store: {dispatch: jest.fn()},
}));

jest.mock('../../../../logic/actions/ViewPortActions', () => ({
    ViewPortActions: {setZoom: jest.fn()},
}));

jest.mock('../../../../store/selectors/LabelsSelector', () => ({
    LabelsSelector: {
        getActiveImageIndex: jest.fn(),
        getImagesData: jest.fn(),
    },
}));

describe('ModelInspectorNavigation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (LabelsSelector.getActiveImageIndex as jest.Mock).mockReturnValue(2);
        (LabelsSelector.getImagesData as jest.Mock).mockReturnValue([{}, {}, {}, {}]);
    });

    it('updates the real active image state independently of the editor canvas lock', () => {
        expect(navigateInspectorImage(1)).toBe(true);
        expect(ViewPortActions.setZoom).toHaveBeenCalledWith(1);
        expect(store.dispatch).toHaveBeenCalledWith({
            type: Action.UPDATE_ACTIVE_IMAGE_INDEX,
            payload: {activeImageIndex: 3},
        });
        expect(store.dispatch).toHaveBeenCalledWith({
            type: Action.UPDATE_ACTIVE_LABEL_ID,
            payload: {activeLabelId: null},
        });
    });

    it('does not navigate beyond the image list', () => {
        (LabelsSelector.getActiveImageIndex as jest.Mock).mockReturnValue(3);
        expect(navigateInspectorImage(1)).toBe(false);
        expect(store.dispatch).not.toHaveBeenCalled();
    });
});
