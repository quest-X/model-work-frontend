import React, {useState, useEffect} from 'react';
import './LoadYOLOv5ModelPopup.scss'
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {ImageButton} from '../../Common/ImageButton/ImageButton';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {GeneralActionTypes} from '../../../store/general/types';
import {updateActivePopupType} from '../../../store/general/actionCreators';
import {submitNewNotification} from '../../../store/notifications/actionCreators';
import {INotification, NotificationsActionType} from '../../../store/notifications/types';
import {NotificationUtil} from '../../../utils/NotificationUtil';
import {NotificationsDataMap} from '../../../data/info/NotificationsData';
import {Notification} from '../../../data/enums/Notification';
import {CSSHelper} from '../../../logic/helpers/CSSHelper';
import {ClipLoader} from 'react-spinners';
import {useDropzone} from 'react-dropzone';
import {DetectionAPIDetector} from '../../../ai/DetectionAPIDetector';
import {AIDetectionActions} from '../../../logic/actions/AIDetectionActions';
import {ImageData} from '../../../store/labels/types';
import {LabelsSelector} from '../../../store/selectors/LabelsSelector';
import {getSelectedModelFamily, getServerUrl} from '../LoadModelPopup/LoadModelPopup';

enum ModelSource {
    UPLOAD = 'UPLOAD',
    OFFICIAL = 'OFFICIAL'
}

const VARIANT_LABELS: Record<string, string> = {
    'n': 'Nano', 's': 'Small', 'm': 'Medium', 'l': 'Large', 'x': 'Extra Large',
    't': 'Tiny', 'c': 'Compact', 'e': 'Extended'
};

function getVariantLabel(variant: string): string {
    const suffix = variant.replace(/^.*?(\w)$/, '$1');
    return VARIANT_LABELS[suffix] || suffix.toUpperCase();
}

interface IProps {
    updateActivePopupTypeAction: (activePopupType: PopupWindowType) => GeneralActionTypes;
    submitNewNotificationAction: (notification: INotification) => NotificationsActionType;
}

