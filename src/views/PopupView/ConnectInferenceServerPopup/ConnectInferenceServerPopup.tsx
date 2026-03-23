import React, { useState } from 'react';
import { PopupActions } from '../../../logic/actions/PopupActions';
import { AppState } from '../../../store';
import { connect } from 'react-redux';
import { GenericSideMenuPopup } from '../GenericSideMenuPopup/GenericSideMenuPopup';
import { ImageButton } from '../../Common/ImageButton/ImageButton';
import { InferenceServerDataMap } from '../../../data/info/InferenceServerData';
import { InferenceServerType } from '../../../data/enums/InferenceServerType';
import { INotification, NotificationsActionType } from '../../../store/notifications/types';
import { submitNewNotification } from '../../../store/notifications/actionCreators';
import { NotificationUtil } from '../../../utils/NotificationUtil';
import { NotificationsDataMap } from '../../../data/info/NotificationsData';
import { Notification } from '../../../data/enums/Notification';
import './ConnectInferenceServerPopup.scss'
import { StyledTextField } from '../../Common/StyledTextField/StyledTextField';
import { AIActionTypes, RoboflowAPIDetails } from '../../../store/ai/types';
import { RoboflowAPIObjectDetector } from '../../../ai/RoboflowAPIObjectDetector';
import { ClipLoader } from 'react-spinners';
import { CSSHelper } from '../../../logic/helpers/CSSHelper';
import { updateRoboflowAPIDetails } from '../../../store/ai/actionCreators';
import { AIActions } from '../../../logic/actions/AIActions';
import { AIDetectionActions } from '../../../logic/actions/AIDetectionActions';
import { ImageRepository } from '../../../logic/imageRepository/ImageRepository';
import { ImageData } from '../../../store/labels/types';
import { LabelsSelector } from '../../../store/selectors/LabelsSelector';
import { DetectionAPIDetector } from '../../../ai/DetectionAPIDetector';
import { SegmentationAPIDetector } from '../../../ai/SegmentationAPIDetector';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import { FormControl, InputLabel, Select, MenuItem, SelectChangeEvent } from '@mui/material';

interface IProps {
    roboflowAPIDetails: RoboflowAPIDetails;
    submitNewNotificationAction: (notification: INotification) => NotificationsActionType;
    updateRoboflowAPIDetailsAction: (roboflowAPIDetails: RoboflowAPIDetails) => AIActionTypes;
    language: Language;
}

