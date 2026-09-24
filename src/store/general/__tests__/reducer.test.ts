import {generalReducer} from '../reducer';
import {updateActivePopupType, updateEraserFineMode, updateEraserMode, updateZoom} from '../actionCreators';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';

it('preserves scalar identity and remembered eraser mode across tool changes', () => {
    const initial = generalReducer(undefined, updateEraserFineMode(true));
    expect(generalReducer(initial, updateEraserMode(true))).toBe(initial);
    const hidden = generalReducer(initial, updateEraserMode(false));
    expect(hidden.eraserFineMode).toBe(true);
    const shown = generalReducer(hidden, updateEraserMode(true));
    expect(shown.eraserFineMode).toBe(true);
    expect(generalReducer(shown, updateZoom(shown.zoom))).toBe(shown);
});

it('tracks popup target changes even when the popup type is unchanged', () => {
    const firstAction = updateActivePopupType(PopupWindowType.COMPUTE_CLUSTER);
    const first = generalReducer(undefined, firstAction);
    expect(generalReducer(first, firstAction)).toBe(first);
    const targetAction = updateActivePopupType(PopupWindowType.COMPUTE_CLUSTER, 'node-2', 'second', true);
    const second = generalReducer(first, targetAction);
    expect(second).not.toBe(first);
    expect(second.activePopupNodeId).toBe('node-2');
    expect(generalReducer(second, targetAction)).toBe(second);
});