const LoadYOLOv5ModelPopup: React.FC<IProps> = ({ updateActivePopupTypeAction, submitNewNotificationAction }) => {
    const modelFamily = getSelectedModelFamily();
    const serverUrl = getServerUrl();
    const variants = modelFamily?.variants || [];

    const [modelSource, setModelSource] = useState(ModelSource.OFFICIAL);
    const [selectedVariant, setSelectedVariant] = useState(variants[0] || '');
    const [isLoading, setIsLoading] = useState(false);
    const [loadProgress, setLoadProgress] = useState(0);
    const [loadState, setLoadState] = useState('');
    const [modelFile, setModelFile] = useState<File | null>(null);
    const [loadedModel, setLoadedModel] = useState<string>('');
    const [downloadedModels, setDownloadedModels] = useState<string[]>([]);

    useEffect(() => {
        fetch(`${serverUrl}/health`).then(r => r.json())
            .then(data => { if (data.model) setLoadedModel(data.model.replace(/\.pt$/, '')); })
            .catch(() => {});
        fetch(`${serverUrl}/available-models`).then(r => r.json())
            .then(data => { if (data.models) setDownloadedModels(data.models); })
            .catch(() => {});
    }, [serverUrl]);

    const pollLoadStatus = (): Promise<void> => {
        return new Promise((resolve, reject) => {
            const interval = setInterval(async () => {
                try {
                    const res = await fetch(`${serverUrl}/load-status`);
                    const data = await res.json();
                    setLoadProgress(data.progress || 0);
                    setLoadState(data.state || '');
                    if (data.state === 'ready') {
                        clearInterval(interval);
                        setLoadedModel(data.model?.replace(/\.pt$/, '') || '');
                        resolve();
                    } else if (data.state === 'error') {
                        clearInterval(interval);
                        reject(new Error(data.error || '加载失败'));
                    }
                } catch {
                    clearInterval(interval);
                    reject(new Error('无法连接服务器'));
                }
            }, 500);
        });
    };

    const onDrop = (accepted: File[]) => {
        const ptFiles = accepted.filter((f: File) => f.name.endsWith('.pt'));
        if (ptFiles.length > 0) {
            setModelFile(ptFiles[0]);
        }
    };

    const {getRootProps, getInputProps} = useDropzone({onDrop});

    const triggerDetection = () => {
        const detectUrl = serverUrl.replace(/\/+$/, '') + '/detect';
        DetectionAPIDetector.setConfig({ url: detectUrl, enabled: true });
        PopupActions.close();
        try {
            const activeImageData: ImageData = LabelsSelector.getActiveImageData();
            if (activeImageData) {
                AIDetectionActions.detectObjects(activeImageData);
            }
        } catch {
            // No active image
        }
    };

    const onAccept = async () => {
        setIsLoading(true);
        setLoadProgress(0);
        setLoadState('downloading');

        if (modelSource === ModelSource.OFFICIAL) {
            try {
                const res = await fetch(`${serverUrl}/load-model`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: `${selectedVariant}.pt` })
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.detail || res.statusText);
                }
                await pollLoadStatus();
                triggerDetection();
            } catch (e) {
                setIsLoading(false);
                setLoadState('');
                submitNewNotificationAction(NotificationUtil.createErrorNotification(
                    NotificationsDataMap[Notification.MODEL_DOWNLOAD_ERROR]));
            }
        } else {
            if (!modelFile) return;
            const formData = new FormData();
            formData.append('file', modelFile);
            try {
                setLoadProgress(30);
                const res = await fetch(`${serverUrl}/upload`, {
                    method: 'POST',
                    body: formData
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.detail || res.statusText);
                }
                setLoadProgress(100);
                triggerDetection();
            } catch (e) {
                setIsLoading(false);
                setLoadState('');
                submitNewNotificationAction(NotificationUtil.createErrorNotification(
                    NotificationsDataMap[Notification.MODEL_LOAD_ERROR]));
            }
        }
    };

    const onReject = () => {
        updateActivePopupTypeAction(PopupWindowType.LOAD_AI_MODEL);
    };

    const changeModelSource = (source: ModelSource) => {
        setModelSource(source);
        setModelFile(null);
    };

    // RENDER

    const renderMenu = () => {
        return(<div className='left-container'>
            <ImageButton
                image={'ico/upload.png'}
                imageAlt={'upload custom model'}
                buttonSize={{ width: 40, height: 40 }}
                padding={15}
                onClick={() => changeModelSource(ModelSource.UPLOAD)}
                externalClassName={'monochrome'}
                isActive={modelSource === ModelSource.UPLOAD}
            />
            <ImageButton
                image={'ico/download.png'}
                imageAlt={'official models'}
                buttonSize={{ width: 40, height: 40 }}
                padding={15}
                onClick={() => changeModelSource(ModelSource.OFFICIAL)}
                externalClassName={'monochrome'}
                isActive={modelSource === ModelSource.OFFICIAL}
            />
        </div>)
    };

    const renderOptions = () => {
        return(<div className='options'>
            {variants.map((variant) => {
                const isActive = loadedModel === variant;
                const isDownloaded = downloadedModels.includes(variant);
                const classes = `options-item${isActive ? ' active' : isDownloaded ? ' downloaded' : ''}`;
                return (
                    <div
                        className={classes}
                        onClick={() => setSelectedVariant(variant)}
                        key={variant}
                    >
                        <img
                            draggable={false}
                            src={variant === selectedVariant ? 'ico/checkbox-checked.png' : 'ico/checkbox-unchecked.png'}
                            alt={variant === selectedVariant ? 'checked' : 'unchecked'}
                        />
                        <span className='variant-name'>{variant} ({getVariantLabel(variant)})</span>
                        {isActive && <span className='status-badge active-badge'>使用中</span>}
                        {!isActive && isDownloaded && <span className='status-badge downloaded-badge'>已下载</span>}
                    </div>
                );
            })}
        </div>)
    };

    const renderMessage = () => {
        const uploadMessage = `拖拽自定义 .pt 模型文件到下方区域，上传到推理服务器使用。`;
        const officialMessage = `选择 ${modelFamily?.name || 'YOLO'} 官方预训练模型变体，服务器将自动下载并加载。`;
        return(<div className='message'>
            {modelSource === ModelSource.OFFICIAL ? officialMessage : uploadMessage}
        </div>)
    };

    const stateLabels: Record<string, string> = {
        downloading: '正在下载模型...',
        loading: '正在加载模型...',
        ready: '加载完成',
        error: '加载失败',
    };

    const renderLoader = () => {
        return(<div className='loader'>
            <ClipLoader
                size={40}
                color={CSSHelper.getLeadingColor()}
                loading={true}
            />
            <div className='progress-info'>
                <p className='progress-text'>{stateLabels[loadState] || '准备中...'} {loadProgress}%</p>
                <div className='progress-bar'>
                    <div className='progress-fill' style={{ width: `${loadProgress}%` }} />
                </div>
            </div>
        </div>)
    };

    const renderDropZone = () => {
        const hasFile = modelFile !== null;
        return(<div {...getRootProps({ className: 'drop-zone' })}>
            <input {...getInputProps()} />
            <img
                draggable={false}
                alt={hasFile ? 'uploaded' : 'upload'}
                src={hasFile ? 'ico/box-closed.png' : 'ico/box-opened.png'}
            />
            {hasFile ? <>
                <p className='extraBold'>{modelFile.name}</p>
                <p>{(modelFile.size / 1024 / 1024).toFixed(1)} MB</p>
            </> : <>
                <p className='extraBold'>拖拽 .pt 模型文件</p>
                <p>或</p>
                <p className='extraBold'>点击此处选择文件</p>
            </>}
        </div>)
    };

    const renderContent = () => {
        const shouldRenderDropZone = !isLoading && modelSource === ModelSource.UPLOAD;
        const shouldRenderOptions = !isLoading && modelSource === ModelSource.OFFICIAL;
        return (<div className='load-yolo-v5-model-popup'>
            {renderMenu()}
            <div className='right-container'>
                {isLoading && renderLoader()}
                {!isLoading && renderMessage()}
                {shouldRenderOptions && renderOptions()}
                {shouldRenderDropZone && renderDropZone()}
            </div>
        </div>);
    };

    const disableAcceptButton = isLoading ||
        (modelSource === ModelSource.UPLOAD && !modelFile) ||
        (modelSource === ModelSource.OFFICIAL && !selectedVariant);

    const title = modelFamily ? `加载 ${modelFamily.name.split('/')[1]?.toUpperCase() || modelFamily.id} 模型` : '加载模型';

    return (
        <GenericYesNoPopup
            title={title}
            renderContent={renderContent}
            disableAcceptButton={disableAcceptButton}
            acceptLabel={'使用模型'}
            onAccept={onAccept}
            rejectLabel={'返回'}
            onReject={onReject}
        />
    );
}

const mapDispatchToProps = {
    updateActivePopupTypeAction: updateActivePopupType,
    submitNewNotificationAction: submitNewNotification
};

const mapStateToProps = (state: AppState) => ({});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(LoadYOLOv5ModelPopup);
