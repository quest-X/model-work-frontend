import React, { useState, useEffect } from 'react';
import { PopupActions } from '../../../logic/actions/PopupActions';
import { AppState } from '../../../store';
import { connect } from 'react-redux';
import { GenericYesNoPopup } from '../GenericYesNoPopup/GenericYesNoPopup';
import { INotification, NotificationsActionType } from '../../../store/notifications/types';
import { submitNewNotification } from '../../../store/notifications/actionCreators';
import { updateActivePopupType } from '../../../store/general/actionCreators';
import { addAIModel } from '../../../store/aimodels/actionCreators';
import { AIModel } from '../../../store/aimodels/types';
import { NotificationUtil } from '../../../utils/NotificationUtil';
import { NotificationsDataMap } from '../../../data/info/NotificationsData';
import { Notification } from '../../../data/enums/Notification';
import { PopupWindowType } from '../../../data/enums/PopupWindowType';
import './IntegrateModelPopup.scss'
import { StyledTextField } from '../../Common/StyledTextField/StyledTextField';
import { ClipLoader } from 'react-spinners';
import { CSSHelper } from '../../../logic/helpers/CSSHelper';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import { v4 as uuidv4 } from 'uuid';
import { FormControl, InputLabel, Select, MenuItem, SelectChangeEvent } from '@mui/material';

interface IProps {
    submitNewNotificationAction: (notification: INotification) => NotificationsActionType;
    updateActivePopupTypeAction: (popupType: PopupWindowType | null) => any;
    addAIModelAction: (model: AIModel) => any;
    language: Language;
}

