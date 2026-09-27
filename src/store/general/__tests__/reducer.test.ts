import {generalReducer} from '../reducer';
import {updateActivePopupType, updateEraserFineMode, updateEraserMode, updateZoom} from '../actionCreators';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';

const commercialBuild = globalThis as typeof globalThis & {
    __OPENSIGHT_SHANGANG_RIZHAO_COMMERCIAL__?: boolean;
};
afterEach(() => delete commercialBuild.__OPENSIGHT_SHANGANG_RIZHAO_COMMERCIAL__);

it.each([
    PopupWindowType.DATA_CENTER,
    PopupWindowType.CALL_MODEL,
    PopupWindowType.TRAINING_TASK,
    PopupWindowType.TASK_CENTER,
    PopupWindowType.VECTOR_DB,
    PopupWindowType.L2G_RETRIEVAL,
    PopupWindowType.MODEL_INSPECTOR,
])('rejects restricted %s even when a caller dispatches directly', popup => {
    commercialBuild.__OPENSIGHT_SHANGANG_RIZHAO_COMMERCIAL__ = true;
    const current = generalReducer(undefined, updateActivePopupType(PopupWindowType.MANAGE_AI_MODELS));
    expect(generalReducer(current, updateActivePopupType(popup, 'node-2', 'second', true))).toBe(current);
    commercialBuild.__OPENSIGHT_SHANGANG_RIZHAO_COMMERCIAL__ = false;
    expect(generalReducer(current, updateActivePopupType(popup)).activePopupType).toBe(popup);
});

it.each([
    PopupWindowType.MANAGE_AI_MODELS,
    PopupWindowType.MODEL_ENGINE,
    PopupWindowType.CAMERA_CONNECT,
    PopupWindowType.JETSON_CONNECT,
    PopupWindowType.COMPUTE_CLUSTER,
    null,
])('retains released navigation and closing for %s', popup => {
    commercialBuild.__OPENSIGHT_SHANGANG_RIZHAO_COMMERCIAL__ = true;
    const current = generalReducer(undefined, updateActivePopupType(PopupWindowType.MANAGE_AI_MODELS));
    expect(generalReducer(current, updateActivePopupType(popup)).activePopupType).toBe(popup);
});

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
