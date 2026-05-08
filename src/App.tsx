import React, { useEffect, useState } from 'react';
import './App.scss';
import EditorView from './views/EditorView/EditorView';
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

interface IProps {
    projectType: ProjectType;
    windowSize: ISize;
    roboflowAPIDetails: RoboflowAPIDetails;
}

// storedDataInfo 的类型，兼容 checkForStoredData 可能返回的扩展字段
interface StoredDataInfo {
    hasSettings: boolean;
    hasProject: boolean;
    lastSaved: number;
    projectName?: string;
    imageCount?: number;
    validImageCount?: number;
    labelCount?: number;
    isVideoProject?: boolean;
}

const App: React.FC<IProps> = (
    {
        projectType,
        windowSize,
        roboflowAPIDetails
    }
) => {
    const [isRestoring, setIsRestoring] = useState(true);
    const [showRestorePrompt, setShowRestorePrompt] = useState(false);
    const [storedDataInfo, setStoredDataInfo] = useState<StoredDataInfo | null>(null);
    const [restoreError, setRestoreError] = useState<string | null>(null);
    const [restoreStatus, setRestoreStatus] = useState<string>('正在加载...');

    useEffect(() => {
        initializeApp();
    }, []);

    const initializeApp = async () => {
        try {
            // 初始化自动保存服务
            await AutoSaveService.initialize();

            // 检查是否有存储的数据
            const dataInfo = await ProjectRestoreService.checkForStoredData();
            setStoredDataInfo(dataInfo);

            // 恢复弹窗触发：v2.1.9 行为 — settings 或 project 任一存在就弹。
            // v2.2.x 期间收紧到 hasProject-only 是为了不打扰，但用户偏好"积极地恢复"，
            // 哪怕只有 settings 也想看到提示而不是被静默吞掉。
            if (dataInfo.hasSettings || dataInfo.hasProject) {
                setShowRestorePrompt(true);
            } else {
                setIsRestoring(false);
            }
        } catch (error) {
            console.error('应用初始化失败:', error);
            setIsRestoring(false);
        }
    };

    const handleRestoreConfirm = async () => {
        setRestoreError(null);
        try {
            // 恢复设置
            setRestoreStatus('正在恢复设置...');
            if (storedDataInfo?.hasSettings) {
                await ProjectRestoreService.restoreSettings();
            }

            // 恢复项目数据
            setRestoreStatus('正在恢复项目数据...');
            if (storedDataInfo?.hasProject) {
                await ProjectRestoreService.restoreProject((msg: string) => setRestoreStatus(msg));
            }

            setRestoreStatus('恢复完成');
            setShowRestorePrompt(false);

            // 延迟确保 Redux 状态更新完成和组件准备就绪
            setTimeout(() => {
                setIsRestoring(false);
            }, 500);
        } catch (error) {
            console.error('数据恢复失败:', error);
            // 保留对话框可见，以便错误 UI 能正常显示
            setRestoreError('恢复失败，可能是数据损坏。请清除数据重新开始。');
        }
    };

    // 重新开始：清除 IndexedDB 旧数据，避免下次刷新再次弹出恢复提示
    const handleRestoreCancel = async () => {
        setShowRestorePrompt(false);
        setIsRestoring(false);
        await ProjectRestoreService.clearAllStoredData();
    };

    if (isRestoring && showRestorePrompt && storedDataInfo) {
        return (
            <div className="App restore-prompt">
                <div className="restore-dialog">
                    <h2>是否恢复之前的工作?</h2>
                    <div className="restore-info">
                        {storedDataInfo.projectName && (
                            <div className="info-row">
                                <span className="info-label">项目名称</span>
                                <span className="info-value">{storedDataInfo.projectName}</span>
                            </div>
                        )}
                        <div className="info-row">
                            <span className="info-label">上次保存</span>
                            <span className="info-value">{ProjectRestoreService.formatLastSavedTime(storedDataInfo.lastSaved)}</span>
                        </div>
                        {storedDataInfo.isVideoProject !== undefined && (
                            <div className="info-row">
                                <span className="info-label">项目类型</span>
                                <span className="info-value">{storedDataInfo.isVideoProject ? '视频' : '图像'}</span>
                            </div>
                        )}
                        {storedDataInfo.validImageCount !== undefined && (
                            <div className="info-row">
                                <span className={storedDataInfo.validImageCount === 0 ? 'info-label warn' : 'info-label'}>
                                    {storedDataInfo.isVideoProject ? '已标注帧' : '已标注图像'}
                                </span>
                                <span className={storedDataInfo.validImageCount === 0 ? 'info-value warn' : 'info-value'}>
                                    {storedDataInfo.labelCount ?? 0} / {storedDataInfo.validImageCount} {storedDataInfo.isVideoProject ? '帧' : '张'}
                                    {storedDataInfo.validImageCount === 0 && '（无可恢复数据）'}
                                </span>
                            </div>
                        )}
                        {storedDataInfo.validImageCount !== undefined &&
                         storedDataInfo.imageCount !== undefined &&
                         storedDataInfo.validImageCount < storedDataInfo.imageCount && (
                            <div className="info-row">
                                <span className="info-label warn">
                                    数据丢失
                                </span>
                                <span className="info-value warn">
                                    {storedDataInfo.imageCount - storedDataInfo.validImageCount} / {storedDataInfo.imageCount} {storedDataInfo.isVideoProject ? '帧' : '张'}
                                </span>
                            </div>
                        )}
                    </div>
                    {/* 恢复失败错误提示 */}
                    {restoreError && (
                        <div className="error-message">
                            <p>{restoreError}</p>
                            <button onClick={handleRestoreCancel} className="btn-danger">
                                清除数据，重新开始
                            </button>
                        </div>
                    )}
                    {!restoreError && (
                        <div className="restore-buttons">
                            <button onClick={handleRestoreCancel} className="btn-danger">
                                重新开始
                            </button>
                            <button onClick={handleRestoreConfirm} className="btn-success">
                                恢复工作
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
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
            return <EditorView/>;
        }
    };

    const isAILoaded = (roboflowAPIDetails.model !== '' && roboflowAPIDetails.key !== '' && roboflowAPIDetails.status)

    return (
        <div className={classNames('App', {'AI': isAILoaded})} draggable={false}
        >
            {selectRoute()}
            <PopupView/>
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
