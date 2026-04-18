import React, {useState} from 'react';
import {connect} from 'react-redux';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {store} from '../../../index';
import {updateActivePopupType} from '../../../store/general/actionCreators';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {DetectionAPIDetector, DEFAULT_INFERENCE_PARAMS} from '../../../ai/DetectionAPIDetector';
import {SegmentationAPIDetector} from '../../../ai/SegmentationAPIDetector';
import {PipelineStore} from '../../../ai/PipelineStore';
import './PipelinePopup.scss';

const backToCallModel = () => store.dispatch(updateActivePopupType(PopupWindowType.CALL_MODEL));

const IMGSZ_OPTIONS = [320, 480, 640, 800, 960, 1280, 1600];
const DEF = DEFAULT_INFERENCE_PARAMS;

interface IProps { language: Language; }

const PipelinePreprocessPopup: React.FC<IProps> = ({language}) => {
    const zh = language === Language.CHINESE;
    const isActive = PipelineStore.isActivated('preprocess');
    const initial = DetectionAPIDetector.getInferenceParams();

    const [imgsz, setImgsz] = useState<number>(initial.imgsz);
    const [imgszEnabled, setImgszEnabled] = useState<boolean>(initial.imgsz_enabled !== false);
    const [augment, setAugment] = useState<boolean>(initial.augment);

    const onAccept = () => {
        DetectionAPIDetector.setInferenceParams({imgsz, imgsz_enabled: imgszEnabled, augment, augment_enabled: augment});
        SegmentationAPIDetector.setInferenceParams({imgsz, imgsz_enabled: imgszEnabled, augment, augment_enabled: augment});
        backToCallModel();
    };

    const onReset = () => {
        setImgsz(DEF.imgsz); setImgszEnabled(true);
        setAugment(DEF.augment);
    };

    const renderContent = () => (
        <div className='PipelinePopupContent'>
            {!isActive && (
                <div className='StageInactiveWarning'>
                    <span className='Dot' />
                    {zh ? '此阶段未激活 · 参数不传入后端' : 'Stage inactive · params not sent to backend'}
                </div>
            )}

            <div className='ParamSection'>
                <div className='ParamSectionTitle scope-both'>{zh ? '[ 通用参数 ]' : '[ Universal ]'}</div>

                {/* imgsz */}
                <div className={`ParamRow${!imgszEnabled ? ' param-disabled' : ''}`}>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={imgszEnabled}
                                onChange={(e) => setImgszEnabled(e.target.checked)} />
                            <span className='ParamLabel'>{zh ? '输入尺寸 (imgsz)' : 'Input size (imgsz)'}</span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>{imgsz}</span>
                            {imgsz !== DEF.imgsz && imgszEnabled && (
                                <button className='ParamResetBtn' onClick={() => setImgsz(DEF.imgsz)}>
                                    ↺ {DEF.imgsz}
                                </button>
                            )}
                        </div>
                    </div>
                    <select value={imgsz} onChange={(e) => setImgsz(Number(e.target.value))}
                        disabled={!imgszEnabled}>
                        {IMGSZ_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <div className='ParamDesc'>
                        {zh
                            ? '模型推理时的输入图像边长（正方形 letterbox）。越大精度越高但越慢；默认 640。'
                            : 'Input image side length at inference time (square letterbox). Larger = more accurate, slower. Default 640.'}
                    </div>
                </div>

                {/* augment */}
                <div className='ParamRow'>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={augment}
                                onChange={(e) => setAugment(e.target.checked)} />
                            <span className='ParamLabel'>
                                {zh ? '测试时增强 (augment)' : 'Test-time augmentation (augment)'}
                            </span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>
                                {augment ? (zh ? '开启' : 'on') : (zh ? '关闭' : 'off')}
                            </span>
                        </div>
                    </div>
                    <div className='ParamDesc'>
                        {zh
                            ? '推理时对输入图像进行多角度翻转/缩放增强后融合结果（TTA）。精度略升，速度约 3×慢。默认关闭。'
                            : 'Apply multi-scale/flip augmentations at inference time (TTA) and merge results. Slight accuracy gain, ~3× slower. Default: off.'}
                    </div>
                </div>
            </div>

            <div className='ResetRow'>
                <button onClick={onReset}>
                    {zh ? '恢复默认' : 'Reset to defaults'}
                </button>
            </div>
        </div>
    );

    return (
        <GenericYesNoPopup
            title={zh ? '前处理' : 'Pre-processing'}
            renderContent={renderContent}
            acceptLabel={zh ? '保存' : 'Save'}
            onAccept={onAccept}
            rejectLabel={zh ? '返回' : 'Back'}
            onReject={backToCallModel}
        />
    );
};

const mapStateToProps = (state: AppState) => ({language: state.general.language});
export default connect(mapStateToProps)(PipelinePreprocessPopup);
