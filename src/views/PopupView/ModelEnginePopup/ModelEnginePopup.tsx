import React, { useState, useEffect, useRef } from 'react';
import { PopupActions } from '../../../logic/actions/PopupActions';
import { AppState } from '../../../store';
import { connect } from 'react-redux';
import { GenericYesNoPopup } from '../GenericYesNoPopup/GenericYesNoPopup';
import { INotification, NotificationsActionType } from '../../../store/notifications/types';
import { submitNewNotification } from '../../../store/notifications/actionCreators';
import { updateActivePopupType } from '../../../store/general/actionCreators';
import { addAIModel } from '../../../store/aimodels/actionCreators';
import { AIModel, EngineType } from '../../../store/aimodels/types';
import { NotificationUtil } from '../../../utils/NotificationUtil';
import { PopupWindowType } from '../../../data/enums/PopupWindowType';
import './ModelEnginePopup.scss'
import { StyledTextField } from '../../Common/StyledTextField/StyledTextField';
import { ClipLoader } from 'react-spinners';
import { CSSHelper } from '../../../logic/helpers/CSSHelper';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import { v4 as uuidv4 } from 'uuid';
import { FormControl } from '@mui/material';
import {
    getDefaultCoreServiceBase,
    getDefaultExtensionServiceBase,
    normalizeEngineBaseUrl,
} from '../../../utils/DefaultBackendUrl';

interface IProps {
    submitNewNotificationAction: (notification: INotification) => NotificationsActionType;
    updateActivePopupTypeAction: typeof updateActivePopupType;
    addAIModelAction: typeof addAIModel;
    language: Language;
}

const checkEngineHealth = async (base: string, type: EngineType): Promise<void> => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    try {
        const res = await fetch(type === 'annotation' ? `${base}/status` : `${base}/health`, { signal: ac.signal });
        if (!res.ok) throw new Error(`health ${res.status}`);
        const health = await res.json();
        if (type === 'annotation' && health.available !== true) {
            throw new Error('Sigine OpenSight Platform client is not connected');
        }
        if (health.status && !['ok', 'ready', 'healthy'].includes(health.status)) {
            throw new Error(`backend status: ${health.status}`);
        }
        if (health.engine?.type && health.engine.type !== type) {
            throw new Error(`expected ${type} engine, received ${health.engine.type}`);
        }
    } finally {
        clearTimeout(timer);
    }
};

const ModelEnginePopup: React.FC<IProps> = (
    {
        submitNewNotificationAction,
        updateActivePopupTypeAction,
        addAIModelAction,
        language
    }
) => {
    const currentTexts = LanguageConfig[language];
    
    const DEFAULT_API_KEY_BY_TYPE: Record<EngineType, string> = {
        core: '',
        extension: '',
        annotation: '',
    };
    const defaultUrlByType: Record<EngineType, string> = {
        core: getDefaultCoreServiceBase(),
        extension: getDefaultExtensionServiceBase(),
        annotation: `${getDefaultCoreServiceBase()}/sigine-infra`,
    };
    const [modelUrl, setModelUrl] = useState(defaultUrlByType.core);
    const [modelType, setModelType] = useState<EngineType>('core');
    const [apiKey, setApiKey] = useState(DEFAULT_API_KEY_BY_TYPE.core);
    const [isConnecting, setIsConnecting] = useState(false);
    const [modelTypeOpen, setModelTypeOpen] = useState(false);
    const modelTypeRef = useRef<HTMLDivElement>(null);
    const modelTypeTriggerRef = useRef<HTMLDivElement>(null);
    const [modelTypePos, setModelTypePos] = useState({ top: 0, left: 0, width: 0 });

    const onReject = () => {
        PopupActions.close();
    };

    useEffect(() => {
        if (!modelTypeOpen) return undefined;
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
        // The annotation engine uses a server-side Sigine profile connection.
        return modelUrl.trim() === '';
    }

    const onAccept = async () => {
        if (disableAcceptButton()) return;

        try {
            setIsConnecting(true);
            
            const base = modelType === 'annotation' ? defaultUrlByType.annotation : normalizeEngineBaseUrl(modelUrl, modelType);
            await checkEngineHealth(base, modelType);

            const nameMap: Record<EngineType, string> = {
                core: language === Language.CHINESE ? '核心引擎' : 'Core Engine',
                extension: language === Language.CHINESE ? '拓展引擎' : 'Extension Engine',
                annotation: language === Language.CHINESE ? '自动标注' : 'Auto Annotation',
            };
            const defaultName = nameMap[modelType];
            // 创建新的AI模型并添加到状态
            const newModel: AIModel = {
                id: uuidv4(),
                name: defaultName,
                url: base,
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
                description: modelType === 'annotation'
                    ? (language === Language.CHINESE ? '请先在 Sigine 的 OpenSight Platform 客户端点击“打开平台”，完成 API 连接。' : 'Open the OpenSight Platform client in Sigine to connect its API first.')
                    : language === Language.CHINESE
                        ? '无法连接到指定的推理引擎，请检查地址和网络连接后重试。'
                        : 'Unable to connect to the inference engine. Please check the URL and network connection.'
            }));
        } finally {
            setIsConnecting(false);
        }
    };

    const modelUrlOnChangeCallback = (event: React.ChangeEvent<HTMLInputElement>) => {
        setModelUrl(event.target.value);
    }

    const selectEngineType = (newType: EngineType) => {
        const oldDefault = defaultUrlByType[modelType];
        setModelType(newType);
        setApiKey(DEFAULT_API_KEY_BY_TYPE[newType]);
        setModelUrl(current => current === oldDefault ? defaultUrlByType[newType] : current);
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
                    {modelType === 'annotation'
                        ? (language === Language.CHINESE
                            ? '通过 Sigine 的 OpenSight Platform 客户端连接视觉模型，用于自动标注复审。'
                            : 'Connect vision models through the OpenSight Platform client in Sigine for annotation review.')
                        : currentTexts.popups.modelEngine.integrationMessage}
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
                        InputProps={{ readOnly: modelType === 'annotation' }}
                        style={{ width: '100%', marginBottom: '20px' }}
                        placeholder={defaultUrlByType[modelType]}
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
                    {modelType === 'annotation' && <p style={{fontSize: 12, color: '#aaa', margin: '0 0 12px'}}>
                        {language === Language.CHINESE ? '使用 Sigine 中的 OpenSight Platform 客户端连接；凭据由 OpenSight 后端保存。' : 'Connect using the OpenSight Platform client in Sigine. Credentials stay on the OpenSight backend.'}
                    </p>}
                    <div style={{ display: 'flex', gap: '16px', width: '100%', alignItems: 'flex-end' }}>
                        {modelType !== 'annotation' && <StyledTextField
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
                        />}
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
                                    {{ core: currentTexts.popups.modelEngine.taskTypeCore,
                                       extension: currentTexts.popups.modelEngine.taskTypeExtension,
                                       annotation: language === Language.CHINESE ? '自动标注' : 'Auto Annotation' }[modelType]}
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
                                        {(['core', 'extension', 'annotation'] as const).map(t => (
                                            <div
                                                key={t}
                                                onClick={() => {
                                                    selectEngineType(t);
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
                                                {{ core: currentTexts.popups.modelEngine.taskTypeCore,
                                                   extension: currentTexts.popups.modelEngine.taskTypeExtension,
                                                   annotation: language === Language.CHINESE ? '自动标注' : 'Auto Annotation' }[t]}
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