const ConnectInferenceServerPopup: React.FC<IProps> = (
    {
        roboflowAPIDetails,
        submitNewNotificationAction,
        updateRoboflowAPIDetailsAction,
        language
    }
) => {
    const currentTexts = LanguageConfig[language];
    // general
    const [currentServerType, setCurrentServerType] = useState(InferenceServerType.MAKESENSE);
    const [modelIsLoadingStatus, setModelIsLoadingStatus] = useState(false);

    // roboflow
    const [roboflowModel, setRoboflowModel] = useState(roboflowAPIDetails.model);
    const [roboflowKey, setRoboflowKey] = useState(roboflowAPIDetails.key);

    // makesense custom AI
    const [modelServiceUrl, setModelServiceUrl] = useState('');
    const [modelTaskType, setModelTaskType] = useState('detection');
    const [modelApiKey, setModelApiKey] = useState('');

    const wrapServerOnClick = (newServerType: InferenceServerType) => {
        return () => {
            if (!InferenceServerDataMap[newServerType].isDisabled) {
                setCurrentServerType(newServerType)
            } else {
                submitNewNotificationAction(NotificationUtil.createMessageNotification(
                    NotificationsDataMap[Notification.UNSUPPORTED_INFERENCE_SERVER_MESSAGE]));
                return;
            }
        }
    }

    const disableAcceptButton = () => {
        if (modelIsLoadingStatus) return true;

        switch(currentServerType) {
            case InferenceServerType.ROBOFLOW:
                return roboflowModel === '' || roboflowKey === '';
            case InferenceServerType.MAKESENSE:
                return modelServiceUrl === '' || modelTaskType === '';
            default:
                return true;
        }
    }

    const onAccept = () => {
        if (disableAcceptButton()) return;

        if (currentServerType === InferenceServerType.MAKESENSE) {
            // 配置并触发自定义推理服务
            if (modelTaskType === 'detection') {
                DetectionAPIDetector.setConfig({ url: modelServiceUrl, enabled: true });
            } else {
                SegmentationAPIDetector.setConfig({ url: modelServiceUrl, enabled: true });
            }
            PopupActions.close();
            const activeImageData: ImageData = LabelsSelector.getActiveImageData();
            if (modelTaskType === 'detection') {
                AIDetectionActions.detectObjects(activeImageData);
            }
            return;
        }

        // Roboflow
        const onSuccess = () => {
            updateRoboflowAPIDetailsAction({
                status: true,
                model: roboflowModel,
                key: roboflowKey
            })
            PopupActions.close();

            const activeImageData: ImageData = LabelsSelector.getActiveImageData();
            AIActions.detect(activeImageData.id, ImageRepository.getById(activeImageData.id));
        }

        const onFailure = () => {
            submitNewNotificationAction(NotificationUtil.createErrorNotification(
                NotificationsDataMap[Notification.ROBOFLOW_INFERENCE_SERVER_ERROR]));
            setModelIsLoadingStatus(false);
        }

        setModelIsLoadingStatus(true);
        RoboflowAPIObjectDetector.loadModel({
            status: false,
            model: roboflowModel,
            key: roboflowKey
        }, onSuccess, onFailure)
    };

    const onReject = () => {
        PopupActions.close();
    };

    const roboflowModelOnChangeCallback = (event: React.ChangeEvent<HTMLInputElement>) => {
        setRoboflowModel(event.target.value)
    }

    const roboflowKeyOnChangeCallback = (event: React.ChangeEvent<HTMLInputElement>) => {
        setRoboflowKey(event.target.value)
    }

    const modelServiceUrlOnChangeCallback = (event: React.ChangeEvent<HTMLInputElement>) => {
        setModelServiceUrl(event.target.value)
    }

    const modelTaskTypeOnChangeCallback = (event: SelectChangeEvent) => {
        setModelTaskType(event.target.value)
    }

    const modelApiKeyOnChangeCallback = (event: React.ChangeEvent<HTMLInputElement>) => {
        setModelApiKey(event.target.value)
    }

    const renderLoader = () => {
        return(<div className='loader'>
            <ClipLoader
                size={40}
                color={CSSHelper.getLeadingColor()}
                loading={true}
            />
        </div>)
    }

    const renderRoboflow = () => {
        return <>
            <div className='message'>
                {currentTexts.popups.connectServer.roboflowMessage}
            </div>
            <div className='details'>
                <StyledTextField
                    variant='standard'
                    id={'roboflow-model'}
                    autoComplete={'off'}
                    autoFocus={true}
                    type={'text'}
                    margin={'dense'}
                    label={currentTexts.popups.connectServer.roboflowModel}
                    value={roboflowModel}
                    onChange={roboflowModelOnChangeCallback}
                    style={{ width: 280 }}
                    InputLabelProps={{ shrink: true }}
                />
                <StyledTextField
                    variant='standard'
                    id={'roboflow-api- key'}
                    autoComplete={'off'}
                    autoFocus={true}
                    type={'password'}
                    margin={'dense'}
                    label={currentTexts.popups.connectServer.roboflowKey}
                    value={roboflowKey}
                    onChange={roboflowKeyOnChangeCallback}
                    style={{ width: 280 }}
                    InputLabelProps={{ shrink: true }}
                />
            </div>
        </>;
    }

    const renderMakeSense = () => {
        return <>
            <div className='message'>
                {currentTexts.popups.connectServer.customAIMessage}
            </div>
            <div className='details'>
                <StyledTextField
                    variant='standard'
                    id={'model-service-url'}
                    autoComplete={'off'}
                    autoFocus={true}
                    type={'text'}
                    margin={'dense'}
                    label={currentTexts.popups.connectServer.modelServiceUrl}
                    value={modelServiceUrl}
                    onChange={modelServiceUrlOnChangeCallback}
                    style={{ width: 280, marginBottom: 16 }}
                    InputLabelProps={{ shrink: true }}
                    required
                />
                <FormControl variant='standard' style={{ width: 280, marginBottom: 16 }}>
                    <InputLabel id="model-task-type-label">
                        {currentTexts.popups.connectServer.modelTaskType}
                    </InputLabel>
                    <Select
                        labelId="model-task-type-label"
                        id="model-task-type"
                        value={modelTaskType}
                        onChange={modelTaskTypeOnChangeCallback}
                        label={currentTexts.popups.connectServer.modelTaskType}
                    >
                        <MenuItem value="detection">
                            {currentTexts.popups.connectServer.taskTypeDetection}
                        </MenuItem>
                        <MenuItem value="segmentation">
                            {currentTexts.popups.connectServer.taskTypeSegmentation}
                        </MenuItem>
                    </Select>
                </FormControl>
                <StyledTextField
                    variant='standard'
                    id={'model-api-key'}
                    autoComplete={'off'}
                    type={'password'}
                    margin={'dense'}
                    label={currentTexts.popups.connectServer.modelApiKey}
                    value={modelApiKey}
                    onChange={modelApiKeyOnChangeCallback}
                    style={{ width: 280 }}
                    InputLabelProps={{ shrink: true }}
                />
            </div>
        </>;
    }

    const renderContent = (): JSX.Element => {
        if (modelIsLoadingStatus) {
            return renderLoader()
        }
        if (currentServerType === InferenceServerType.ROBOFLOW) {
            return renderRoboflow();
        }
        if (currentServerType === InferenceServerType.MAKESENSE) {
            return renderMakeSense();
        }
        return <div className='load-model-popup-content'/>
    };

    const renderSideMenuContent = (): JSX.Element[] => {
        return Object.entries(InferenceServerDataMap).map(([serverType, serverData], index: number) => {
            return <ImageButton
                key={index}
                image={serverData.imageSrc}
                imageAlt={serverData.imageAlt}
                buttonSize={{width: 40, height: 40}}
                padding={20}
                onClick={wrapServerOnClick(serverType as InferenceServerType)}
                isActive={currentServerType === serverType}
                isDisabled={serverData.isDisabled}
            />
        })
    }

    return (
        <GenericSideMenuPopup
            title={currentTexts.popups.connectServer.title}
            renderContent={renderContent}
            renderSideMenuContent={renderSideMenuContent}
            acceptLabel={currentTexts.popups.connectServer.acceptButton}
            onAccept={onAccept}
            disableAcceptButton={disableAcceptButton()}
            rejectLabel={currentTexts.popups.connectServer.rejectButton}
            onReject={onReject}
        />
    );
}

const mapDispatchToProps = {
    submitNewNotificationAction: submitNewNotification,
    updateRoboflowAPIDetailsAction: updateRoboflowAPIDetails
};

const mapStateToProps = (state: AppState) => ({
    roboflowAPIDetails: state.ai.roboflowAPIDetails,
    language: state.general.language
});

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(ConnectInferenceServerPopup);