import React, { useState, useEffect, useRef } from 'react';
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
import './ModelEnginePopup.scss'
import { StyledTextField } from '../../Common/StyledTextField/StyledTextField';
import { ClipLoader } from 'react-spinners';
import { CSSHelper } from '../../../logic/helpers/CSSHelper';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import { v4 as uuidv4 } from 'uuid';
import { FormControl, InputLabel, Select, MenuItem, SelectChangeEvent } from '@mui/material';
import { getDefaultBackendUrl } from '../../../utils/DefaultBackendUrl';

interface IProps {
    submitNewNotificationAction: (notification: INotification) => NotificationsActionType;
    updateActivePopupTypeAction: (popupType: PopupWindowType | null) => any;
    addAIModelAction: (model: AIModel) => any;
    language: Language;
}

const ModelEnginePopup: React.FC<IProps> = (
    {
        submitNewNotificationAction,
        updateActivePopupTypeAction,
        addAIModelAction,
        language
    }
) => {
    const currentTexts = LanguageConfig[language];
    
    const DEFAULT_API_KEY_BY_TYPE: Record<'detection' | 'segmentation' | 'ocr', string> = {
        detection: '123456',
        segmentation: 'baosight@ABC123!',
        ocr: '',
    };
    const [modelUrl, setModelUrl] = useState('https://api.model.work:58600');
    const [modelType, setModelType] = useState<'detection' | 'segmentation' | 'ocr'>('detection');
    const [apiKey, setApiKey] = useState(DEFAULT_API_KEY_BY_TYPE.detection);
    const [isConnecting, setIsConnecting] = useState(false);
    const [modelTypeOpen, setModelTypeOpen] = useState(false);
    const modelTypeRef = useRef<HTMLDivElement>(null);
    const modelTypeTriggerRef = useRef<HTMLDivElement>(null);
    const [modelTypePos, setModelTypePos] = useState({ top: 0, left: 0, width: 0 });

    useEffect(() => {
        if (!modelTypeOpen) return;
        const handler = (e: MouseEvent) => {
            if (modelTypeRef.current && !modelTypeRef.current.contains(e.target as Node)) {
                setModelTypeOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [modelTypeOpen]);

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
        // modelType 初始化为 'detection' 且只能在两个合法值之间切换,不会为空,只需校验 URL
        return modelUrl.trim() === '';
    }

    const onAccept = async () => {
        if (disableAcceptButton()) return;

        try {
            setIsConnecting(true);
            
            // 模拟集成过程
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const nameMap = {
                detection: language === Language.CHINESE ? '检测引擎' : 'Detection Engine',
                segmentation: language === Language.CHINESE ? '分割引擎' : 'Segmentation Engine',
                ocr: language === Language.CHINESE ? 'OCR 引擎' : 'OCR Engine',
            };
            const defaultName = nameMap[modelType];
            // 创建新的AI模型并添加到状态
            const newModel: AIModel = {
                id: uuidv4(),
                name: defaultName,
                url: modelUrl,
                modelType: modelType,
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
                header: language === Language.CHINESE ? '引擎接入成功' : 'Engine Connected',
                description: language === Language.CHINESE
                    ? `已成功接入推理引擎: ${modelUrl}`
                    : `Successfully connected inference engine: ${modelUrl}`
            }));
            
            // 跳转到AI模型管理页面
            updateActivePopupTypeAction(PopupWindowType.MANAGE_AI_MODELS);
        } catch (error) {
            console.error('Model integration failed:', error);
            submitNewNotificationAction(NotificationUtil.createErrorNotification({
                header: language === Language.CHINESE ? '引擎接入失败' : 'Engine Connection Failed',
                description: language === Language.CHINESE
                    ? '无法连接到指定的推理引擎，请检查地址和网络连接后重试。'
                    : 'Unable to connect to the inference engine. Please check the URL and network connection.'
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
        const newType = event.target.value as 'detection' | 'segmentation' | 'ocr';
        setModelType(newType);
        setApiKey(DEFAULT_API_KEY_BY_TYPE[newType]);
    }

    const apiKeyOnChangeCallback = (event: React.ChangeEvent<HTMLInputElement>) => {
        setApiKey(event.target.value);
    }

    const renderContent = (): JSX.Element => {
        if (isConnecting) {
            return (
                <div className='model-engine-popup-content'>
                    <div className='message'>
                        {language === Language.CHINESE ? '正在接入引擎...' : 'Connecting engine...'}
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
            <div className='model-engine-popup-content'>
                <div className='message'>
                    {currentTexts.popups.modelEngine.integrationMessage}
                </div>
                <div className='details'>
                    <StyledTextField
                        variant='standard'
                        id={'model-url'}
                        autoComplete={'off'}
                        autoFocus={true}
                        type={'text'}
                        margin={'dense'}
                        label={currentTexts.popups.modelEngine.modelUrl}
                        value={modelUrl}
                        onChange={modelUrlOnChangeCallback}
                        style={{ width: '100%', marginBottom: '20px' }}
                        placeholder="http://localhost:8000"
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
                            label={currentTexts.popups.modelEngine.apiKey + (language === Language.CHINESE ? " (可选)" : " (optional)")}
                            value={apiKey}
                            onChange={apiKeyOnChangeCallback}
                            style={{ flex: 6 }}
                            placeholder={language === Language.CHINESE ? "引擎密钥 (可选)" : "Engine Key (optional)"}
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
                            <label style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginBottom: 4, display: 'block' }}>
                                {currentTexts.popups.modelEngine.modelType}
                            </label>
                            <div ref={modelTypeRef} style={{ position: 'relative', width: '100%' }}>
                                <div
                                    ref={modelTypeTriggerRef}
                                    onClick={() => {
                                        if (!modelTypeOpen && modelTypeTriggerRef.current) {
                                            const r = modelTypeTriggerRef.current.getBoundingClientRect();
                                            setModelTypePos({ top: r.bottom + 2, left: r.left, width: r.width });
                                        }
                                        setModelTypeOpen(v => !v);
                                    }}
                                    style={{
                                        width: '100%',
                                        background: 'transparent',
                                        color: 'white',
                                        borderBottom: '1px solid white',
                                        fontSize: 14,
                                        padding: '6px 20px 6px 0',
                                        cursor: 'default',
                                        userSelect: 'none',
                                        boxSizing: 'border-box',
                                        position: 'relative',
                                    }}
                                >
                                    {{ detection: currentTexts.popups.modelEngine.taskTypeDetection,
                                       segmentation: currentTexts.popups.modelEngine.taskTypeSegmentation,
                                       ocr: currentTexts.popups.modelEngine.taskTypeOCR }[modelType]}
                                    <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', fontSize: 9 }}>▼</span>
                                </div>
                                {modelTypeOpen && (
                                    <div style={{
                                        position: 'fixed',
                                        top: modelTypePos.top,
                                        left: modelTypePos.left,
                                        width: modelTypePos.width,
                                        zIndex: 9999,
                                        background: '#2a2a2a',
                                        border: '1px solid #555',
                                        borderRadius: 4,
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                                        overflow: 'hidden',
                                    }}>
                                        {(['detection', 'segmentation', 'ocr'] as const).map(t => (
                                            <div
                                                key={t}
                                                onClick={() => {
                                                    setModelType(t);
                                                    setApiKey(DEFAULT_API_KEY_BY_TYPE[t]);
                                                    setModelTypeOpen(false);
                                                }}
                                                style={{
                                                    padding: '8px 12px',
                                                    fontSize: 13,
                                                    cursor: 'default',
                                                    color: t === modelType ? '#fff' : '#ccc',
                                                    background: t === modelType ? '#c62828' : 'transparent',
                                                }}
                                                onMouseEnter={ev => { if (t !== modelType) (ev.currentTarget as HTMLDivElement).style.background = '#3a3a3a'; }}
                                                onMouseLeave={ev => { if (t !== modelType) (ev.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                                            >
                                                {{ detection: currentTexts.popups.modelEngine.taskTypeDetection,
                                                   segmentation: currentTexts.popups.modelEngine.taskTypeSegmentation,
                                                   ocr: currentTexts.popups.modelEngine.taskTypeOCR }[t]}
                                                {t === modelType ? ' ✓' : ''}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </FormControl>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <GenericYesNoPopup
            title={currentTexts.popups.modelEngine.title}
            renderContent={renderContent}
            acceptLabel={currentTexts.popups.modelEngine.acceptButton}
            onAccept={onAccept}
            disableAcceptButton={disableAcceptButton()}
            rejectLabel={currentTexts.popups.modelEngine.rejectButton}
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
)(ModelEnginePopup);
