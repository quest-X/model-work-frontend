import {Notification} from '../enums/Notification';
import {Language, LanguageConfig, LanguageTexts} from '../LanguageConfig';

export type NotificationContent = {
    header: string;
    description: string;
}

export type ExportFormatDataMap = Record<Notification, NotificationContent>;

function buildMap(texts: LanguageTexts): ExportFormatDataMap {
    const n = texts.notifications;
    return {
        [Notification.EMPTY_LABEL_NAME_ERROR]: n.emptyLabelName,
        [Notification.NON_UNIQUE_LABEL_NAMES_ERROR]: n.nonUniqueLabelNames,
        [Notification.MODEL_DOWNLOAD_ERROR]: n.modelDownloadError,
        [Notification.MODEL_INFERENCE_ERROR]: n.modelInferenceError,
        [Notification.MODEL_LOAD_ERROR]: n.modelLoadError,
        [Notification.LABELS_FILE_UPLOAD_ERROR]: n.labelsFileUploadError,
        [Notification.ANNOTATION_FILE_PARSE_ERROR]: n.annotationFileParseError,
        [Notification.ANNOTATION_IMPORT_ASSERTION_ERROR]: n.annotationImportAssertionError,
        [Notification.UNSUPPORTED_INFERENCE_SERVER_MESSAGE]: n.unsupportedInferenceServer,
        [Notification.ROBOFLOW_INFERENCE_SERVER_ERROR]: n.roboflowInferenceServerError,
    } as ExportFormatDataMap;
}

/**
 * Get notification data map for the given language.
 * Use this instead of NotificationsDataMap when you have access to the language.
 */
export function getNotificationsData(language: Language): ExportFormatDataMap {
    return buildMap(LanguageConfig[language]);
}

/**
 * Legacy compatibility: static map using Chinese as default.
 * Consumers that access the store should prefer getNotificationsData(language) instead.
 */
export const NotificationsDataMap: ExportFormatDataMap = buildMap(LanguageConfig[Language.CHINESE]);
