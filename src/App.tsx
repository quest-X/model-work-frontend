import React, { useEffect, useState } from 'react';
import './App.scss';
import EditorView, {PlatformMode} from './views/EditorView/EditorView';
import {ProjectType} from './data/enums/ProjectType';
import {AppState} from './store';
import {connect} from 'react-redux';
import PopupView from './views/PopupView/PopupView';
import MobileMainView from './views/MobileMainView/MobileMainView';
import {ISize} from './interfaces/ISize';
import {Settings} from './settings/Settings';
import {SizeItUpView} from './views/SizeItUpView/SizeItUpView';
import {PlatformModel} from './staticModels/PlatformModel';
import classNames from 'classnames';
import NotificationsView from './views/NotificationsView/NotificationsView';
import { RoboflowAPIDetails } from './store/ai/types';
import { AutoSaveService } from './services/AutoSaveService';
import { ProjectRestoreService } from './services/ProjectRestoreService';
import {IndexedDBManager, RecoveryStorageReadError} from './utils/IndexedDBManager';
import {currentAccountSession} from './services/AccountService';
import {RestorePrompt, StoredDataInfo} from './views/Common/RestorePrompt';

interface IProps {
    projectType: ProjectType;
    windowSize: ISize;
    roboflowAPIDetails: RoboflowAPIDetails;
}

