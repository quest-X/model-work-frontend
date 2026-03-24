import {Notification} from '../enums/Notification';

export type NotificationContent = {
    header: string;
    description: string;
}

export type ExportFormatDataMap = Record<Notification, NotificationContent>;

export const NotificationsDataMap: ExportFormatDataMap = {
    [Notification.EMPTY_LABEL_NAME_ERROR]: {
        header: 'Empty label name',
        description: "Looks like you didn't assign name to one of your labels. Unfortunately it is mandatory for " +
            'every label to have unique name value. Insert correct name or delete empty label and try again.'
    },
    [Notification.NON_UNIQUE_LABEL_NAMES_ERROR]: {
        header: 'Non unique label names',
        description: 'Looks like not all your label names are unique. Unique names are necessary to guarantee correct' +
            ' data export when you complete your work. Make your names unique and try again.'
    },
    [Notification.MODEL_DOWNLOAD_ERROR]: {
        header: '模型加载失败',
        description: '无法连接推理服务器或模型下载失败。请确认 detect_server.py 已启动，且服务地址正确。'
    },
    [Notification.MODEL_INFERENCE_ERROR]: {
        header: '推理失败',
        description: '无法对当前图片执行推理。请检查推理服务器是否正常运行，或更换模型后重试。'
    },
    [Notification.MODEL_LOAD_ERROR]: {
        header: '模型上传失败',
        description: '无法将 .pt 模型文件上传到推理服务器。请确认服务器已启动且文件格式正确。'
    },
    [Notification.LABELS_FILE_UPLOAD_ERROR]: {
        header: 'Labels file was not uploaded',
        description: 'Looks like you forgot to upload text file containing list of detected classes names. We need ' +
            'it to map YOLOv5 model output to labels. Please re-upload all model files once again.'
    },
    [Notification.ANNOTATION_FILE_PARSE_ERROR]: {
        header: 'Annotation files could not be parsed',
        description: 'The contents of an annotation file is not valid JSON, CSV, or XML. Please fix the files ' +
            'selected to import and try again.',
    },
    [Notification.ANNOTATION_IMPORT_ASSERTION_ERROR]: {
        header: 'Annotation files did not contain valid data',
        description: 'Missing or invalid annotations provided during import. Please fix the files selected ' +
            'to import and try again.',
    },
    [Notification.UNSUPPORTED_INFERENCE_SERVER_MESSAGE]: {
        header: 'Selected inference server is not yet supported',
        description: 'Integration with selected inference server is still under construction. Stay tuned for more ' +
            'updates on our GitHub.'
    },
    [Notification.ROBOFLOW_INFERENCE_SERVER_ERROR]: {
        header: 'Roboflow connection failed',
        description: 'Looks like we ware unable to connect to your Roboflow model. Please, make sure that the model ' +
            'specification and Roboflow API key, are correct.'
    }
}
