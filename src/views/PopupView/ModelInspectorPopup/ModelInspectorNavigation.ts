import {store} from '../../../index';
import {ViewPortActions} from '../../../logic/actions/ViewPortActions';
import {LabelsSelector} from '../../../store/selectors/LabelsSelector';
import {
    updateActiveImageIndex,
    updateActiveLabelId,
} from '../../../store/labels/actionCreators';

export const navigateInspectorImage = (direction: -1 | 1): boolean => {
    const activeIndex = LabelsSelector.getActiveImageIndex();
    const nextIndex = activeIndex + direction;
    const imageCount = LabelsSelector.getImagesData().length;
    if (nextIndex < 0 || nextIndex >= imageCount) return false;

    // Inspector navigation is deliberate popup input and must not be blocked by
    // a stale/in-progress editor canvas transform lock behind the modal.
    ViewPortActions.setZoom(1);
    store.dispatch(updateActiveImageIndex(nextIndex));
    store.dispatch(updateActiveLabelId(null));
    return true;
};
