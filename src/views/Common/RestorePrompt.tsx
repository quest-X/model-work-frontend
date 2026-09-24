import React from 'react';
import {ProjectRestoreService} from '../../services/ProjectRestoreService';

export type StoredDataInfo = Awaited<ReturnType<typeof ProjectRestoreService.checkForStoredData>>;

const renderImageCounts = (storedDataInfo: StoredDataInfo) => <>
    {storedDataInfo.validImageCount !== undefined &&
     (storedDataInfo.imageCount ?? 0) > 0 && (
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
</>;

interface Props {
    storedDataInfo: StoredDataInfo;
    restoreError: string | null;
    storageUnavailable: boolean;
    handleRestoreCancel: () => void;
    handleRestoreConfirm: () => void;
}

export const RestorePrompt: React.FC<Props> = ({
    storedDataInfo, restoreError, storageUnavailable, handleRestoreCancel, handleRestoreConfirm,
}) => (
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
                {renderImageCounts(storedDataInfo)}
            </div>
            {/* 恢复失败错误提示 */}
            {restoreError && (
                <div className="error-message">
                    <p>{restoreError}</p>
                    <div className="restore-buttons">
                        {!storageUnavailable && (
                            <button onClick={handleRestoreCancel} className="btn-danger">
                                清除数据，重新开始
                            </button>
                        )}
                        <button onClick={handleRestoreConfirm} className="btn-success">
                            {storageUnavailable ? '关闭旧标签页后重试' : '重试恢复'}
                        </button>
                    </div>
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
