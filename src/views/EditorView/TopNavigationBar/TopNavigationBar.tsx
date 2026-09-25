import React, {useState, useEffect, useRef} from 'react';
import './TopNavigationBar.scss';
import StateBar from '../StateBar/StateBar';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {updateActivePopupType, updateProjectData, updateLanguage} from '../../../store/general/actionCreators';
import {ProjectData} from '../../../store/general/types';
import DropDownMenu from './DropDownMenu/DropDownMenu';
import {TextButton} from '../../Common/TextButton/TextButton';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {QueueDataSyncStatus, QueueItem} from '../../../store/queue/types';
import {updateQueueItem} from '../../../store/queue/actionCreators';
import {getEngineBaseUrl, getExtensionEngineBaseUrl} from '../../../utils/DefaultBackendUrl';
import {AUTH_PREVIEW_SIGN_OUT_EVENT} from '../../AuthPreview/AuthPreview';
import {
    ACCOUNT_SESSION_CHANGED, AccountUser, currentAccountSession,
} from '../../../services/AccountService';
import {AccountCenter} from '../../AccountCenter/AccountCenter';
import {useEscapeToClose} from '../../../hooks/useEscapeToClose';
import {version as appVersion} from '../../../../package.json';
import {isPopupAvailable} from '../../../utils/PopupAvailability';

declare const __OPENSIGHT_SHANGANG_RIZHAO_COMMERCIAL__: boolean;

interface IProps {
    updateActivePopupTypeAction: typeof updateActivePopupType;
    updateProjectDataAction: typeof updateProjectData;
    updateLanguageAction: typeof updateLanguage;
    updateQueueItemAction: typeof updateQueueItem;
    projectData: ProjectData;
    queueItems: QueueItem[];
    activeQueueItemId: string | null;
    language: Language;
    hasCoreEngine: boolean;
    hasExtensionEngine: boolean;
    platformMode?: 'annotation' | 'control';
    onPlatformSwitch?: () => void;
    commercialRestricted?: boolean;
}

type ServicesDropdown = 'core' | 'extension' | null;