export const App: React.FC<IProps> = (
    {
        windowSize,
        roboflowAPIDetails
    }
) => {
    const [isRestoring, setIsRestoring] = useState(true);
    const [showRestorePrompt, setShowRestorePrompt] = useState(false);
    const [storedDataInfo, setStoredDataInfo] = useState<StoredDataInfo | null>(null);
    const [restoreError, setRestoreError] = useState<string | null>(null);
    const [restoreStatus, setRestoreStatus] = useState<string>('正在加载...');
    const [storageUnavailable, setStorageUnavailable] = useState(false);
    const [platformMode, setPlatformMode] = useState<PlatformMode>(
        () => currentAccountSession()?.user.role === 'admin' ? 'control' : 'annotation',
    );

    const beforeOpenAnnotationResource = () => {
        if (storedDataInfo?.hasProject || storageUnavailable) {
            // Resolve the existing recovery snapshot before a resource can replace the workspace.
            setPlatformMode('annotation');
            return false;
        }
        return true;
    };

    const initializeApp = async () => {
        try {
            // 初始化自动保存服务
            await AutoSaveService.initialize();
            // 恢复发现与重建期间禁止任何自动保存。否则恢复过程中的半成品 Redux
            // 状态可能在 3 秒 debounce 到期后覆盖最后一份完整快照。
            AutoSaveService.suspend();

            if (!IndexedDBManager.isReady()) {
                setStoredDataInfo({hasSettings: false, hasProject: false, lastSaved: 0});
                setStorageUnavailable(true);
                setRestoreError('恢复数据库被其他旧标签页占用。请关闭旧标签页，然后重试；现有恢复数据不会被清除。');
                setIsRestoring(false);
                return;
            }

            // 检查是否有存储的数据
            const dataInfo = await ProjectRestoreService.checkForStoredData();
            setStoredDataInfo(dataInfo);

            // 项目恢复只属于标注平台。控制中心保留待恢复快照但不弹窗；
            // 仅有设置时静默恢复，避免把偏好数据误当成标注工作。
            if (!dataInfo.hasProject && dataInfo.hasSettings) {
                await ProjectRestoreService.restoreSettings();
            }
            if (!dataInfo.hasProject) AutoSaveService.resume();
            setIsRestoring(false);
        } catch (error) {
            console.error('应用初始化失败:', error);
            // A read failure is not evidence that no snapshot exists. Keep the
            // writer suspended and expose a retry path so a transient browser
            // storage error can never turn into an empty overwrite.
            AutoSaveService.suspend();
            setStoredDataInfo({hasSettings: false, hasProject: false, lastSaved: 0});
            setStorageUnavailable(true);
            setRestoreError('暂时无法读取恢复数据库。现有恢复数据不会被覆盖，请重试。');
            setIsRestoring(false);
        }
    };


    useEffect(() => {
        initializeApp();
    }, []);

    useEffect(() => {
        if (platformMode !== 'annotation'
            || (!storedDataInfo?.hasProject && !storageUnavailable)) return;
        AutoSaveService.suspend();
        setShowRestorePrompt(true);
        setIsRestoring(true);
    }, [platformMode, storageUnavailable, storedDataInfo]);

    const handleRestoreConfirm = async () => {
        setRestoreError(null);
        try {
            let dataInfo = storedDataInfo;
            if (storageUnavailable) {
                setRestoreStatus('正在重新连接恢复数据库...');
                const ready = await IndexedDBManager.initialize();
                if (!ready) {
                    throw new Error('恢复数据库仍被占用，请关闭其他旧标签页后重试');
                }
                dataInfo = await ProjectRestoreService.checkForStoredData();
                setStoredDataInfo(dataInfo);
                setStorageUnavailable(false);
            }

            // 恢复设置
            setRestoreStatus('正在恢复设置...');
            if (dataInfo?.hasSettings) {
                await ProjectRestoreService.restoreSettings();
            }

            // 恢复项目数据
            setRestoreStatus('正在恢复项目数据...');
            if (dataInfo?.hasProject) {
                const restored = await ProjectRestoreService.restoreProject(
                    (msg: string) => setRestoreStatus(msg),
                );
                if (!restored) {
                    throw new Error('未找到可恢复的项目数据');
                }
            }

            setRestoreStatus('恢复完成');
            setStoredDataInfo(current => current ? {...current, hasProject: false} : current);
            setShowRestorePrompt(false);

            // 延迟确保 Redux 状态更新完成和组件准备就绪
            setTimeout(() => {
                setIsRestoring(false);
                AutoSaveService.resume();
            }, 500);
        } catch (error) {
            console.error('数据恢复失败:', error);
            // 保留对话框可见，以便错误 UI 能正常显示
            const detail = error instanceof Error ? error.message : '未知错误';
            if (error instanceof RecoveryStorageReadError) {
                setStorageUnavailable(true);
            }
            setRestoreError(`恢复失败：${detail}。恢复数据仍然保留，可以修复问题后重试。`);
        }
    };

    // 重新开始：清除 IndexedDB 旧数据，避免下次刷新再次弹出恢复提示
    const handleRestoreCancel = async () => {
        try {
            // 等待已有写入完全落盘后再清除，并保持 suspend，避免一个较慢的旧 save
            // 在 clear 之后完成、把用户刚清掉的数据“复活”。
            await AutoSaveService.drain();
            await ProjectRestoreService.clearAllStoredData();
            setStoredDataInfo(current => current ? {
                ...current,
                hasSettings: false,
                hasProject: false,
            } : current);
            setShowRestorePrompt(false);
            setIsRestoring(false);
            AutoSaveService.resume();
        } catch (error) {
            console.error('清除恢复数据失败:', error);
            setRestoreError('清除失败，原恢复数据仍然保留。请检查浏览器存储后重试。');
        }
    };

    if (isRestoring && showRestorePrompt && storedDataInfo) {
        return <RestorePrompt
            storedDataInfo={storedDataInfo}
            restoreError={restoreError}
            storageUnavailable={storageUnavailable}
            handleRestoreCancel={handleRestoreCancel}
            handleRestoreConfirm={handleRestoreConfirm}
        />;
    }

    if (isRestoring) {
        return (
            <div className="App loading">
                <div className="loading-indicator">
                    <p className="restore-status">{restoreStatus}</p>
                </div>
            </div>
        );
    }

    const selectRoute = () => {
        if (!!PlatformModel.mobileDeviceData.manufacturer && !!PlatformModel.mobileDeviceData.os)
            return <MobileMainView/>;

        // 直接进入EditorView，跳过MainView和项目类型选择
        if (windowSize.height < Settings.EDITOR_MIN_HEIGHT || windowSize.width < Settings.EDITOR_MIN_WIDTH) {
            return <SizeItUpView/>;
        } else {
            return <EditorView
                platformMode={platformMode}
                onPlatformSwitch={() => setPlatformMode(mode => mode === 'annotation' ? 'control' : 'annotation')}
            />;
        }
    };

    const isAILoaded = (roboflowAPIDetails.model !== '' && roboflowAPIDetails.key !== '' && roboflowAPIDetails.status)

    return (
        <div className={classNames('App', {'AI': isAILoaded})} draggable={false}
        >
            {selectRoute()}
            <PopupView
                onBeforeOpenAnnotation={beforeOpenAnnotationResource}
                onOpenAnnotation={() => setPlatformMode('annotation')}
            />
            <NotificationsView/>
        </div>
    );
};


const mapStateToProps = (state: AppState) => ({
    projectType: state.general.projectData.type,
    windowSize: state.general.windowSize,
    roboflowAPIDetails: state.ai.roboflowAPIDetails
});

export default connect(
    mapStateToProps
)(App);
