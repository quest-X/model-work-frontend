import React, { useEffect, useState } from 'react';
import './App.scss';
import EditorView from './views/EditorView/EditorView';
import MainView from './views/MainView/MainView';
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
import { store } from './index';

interface IProps {
    projectType: ProjectType;
    windowSize: ISize;
    isObjectDetectorLoaded: boolean;
    isPoseDetectionLoaded: boolean;
    isYOLOV5ObjectDetectorLoaded: boolean;
    roboflowAPIDetails: RoboflowAPIDetails;
}

const App: React.FC<IProps> = (
    {
        projectType,
        windowSize,
        isObjectDetectorLoaded,
        isPoseDetectionLoaded,
        isYOLOV5ObjectDetectorLoaded,
        roboflowAPIDetails
    }
) => {
    const [isRestoring, setIsRestoring] = useState(true);
    const [showRestorePrompt, setShowRestorePrompt] = useState(false);
    const [storedDataInfo, setStoredDataInfo] = useState<{
        hasSettings: boolean;
        hasProject: boolean;
        lastSaved: number;
    } | null>(null);

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
        try {
            console.log('开始恢复数据...');
            setShowRestorePrompt(false);
            
            // 恢复设置
            if (storedDataInfo?.hasSettings) {
                console.log('恢复设置...');
                const settingsRestored = await ProjectRestoreService.restoreSettings();
                console.log('设置恢复结果:', settingsRestored);
            }
            
            // 恢复项目数据
            if (storedDataInfo?.hasProject) {
                console.log('恢复项目数据...');
                const projectRestored = await ProjectRestoreService.restoreProject();
                console.log('项目数据恢复结果:', projectRestored);
            }
            
            // 延迟确保Redux状态更新完成和组件准备就绪
            setTimeout(() => {
                console.log('数据恢复完成');
                setIsRestoring(false);
            }, 500); // 增加延迟时间，确保组件完全初始化
        } catch (error) {
            console.error('数据恢复失败:', error);
            setIsRestoring(false);
        }
    };

    const handleRestoreCancel = async () => {
        setShowRestorePrompt(false);
        setIsRestoring(false);
        // 可选：清除旧数据
        // await ProjectRestoreService.clearAllStoredData();
    };

    if (isRestoring && showRestorePrompt && storedDataInfo) {
        return (
            <div className="App restore-prompt">
                <div className="restore-dialog">
                    <h2>发现未完成的工作</h2>
                    <p>
                        上次保存时间: {ProjectRestoreService.formatLastSavedTime(storedDataInfo.lastSaved)}
                    </p>
                    <p>是否恢复之前的工作？</p>
                    <div className="restore-buttons">
                        <button onClick={handleRestoreCancel} className="btn-danger">
                            重新开始
                        </button>
                        <button onClick={handleRestoreConfirm} className="btn-success">
                            恢复工作
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (isRestoring) {
        return (
            <div className="App loading">
                <div className="loading-indicator">
                    <p>正在加载...</p>
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
    const isAILoaded = isObjectDetectorLoaded
        || isPoseDetectionLoaded
        || isYOLOV5ObjectDetectorLoaded
        || (roboflowAPIDetails.model !== '' && roboflowAPIDetails.key !== '' && roboflowAPIDetails.status)

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
    isSSDObjectDetectorLoaded: state.ai.isSSDObjectDetectorLoaded,
    isPoseDetectorLoaded: state.ai.isPoseDetectorLoaded,
    isYOLOV5ObjectDetectorLoaded: state.ai.isYOLOV5ObjectDetectorLoaded,
    roboflowAPIDetails: state.ai.roboflowAPIDetails
});

export default connect(
    mapStateToProps
)(App);