// Top navigation intentionally owns its mutually exclusive menus and platform mode.
// eslint-disable-next-line complexity
export const TopNavigationBar: React.FC<IProps> = (props) => {
    const currentTexts = LanguageConfig[props.language];
    const controlMode = props.platformMode === 'control';
    const commercialRestricted = props.commercialRestricted ?? (
        typeof __OPENSIGHT_SHANGANG_RIZHAO_COMMERCIAL__ !== 'undefined'
        && __OPENSIGHT_SHANGANG_RIZHAO_COMMERCIAL__
    );
    const productionSwitchDisabled = commercialRestricted && controlMode;
    const unavailableTitle = props.language === Language.CHINESE ? '暂未开放' : 'Not available yet';
    const serviceButtonProps = (popup: PopupWindowType, divider = false) => {
        const disabled = !isPopupAvailable(popup, commercialRestricted);
        return {
            className: `DropDownMenuContentOption ${disabled ? 'disabled' : 'active'}${divider ? ' divider' : ''}`,
            disabled,
            title: disabled ? unavailableTitle : undefined,
        };
    };
    const projectName = commercialRestricted ? '山东钢铁-宝信自动化视觉组' : props.projectData.name;
    const [showActionsDropdown, setShowActionsDropdown] = useState(false);
    const [showAccountDropdown, setShowAccountDropdown] = useState(false);
    const [showAboutUs, setShowAboutUs] = useState(false);
    const [showOperationManual, setShowOperationManual] = useState(false);
    const [showAccountCenter, setShowAccountCenter] = useState<boolean | null>(
        () => currentAccountSession()?.user.password_change_required ? true : null,
    );
    const [account, setAccount] = useState<AccountUser | null>(() => currentAccountSession()?.user || null);
    const [activeServicesDropdown, setActiveServicesDropdown] = useState<ServicesDropdown>(null);
    const [cameraConnectAvailable, setCameraConnectAvailable] = useState(false);
    const [computeClusterAvailable, setComputeClusterAvailable] = useState(false);
    const extensionEngineBaseUrl = getExtensionEngineBaseUrl();
    const accountAvatar = account?.avatar_url || '';
    const accountAvatarText = account?.role === 'admin' ? '管' : (account?.display_name?.[0] || 'A').toUpperCase();
    const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeQueueItem = props.queueItems.find(item => item.id === props.activeQueueItemId);
    const localChangeCount = props.queueItems.filter(
        item => item.dataSyncStatus === QueueDataSyncStatus.DIRTY,
    ).length;
    const localChangeDescription = props.language === Language.CHINESE
        ? `${localChangeCount} 个本地变动待处理`
        : `${localChangeCount} local ${localChangeCount === 1 ? 'change' : 'changes'} pending`;
    const zh = props.language === Language.CHINESE;
    useEscapeToClose(() => setShowAboutUs(false), showAboutUs, 20);
    useEscapeToClose(() => setShowOperationManual(false), showOperationManual, 20);

    const onFocus = (event: React.FocusEvent<HTMLInputElement>) => {
        event.target.setSelectionRange(0, event.target.value.length);
    };

    const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
            .toLowerCase()
            .replace(' ', '-');

        props.updateProjectDataAction({
            ...props.projectData,
            name: value
        });
    };

    useEffect(() => {
        const cleanName = props.projectData.name.trim();
        if (!activeQueueItem || !cleanName) return undefined;
        if (activeQueueItem.name !== cleanName) {
            props.updateQueueItemAction(activeQueueItem.id, {name: cleanName});
        }

        const datasetId = activeQueueItem.datasetId;
        if (!datasetId) return undefined;
        renameTimerRef.current = setTimeout(() => {
            renameTimerRef.current = null;
            fetch(`${getEngineBaseUrl()}/datasets/${encodeURIComponent(datasetId)}`, {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name: cleanName, project_name: cleanName}),
            }).then(response => {
                if (!response.ok) throw new Error(`${response.status}`);
                window.dispatchEvent(new CustomEvent('opensight:data-center-updated', {
                    detail: {datasetId, queueItemId: activeQueueItem.id},
                }));
            }).catch(error => {
                console.warn('[ProjectRename] Failed to rename server dataset', error);
            });
        }, 500);
        return () => {
            if (renameTimerRef.current !== null) {
                clearTimeout(renameTimerRef.current);
                renameTimerRef.current = null;
            }
        };
    }, [
        props.projectData.name,
        activeQueueItem?.id,
        activeQueueItem?.name,
        activeQueueItem?.datasetId,
        props.updateQueueItemAction,
    ]);

    const showKeyboardShortcuts = () => props.updateActivePopupTypeAction(PopupWindowType.KEYBOARD_SHORTCUTS)

    const toggleServicesDropdown = (dropdown: Exclude<ServicesDropdown, null>) => {
        setShowActionsDropdown(false);
        setShowAccountDropdown(false);
        setActiveServicesDropdown((activeDropdown) => activeDropdown === dropdown ? null : dropdown);
    };

    // 「调用模型」按钮：打开本地模型挑选 / 加载弹窗
    const openLocalModelManager = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.CALL_MODEL);
    };

    const openDataCenter = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.DATA_CENTER);
    };

    const openTrainingTask = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.TRAINING_TASK);
    };

    const openTaskCenter = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.TASK_CENTER);
    };

    const openVectorDb = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.VECTOR_DB);
    };

    const openL2gRetrieval = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.L2G_RETRIEVAL);
    };

    const openModelInspector = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.MODEL_INSPECTOR);
    };

    const openCameraConnect = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.CAMERA_CONNECT);
    };

    const openComputeCluster = () => {
        setActiveServicesDropdown(null);
        props.updateActivePopupTypeAction(PopupWindowType.COMPUTE_CLUSTER);
    };

    useEffect(() => {
        if (!props.hasExtensionEngine) {
            setCameraConnectAvailable(false);
            setComputeClusterAvailable(false);
            return undefined;
        }
        const controller = new AbortController();
        fetch(`${extensionEngineBaseUrl}/health`, {signal: controller.signal})
            .then(response => response.ok ? response.json() : Promise.reject(new Error(`${response.status}`)))
            .then(health => {
                const plugin = health?.plugins?.camera_connect;
                setCameraConnectAvailable(Boolean(plugin?.enabled && plugin?.state === 'ready'));
                const computeCluster = health?.plugins?.compute_cluster;
                setComputeClusterAvailable(Boolean(computeCluster?.enabled && computeCluster?.state === 'ready'));
            })
            .catch(error => {
                if (error?.name !== 'AbortError') {
                    setCameraConnectAvailable(false);
                    setComputeClusterAvailable(false);
                }
            });
        return () => controller.abort();
    }, [props.hasExtensionEngine, extensionEngineBaseUrl, activeServicesDropdown]);

    const toggleLanguage = () => {
        const newLanguage = props.language === Language.CHINESE ? Language.ENGLISH : Language.CHINESE;
        props.updateLanguageAction(newLanguage);
    };

    const toggleActionsDropdown = () => {
        setActiveServicesDropdown(null);
        setShowAccountDropdown(false);
        setShowActionsDropdown(!showActionsDropdown);
    };

    const toggleAccountDropdown = () => {
        setShowActionsDropdown(false);
        setActiveServicesDropdown(null);
        setShowAccountDropdown(open => !open);
    };

    useEffect(() => {
        const update = () => {
            const user = currentAccountSession()?.user || null;
            setAccount(user);
            if (user?.password_change_required) setShowAccountCenter(true);
        };
        window.addEventListener(ACCOUNT_SESSION_CHANGED, update);
        return () => window.removeEventListener(ACCOUNT_SESSION_CHANGED, update);
    }, []);

    // 点击外部关闭下拉菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Element;
            if (!target.closest('.ActionsDropdownContainer')) {
                setShowActionsDropdown(false);
            }
        };

        if (showActionsDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showActionsDropdown]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Element;
            if (!target.closest('.ServicesDropdownContainer')) {
                setActiveServicesDropdown(null);
            }
        };

        if (activeServicesDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [activeServicesDropdown]);

    useEffect(() => {
        const closeAccountDropdown = (event: MouseEvent | KeyboardEvent) => {
            if (
                event instanceof KeyboardEvent
                    ? event.key === 'Escape'
                    : !(event.target as Element).closest('.AccountDropdownContainer')
            ) {
                setShowAccountDropdown(false);
            }
        };

        if (showAccountDropdown) {
            document.addEventListener('mousedown', closeAccountDropdown);
            document.addEventListener('keydown', closeAccountDropdown);
        }

        return () => {
            document.removeEventListener('mousedown', closeAccountDropdown);
            document.removeEventListener('keydown', closeAccountDropdown);
        };
    }, [showAccountDropdown]);

    return (
        <div className='TopNavigationBar'>
            <StateBar/>
            <div className='TopNavigationBarWrapper'>
                <div className='NavigationBarGroupWrapper left'>
                    <div
                        className='Header'
                        onClick={showKeyboardShortcuts}
                    >
                        <img
                            draggable={false}
                            alt={'make-sense'}
                            src={'/make-sense-ico-transparent.png'}
                        />
                        {currentTexts.makeSense}
                    </div>
                    <div className='ActionsDropdownContainer'>
                        <TextButton
                            label={currentTexts.actions.title}
                            onClick={toggleActionsDropdown}
                            externalClassName={'actions-button'}
                        />
                        {showActionsDropdown && <DropDownMenu
                            language={props.language}
                            isVisible={true}
                            forceDisabled={commercialRestricted}
                            allowEngineManagement={commercialRestricted}
                        />}
                    </div>
                    {props.hasCoreEngine && (
                        <div className='ServicesDropdownContainer'>
                            <TextButton
                                label={currentTexts.modelManagement.coreServices}
                                onClick={() => toggleServicesDropdown('core')}
                                externalClassName={'services-button'}
                            />
                            {localChangeCount > 0 && (
                                <span
                                    className='ServicesChangeBadge'
                                    role='status'
                                    aria-label={localChangeDescription}
                                    title={localChangeDescription}
                                >
                                    {localChangeCount}
                                </span>
                            )}
                            {activeServicesDropdown === 'core' && (
                                <div className='DropDownMenuContent ServicesDropdown'>
                                    <button type='button'
                                        {...serviceButtonProps(PopupWindowType.DATA_CENTER)}
                                        onClick={openDataCenter}>
                                        <div className='Marker'/>
                                        <img src='ico/api.png' alt='data-center'/>
                                        <span className='ServicesOptionLabel'>
                                            {currentTexts.modelManagement.dataCenter}
                                        </span>
                                        {localChangeCount > 0 && (
                                            <span
                                                className='ServicesOptionChangeBadge'
                                                role='status'
                                                aria-label={localChangeDescription}
                                                title={localChangeDescription}
                                            >
                                                {localChangeCount}
                                            </span>
                                        )}
                                    </button>
                                    <button type='button'
                                        {...serviceButtonProps(PopupWindowType.CALL_MODEL)}
                                        onClick={openLocalModelManager}>
                                        <div className='Marker'/>
                                        <img src='ico/ai.png' alt='local-models'/>
                                        {currentTexts.modelManagement.callModels}
                                    </button>
                                    <button type='button'
                                        {...serviceButtonProps(PopupWindowType.TRAINING_TASK)}
                                        onClick={openTrainingTask}>
                                        <div className='Marker'/>
                                        <img src='ico/ai.png' alt='training-task'/>
                                        {currentTexts.modelManagement.trainingTask}
                                    </button>
                                    <button type='button'
                                        {...serviceButtonProps(PopupWindowType.TASK_CENTER)}
                                        onClick={openTaskCenter}>
                                        <div className='Marker'/>
                                        <img src='ico/tasks.png' alt='task-center'/>
                                        {currentTexts.modelManagement.taskCenter}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                    {props.hasExtensionEngine && (
                        <div className='ServicesDropdownContainer'>
                            <TextButton
                                label={currentTexts.modelManagement.extensionServices}
                                onClick={() => toggleServicesDropdown('extension')}
                                externalClassName={'services-button'}
                            />
                            {activeServicesDropdown === 'extension' && (
                                <div className='DropDownMenuContent ServicesDropdown'>
                                    <button type='button'
                                        {...serviceButtonProps(PopupWindowType.VECTOR_DB)}
                                        onClick={openVectorDb}>
                                        <div className='Marker'/>
                                        <img src='ico/api.png' alt='vector-db'/>
                                        {currentTexts.modelManagement.vectorDb}
                                    </button>
                                    <button type='button'
                                        {...serviceButtonProps(PopupWindowType.L2G_RETRIEVAL)}
                                        onClick={openL2gRetrieval}>
                                        <div className='Marker'/>
                                        <img src='ico/ai.png' alt='l2g-retrieval'/>
                                        {currentTexts.modelManagement.l2gRetrieval}
                                    </button>
                                    <button type='button'
                                        {...serviceButtonProps(PopupWindowType.MODEL_INSPECTOR, cameraConnectAvailable || computeClusterAvailable)}
                                        onClick={openModelInspector}>
                                        <div className='Marker'/>
                                        <img src='ico/eye.png' alt='model-inspector'/>
                                        {currentTexts.modelManagement.modelInspector}
                                    </button>
                                    {cameraConnectAvailable && <button type='button'
                                        className='DropDownMenuContentOption active'
                                        onClick={openCameraConnect}>
                                        <div className='Marker'/>
                                        <img src='ico/camera.png' alt='camera-connect'/>
                                        {currentTexts.modelManagement.cameraConnect}
                                    </button>}
                                    {computeClusterAvailable && <button type='button'
                                        className='DropDownMenuContentOption active'
                                        onClick={openComputeCluster}>
                                        <div className='Marker'/>
                                        <img src='ico/tasks.png' alt='compute-cluster'/>
                                        {currentTexts.modelManagement.computeCluster}
                                    </button>}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <div
                    className='ProjectNameContainer'
                >
                    <div className='ProjectName'>{currentTexts.projectName}</div>
                    <div
                        className='ProjectNameInputWrapper'
                        data-value={projectName}
                    >
                        <input
                            type='text'
                            size={1}
                            value={projectName}
                            disabled={commercialRestricted}
                            onChange={commercialRestricted ? undefined : onChange}
                            onFocus={commercialRestricted ? undefined : onFocus}
                        />
                    </div>
                </div>
                <div className='NavigationBarGroupWrapper right'>
                    <TextButton
                        label={currentTexts.languageToggle}
                        onClick={toggleLanguage}
                        externalClassName={'language-toggle-button'}
                    />
                    <div className='AccountDropdownContainer'>
                        <button
                            type='button'
                            className='AccountAvatarButton'
                            aria-label={currentTexts.account.openMenu}
                            aria-haspopup='menu'
                            aria-expanded={showAccountDropdown}
                            onClick={toggleAccountDropdown}
                        >
                            {accountAvatar ? <img src={accountAvatar} alt=''/> : accountAvatarText}
                        </button>
                        {showAccountDropdown && <div
                            className='AccountDropdown'
                            role='menu'
                            aria-label={currentTexts.account.menuLabel}
                        >
                            <button
                                type='button'
                                role='menuitem'
                                className='AccountSummary'
                                onClick={() => {
                                    setShowAccountDropdown(false);
                                    setShowAccountCenter(true);
                                }}
                            >
                                <span className='AccountSummaryAvatar'>
                                    {accountAvatar ? <img src={accountAvatar} alt=''/> : accountAvatarText}
                                </span>
                                <span className='AccountSummaryText'>
                                    <strong>{account?.display_name || currentTexts.account.displayName}</strong>
                                    <small>{account?.role === 'admin' ? currentTexts.account.role : account?.username}</small>
                                </span>
                            </button>
                            <div className='AccountMenuDivider'/>
                            <button
                                type='button'
                                role='menuitem'
                                className='AccountMenuItem'
                                disabled={productionSwitchDisabled}
                                title={productionSwitchDisabled ? unavailableTitle : undefined}
                                onClick={() => {
                                    setShowAccountDropdown(false);
                                    props.onPlatformSwitch?.();
                                }}
                            >
                                <img src='/ico/api.png' alt=''/>
                                {controlMode
                                    ? currentTexts.account.switchToAnnotationPlatform
                                    : currentTexts.account.switchToControlPlatform}
                            </button>
                            {commercialRestricted && <button
                                type='button'
                                role='menuitem'
                                className='AccountMenuItem'
                                onClick={() => {
                                    setShowAccountDropdown(false);
                                    setShowOperationManual(true);
                                }}
                            >
                                <img src='/ico/documentation.png' alt=''/>
                                {zh ? '操作手册' : 'User guide'}
                            </button>}
                            {commercialRestricted && <button
                                type='button'
                                role='menuitem'
                                className='AccountMenuItem'
                                onClick={() => {
                                    setShowAccountDropdown(false);
                                    setShowAboutUs(true);
                                }}
                            >
                                <img src='/ico/make-sense-ico-transparent.png' alt=''/>
                                {zh ? '关于我们' : 'About us'}
                            </button>}
                            <button
                                type='button'
                                role='menuitem'
                                className='AccountMenuItem AccountMenuItemDanger'
                                onClick={() => {
                                    setShowAccountDropdown(false);
                                    window.dispatchEvent(new Event(AUTH_PREVIEW_SIGN_OUT_EVENT));
                                }}
                            >
                                <img src='/ico/right.png' alt=''/>
                                {currentTexts.account.signOut}
                            </button>
                        </div>}
                    </div>
                </div>
            </div>
            {showAccountCenter !== null && account && <AccountCenter
                user={account}
                zh={props.language === Language.CHINESE}
                open={showAccountCenter}
                onClose={() => setShowAccountCenter(false)}
                onUserChanged={setAccount}
            />}
            {showAboutUs && <div
                className='AboutUsBackdrop'
                role='presentation'
                onMouseDown={event => {
                    if (event.target === event.currentTarget) setShowAboutUs(false);
                }}
            >
                <section
                    className='AboutUsDialog'
                    role='dialog'
                    aria-modal='true'
                    aria-label={zh ? '关于我们' : 'About us'}
                >
                    <button
                        type='button'
                        className='AboutUsClose'
                        aria-label={zh ? '关闭关于我们' : 'Close about us'}
                        onClick={() => setShowAboutUs(false)}
                    >
                        <img src='/ico/close.png' alt=''/>
                    </button>
                    <div className='AboutUsHero'>
                        <img src='/make-sense-ico-transparent.png' alt=''/>
                        <div>
                            <small>OPENSIGHT PLATFORM</small>
                            <h2>{zh ? '山东钢铁-宝信自动化视觉组' : 'Shandong Steel - Baosight Automation Vision Team'}</h2>
                            <p>{zh
                                ? '面向工业现场的智能视觉与边缘计算平台'
                                : 'Industrial vision and edge computing platform'}</p>
                        </div>
                    </div>
                    <dl className='AboutUsDetails'>
                        <div>
                            <dt>{zh ? '平台' : 'Platform'}</dt>
                            <dd>OpenSight Platform</dd>
                        </div>
                        <div>
                            <dt>{zh ? '服务场景' : 'Capabilities'}</dt>
                            <dd>{zh
                                ? '视觉识别 · 边缘设备管理 · 计算群协同'
                                : 'Visual recognition · Edge device management · Cluster coordination'}</dd>
                        </div>
                        <div>
                            <dt>{zh ? '版本' : 'Version'}</dt>
                            <dd>v{appVersion}</dd>
                        </div>
                    </dl>
                </section>
            </div>}
            {showOperationManual && <div
                className='AboutUsBackdrop'
                role='presentation'
                onMouseDown={event => {
                    if (event.target === event.currentTarget) setShowOperationManual(false);
                }}
            >
                <section
                    className='AboutUsDialog OperationManualDialog'
                    role='dialog'
                    aria-modal='true'
                    aria-label={zh ? '操作手册' : 'User guide'}
                >
                    <button
                        type='button'
                        className='AboutUsClose'
                        aria-label={zh ? '关闭操作手册' : 'Close user guide'}
                        onClick={() => setShowOperationManual(false)}
                    >
                        <img src='/ico/close.png' alt=''/>
                    </button>
                    <div className='AboutUsHero'>
                        <img src='/ico/documentation.png' alt=''/>
                        <div>
                            <small>OPENSIGHT PLATFORM</small>
                            <h2>{zh ? '操作手册' : 'User guide'}</h2>
                            <p>{zh ? '山钢日照现场常用操作说明' : 'Common operations for Shangang Rizhao'}</p>
                        </div>
                    </div>
                    <dl className='AboutUsDetails'>
                        <div>
                            <dt>{zh ? '设备' : 'Devices'}</dt>
                            <dd>{zh
                                ? '在左侧按作业区浏览主节点、AIPACK 与摄像头；点击节点查看详情或打开终端。'
                                : 'Browse nodes, AIPACK devices and cameras by work area; select a node for details or terminal access.'}</dd>
                        </div>
                        <div>
                            <dt>{zh ? '摄像头' : 'Cameras'}</dt>
                            <dd>{zh
                                ? '点击摄像头名称打开实时画面，返回设备列表可切换其他点位。'
                                : 'Select a camera to open its live view, then return to the device list to switch locations.'}</dd>
                        </div>
                        <div>
                            <dt>{zh ? '计算群' : 'Cluster'}</dt>
                            <dd>{zh
                                ? '从“拓展引擎 → 计算群”查看拓扑、工作调度、网络资产和节点管理。'
                                : 'Open Extension Engine → Compute Cluster for topology, scheduling, network assets and node management.'}</dd>
                        </div>
                        <div>
                            <dt>Agent</dt>
                            <dd>{zh
                                ? '点击左下角 OpenSight Agent，查询设备状态或生成项目报告。'
                                : 'Open OpenSight Agent in the lower-left corner to inspect device status or generate reports.'}</dd>
                        </div>
                    </dl>
                </section>
            </div>}
        </div>
    );
};

const mapDispatchToProps = {
    updateActivePopupTypeAction: updateActivePopupType,
    updateProjectDataAction: updateProjectData,
    updateLanguageAction: updateLanguage,
    updateQueueItemAction: updateQueueItem,
};

const mapStateToProps = (state: AppState) => ({
    projectData: state.general.projectData,
    queueItems: state.queue.items,
    activeQueueItemId: state.queue.activeQueueItemId,
    language: state.general.language,
    hasCoreEngine: !!state.aimodels?.models.some(model => model.modelType === 'core'),
    hasExtensionEngine: !!state.aimodels?.models.some(model => model.modelType === 'extension')
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(TopNavigationBar);
