import React, { useState, useEffect } from 'react';
import { connect } from 'react-redux';
import './ObjectTrackingPopup.scss';
import { AppState } from '../../../store';
import { Language, LanguageConfig } from '../../../data/LanguageConfig';
import { PopupActions } from '../../../logic/actions/PopupActions';
import { GenericYesNoPopup } from '../GenericYesNoPopup/GenericYesNoPopup';
import { ObjectTrackingActions } from '../../../logic/actions/ObjectTrackingActions';
import { VideoData } from '../../../store/video/types';
import { getDefaultBackendBase } from '../../../utils/DefaultBackendUrl';

// 模块级暂存：RectRenderEngine 画完 bbox 后写入；popup 打开后读取
let _pendingBbox: [number, number, number, number] | null = null;
let _pendingStartFrame = 0;

export const stashTrackingPrompt = (
    bbox: [number, number, number, number],
    startFrame: number,
) => {
    _pendingBbox = bbox;
    _pendingStartFrame = startFrame;
};

export const clearTrackingPrompt = () => {
    _pendingBbox = null;
    _pendingStartFrame = 0;
};

const isTrackingModel = (name: string): boolean => {
    if (!name) return false;
    const base = name.replace(/\.(pt|onnx)$/i, '');
    return /^(sam2|sam3)/i.test(base);
};

interface IProps {
    language: Language;
    activeVideo: VideoData | null;
}

const ObjectTrackingPopup: React.FC<IProps> = ({ language, activeVideo }) => {
    const zh = language === 'zh';

    const totalFrames = activeVideo?.totalFrames ?? 1;
    const fps = activeVideo?.fps ?? 30;
    const startFrame = _pendingStartFrame;
    const bbox = _pendingBbox;

    // 默认尾帧：起始 + 20 秒 或 视频末尾
    const defaultEnd = Math.min(totalFrames - 1, startFrame + Math.round(fps * 20));
    const [endFrame, setEndFrame] = useState<number>(defaultEnd);
    const [modelName, setModelName] = useState<string>('');

    // 从 /health 取当前 det / seg slot；优先使用 SAM 2/3
    useEffect(() => {
        const url = `${getDefaultBackendBase()}/health`;
        fetch(url).then(r => r.json()).then(data => {
            const seg = (data.segmentation_model || '').trim();
            const det = (data.model || '').trim();
            if (isTrackingModel(seg)) setModelName(seg);
            else if (isTrackingModel(det)) setModelName(det);
        }).catch(() => { /* leave empty → disable accept */ });
    }, []);

    const bboxInvalid = !bbox;
    const modelInvalid = !modelName;
    const rangeInvalid = endFrame <= startFrame;
    const disableAccept = bboxInvalid || modelInvalid || rangeInvalid;

    const onAccept = () => {
        if (disableAccept || !bbox || !activeVideo) return;
        ObjectTrackingActions.startTracking({
            sessionId: activeVideo.sessionId || '',
            startFrameIdx: startFrame,
            endFrameIdx: endFrame,
            bboxImageSpace: bbox,
            modelName,
        });
        clearTrackingPrompt();
        PopupActions.close();
    };

    const onReject = () => {
        clearTrackingPrompt();
        PopupActions.close();
    };

    const renderContent = () => (
        <div className='ObjectTrackingPopupContent'>
            <div className='Row'>
                <label>{zh ? '起始帧' : 'Start frame'}</label>
                <span className='Value'>{startFrame}</span>
            </div>
            <div className='Row'>
                <label>{zh ? '终止帧' : 'End frame'}</label>
                <input
                    type='range'
                    min={startFrame + 1}
                    max={totalFrames - 1}
                    value={endFrame}
                    onChange={e => setEndFrame(Number(e.target.value))}
                />
                <input
                    type='number'
                    className='NumberInput'
                    min={startFrame + 1}
                    max={totalFrames - 1}
                    value={endFrame}
                    onChange={e => {
                        const v = Number(e.target.value);
                        if (!isNaN(v)) setEndFrame(Math.max(startFrame + 1, Math.min(totalFrames - 1, v)));
                    }}
                />
            </div>
            <div className='Row'>
                <label>{zh ? '模型' : 'Model'}</label>
                <span className='Value'>{modelName || (zh ? '未找到 SAM 2 / SAM 3' : 'No SAM 2 / SAM 3 loaded')}</span>
            </div>
            <div className='Row'>
                <label>bbox</label>
                <span className='Value'>
                    {bbox
                        ? `[${bbox.map(v => Math.round(v)).join(', ')}]`
                        : (zh ? '（未提供）' : '(missing)')}
                </span>
            </div>
            {!disableAccept && (
                <div className='Hint'>
                    {zh
                        ? `将追踪 ${endFrame - startFrame + 1} 帧（约 ${((endFrame - startFrame + 1) / fps).toFixed(1)} 秒）`
                        : `Will track ${endFrame - startFrame + 1} frames (~${((endFrame - startFrame + 1) / fps).toFixed(1)}s)`}
                </div>
            )}
        </div>
    );

    return (
        <GenericYesNoPopup
            title={zh ? '目标跟踪' : 'Object Tracking'}
            renderContent={renderContent}
            acceptLabel={zh ? '开始跟踪' : 'Start'}
            onAccept={onAccept}
            disableAcceptButton={disableAccept}
            rejectLabel={zh ? '取消' : 'Cancel'}
            onReject={onReject}
        />
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language,
    activeVideo: state.video?.activeVideo || null,
});

export default connect(mapStateToProps)(ObjectTrackingPopup);