const IntegrateModelPopup: React.FC<IProps> = (
    {
        submitNewNotificationAction,
        updateActivePopupTypeAction,
        addAIModelAction,
        language
    }
) => {
    const currentTexts = LanguageConfig[language];
    
    const [modelUrl, setModelUrl] = useState('');
    const [modelType, setModelType] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [isConnecting, setIsConnecting] = useState(false);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onReject();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const disableAcceptButton = () => {
        if (isConnecting) return true;
        return modelUrl.trim() === '' || modelType === ''; // 模型服务地址和模型类型都是必选的
    }

    const onAccept = async () => {
        if (disableAcceptButton()) return;

        try {
            setIsConnecting(true);
            
            // 模拟集成过程
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 创建新的AI模型并添加到状态
            const newModel: AIModel = {
                id: uuidv4(),
                name: `AI Model ${new Date().toLocaleDateString()}`, // 默认名称
                url: modelUrl,
                modelType: modelType as 'detection' | 'segmentation' | 'retrieval',
                apiKey: apiKey.trim() || undefined,
                description: undefined,
                createdAt: new Date(),
                isActive: true
            };

            // 保存到状态
            addAIModelAction(newModel);
            console.log('AI Model integrated:', newModel);
            
            // 显示成功通知
            submitNewNotificationAction(NotificationUtil.createSuccessNotification({
                header: language === Language.CHINESE ? '模型接入成功' : 'Model Integration Successful',
                description: language === Language.CHINESE 
                    ? `已成功接入模型服务: ${modelUrl}`
                    : `Successfully integrated model service: ${modelUrl}`
            }));
            
            // 跳转到AI模型管理页面
            updateActivePopupTypeAction(PopupWindowType.MANAGE_AI_MODELS);
        } catch (error) {
            console.error('Model integration failed:', error);
            submitNewNotificationAction(NotificationUtil.createErrorNotification({
                header: language === Language.CHINESE ? '模型接入失败' : 'Model Integration Failed',
                description: language === Language.CHINESE 
                    ? '无法连接到指定的模型服务，请检查服务地址和网络连接后重试。'
                    : 'Unable to connect to the specified model service. Please check the service URL and network connection.'
            }));
        } finally {
            setIsConnecting(false);
        }
    };

    const onReject = () => {
        PopupActions.close();
    };

    const modelUrlOnChangeCallback = (event: React.ChangeEvent<HTMLInputElement>) => {
        setModelUrl(event.target.value);
    }

    const modelTypeOnChangeCallback = (event: SelectChangeEvent) => {
        setModelType(event.target.value);
    }

    const apiKeyOnChangeCallback = (event: React.ChangeEvent<HTMLInputElement>) => {
        setApiKey(event.target.value);
    }

    const renderContent = (): JSX.Element => {
        if (isConnecting) {
            return (
                <div className='integrate-model-popup-content'>
                    <div className='message'>
                        {language === Language.CHINESE ? '正在接入模型...' : 'Integrating model...'}
                    </div>
                    <div className='loader'>
                        <ClipLoader
                            size={40}
                            color={CSSHelper.getLeadingColor()}
                            loading={true}
                        />
                    </div>
                </div>
            );
        }

        return (
            <div className='integrate-model-popup-content'>
                <div className='message'>
                    {currentTexts.popups.integrateModel.integrationMessage}
                </div>
                <div className='details'>
                    <StyledTextField
                        variant='standard'
                        id={'model-url'}
                        autoComplete={'off'}
                        autoFocus={true}
                        type={'text'}
                        margin={'dense'}
                        label={currentTexts.popups.integrateModel.modelUrl}
                        value={modelUrl}
                        onChange={modelUrlOnChangeCallback}
                        style={{ width: '100%', marginBottom: '20px' }}
                        placeholder="https://api.example.com/model"
                        InputLabelProps={{ shrink: true }}
                        sx={{
                            '& .MuiInputBase-input': {
                                fontSize: '1.1rem'
                            },
                            '& .MuiInputLabel-root': {
                                fontSize: '1.1rem'
                            },
                            '& .MuiInputLabel-root.MuiInputLabel-shrink': {
                                fontSize: '0.85rem'
                            },
                            '& .MuiInput-underline:hover:not(.Mui-disabled):before': {
                                borderBottomColor: '#009AFF !important'
                            }
                        }}
                    />
                    <div style={{ display: 'flex', gap: '16px', width: '100%', alignItems: 'flex-end' }}>
                        <StyledTextField
                            variant='standard'
                            id={'api-key'}
                            autoComplete={'off'}
                            type={'password'}
                            margin={'dense'}
                            label={currentTexts.popups.integrateModel.apiKey + (language === Language.CHINESE ? " (可选)" : " (optional)")}
                            value={apiKey}
                            onChange={apiKeyOnChangeCallback}
                            style={{ flex: 6 }}
                            placeholder={language === Language.CHINESE ? "模型密钥 (可选)" : "Model Key (optional)"}
                            InputLabelProps={{ shrink: true }}
                            sx={{
                                '& .MuiInputBase-input': {
                                    fontSize: '1.1rem'
                                },
                                '& .MuiInputLabel-root': {
                                    fontSize: '1.1rem'
                                },
                                '& .MuiInputLabel-root.MuiInputLabel-shrink': {
                                    fontSize: '0.85rem'
                                },
                                '& .MuiInput-underline:hover:not(.Mui-disabled):before': {
                                    borderBottomColor: '#009AFF !important'
                                }
                            }}
                        />
                        <FormControl 
                            variant='standard' 
                            style={{ flex: 4 }} 
                            margin='dense'
                            sx={{
                                '& .MuiInputLabel-root': {
                                    color: 'white',
                                    fontSize: '1.1rem !important'
                                },
                                '& .MuiInputLabel-root.Mui-focused': {
                                    color: '#009AFF',
                                    fontSize: '0.85rem !important'
                                },
                                '& .MuiInputLabel-root.MuiInputLabel-shrink': {
                                    fontSize: '0.85rem !important'
                                },
                                '& .MuiSelect-select': {
                                    fontSize: '1.1rem'
                                },
                                '& .MuiInput-underline:before': {
                                    borderBottomColor: 'white'
                                },
                                '& .MuiInput-underline:hover:not(.Mui-disabled):before': {
                                    borderBottomColor: '#009AFF !important'
                                },
                                '& .MuiInput-underline:after': {
                                    borderBottomColor: '#009AFF'
                                }
                            }}
                        >
                            <InputLabel 
                                id="model-type-label"
                                shrink={true}
                            >
                                {currentTexts.popups.integrateModel.modelType}
                            </InputLabel>
                            <Select
                                labelId="model-type-label"
                                id="model-type"
                                value={modelType}
                                onChange={modelTypeOnChangeCallback}
                                label={currentTexts.popups.integrateModel.modelType}
                                sx={{
                                    color: 'white',
                                    '& .MuiSelect-icon': {
                                        color: 'white'
                                    }
                                }}
                            >
                                <MenuItem value="detection">
                                    {currentTexts.popups.integrateModel.taskTypeDetection}
                                </MenuItem>
                                <MenuItem value="segmentation">
                                    {currentTexts.popups.integrateModel.taskTypeSegmentation}
                                </MenuItem>
                                <MenuItem value="retrieval">
                                    {currentTexts.popups.integrateModel.taskTypeRetrieval}
                                </MenuItem>
                            </Select>
                        </FormControl>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <GenericYesNoPopup
            title={currentTexts.popups.integrateModel.title}
            renderContent={renderContent}
            acceptLabel={currentTexts.popups.integrateModel.acceptButton}
            onAccept={onAccept}
            disableAcceptButton={disableAcceptButton()}
            rejectLabel={currentTexts.popups.integrateModel.rejectButton}
            onReject={onReject}
        />
    );
}

const mapDispatchToProps = {
    submitNewNotificationAction: submitNewNotification,
    updateActivePopupTypeAction: updateActivePopupType,
    addAIModelAction: addAIModel
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(IntegrateModelPopup);
