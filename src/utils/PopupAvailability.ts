import {PopupWindowType} from '../data/enums/PopupWindowType';

declare const __OPENSIGHT_SHANGANG_RIZHAO_COMMERCIAL__: boolean;

const unreleasedServices = new Set<PopupWindowType>([
    PopupWindowType.DATA_CENTER,
    PopupWindowType.CALL_MODEL,
    PopupWindowType.TRAINING_TASK,
    PopupWindowType.TASK_CENTER,
    PopupWindowType.VECTOR_DB,
    PopupWindowType.L2G_RETRIEVAL,
    PopupWindowType.MODEL_INSPECTOR,
]);

export const isPopupAvailable = (
    popup: PopupWindowType | null,
    commercialRestricted = (
        typeof __OPENSIGHT_SHANGANG_RIZHAO_COMMERCIAL__ !== 'undefined'
        && __OPENSIGHT_SHANGANG_RIZHAO_COMMERCIAL__
    ),
): boolean => !commercialRestricted || !unreleasedServices.has(popup);
