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
import {AIModel} from '../../../store/aimodels/types';
import './PipelinePopup.scss';

const backToCallModel = () => store.dispatch(updateActivePopupType(PopupWindowType.CALL_MODEL));

const DEF = DEFAULT_INFERENCE_PARAMS;

interface IProps { language: Language; activeModelType: AIModel['modelType'] | null; }

const PipelineInferencePopup: React.FC<IProps> = ({language, activeModelType}) => {
    const zh = language === Language.CHINESE;
    const isActive = PipelineStore.isActivated('inference');
    const showSeg = activeModelType === 'segmentation' || activeModelType === 'custom';
    const initial = DetectionAPIDetector.getInferenceParams();

    const initialSeg = SegmentationAPIDetector.getInferenceParams();

    const [conf, setConf] = useState<number>(initial.conf);
    const [iou, setIou] = useState<number>(initial.iou);
    const [maxDet, setMaxDet] = useState<number>(initial.max_det);
    const [agnosticNms, setAgnosticNms] = useState<boolean>(initial.agnostic_nms);
    const [classes, setClasses] = useState<string>(initial.classes);
    const [confEnabled, setConfEnabled] = useState<boolean>(initial.conf_enabled !== false);
    const [iouEnabled, setIouEnabled] = useState<boolean>(initial.iou_enabled !== false);
    const [maxDetEnabled, setMaxDetEnabled] = useState<boolean>(initial.max_det_enabled !== false);
    const [classesEnabled, setClassesEnabled] = useState<boolean>(initial.classes_enabled !== false);
    // retina_masks: segmentation-only param — load from SegmentationAPIDetector
    const [retinaMasks, setRetinaMasks] = useState<boolean>(initialSeg.retina_masks);

    const onAccept = () => {
        DetectionAPIDetector.setInferenceParams({
            conf, iou, max_det: maxDet,
            agnostic_nms: agnosticNms, classes,
            conf_enabled: confEnabled, iou_enabled: iouEnabled, max_det_enabled: maxDetEnabled,
            agnostic_nms_enabled: agnosticNms, classes_enabled: classesEnabled,
        });
        SegmentationAPIDetector.setInferenceParams({
            conf, iou, max_det: maxDet,
            agnostic_nms: agnosticNms, classes,
            retina_masks: retinaMasks,
            conf_enabled: confEnabled, iou_enabled: iouEnabled, max_det_enabled: maxDetEnabled,
            agnostic_nms_enabled: agnosticNms, classes_enabled: classesEnabled,
            retina_masks_enabled: retinaMasks,
        });
        backToCallModel();
    };

    const onReset = () => {
        setConf(DEF.conf); setIou(DEF.iou); setMaxDet(DEF.max_det);
        setAgnosticNms(DEF.agnostic_nms); setClasses(DEF.classes);
        setConfEnabled(true); setIouEnabled(true); setMaxDetEnabled(true);
        setClassesEnabled(true);
        setRetinaMasks(false);
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

                {/* conf */}
                <div className={`ParamRow${!confEnabled ? ' param-disabled' : ''}`}>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={confEnabled}
                                onChange={(e) => setConfEnabled(e.target.checked)} />
                            <span className='ParamLabel'>{zh ? '置信度阈值 (conf)' : 'Confidence threshold (conf)'}</span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>{conf.toFixed(2)}</span>
                            {conf !== DEF.conf && confEnabled && (
                                <button className='ParamResetBtn' onClick={() => setConf(DEF.conf)}>
                                    ↺ {DEF.conf.toFixed(2)}
                                </button>
                            )}
                        </div>
                    </div>
                    <input type='range' min={0} max={1} step={0.01} value={conf}
                        disabled={!confEnabled}
                        onChange={(e) => setConf(Number(e.target.value))} />
                    <div className='ParamDesc'>
                        {zh
                            ? '低于此分数的目标将被丢弃。越高越严格，漏检增加；越低越宽松，误检增加。'
                            : 'Drop predictions below this score. Higher = stricter (more misses), lower = looser (more false positives).'}
                    </div>
                </div>

                {/* iou */}
                <div className={`ParamRow${!iouEnabled ? ' param-disabled' : ''}`}>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={iouEnabled}
                                onChange={(e) => setIouEnabled(e.target.checked)} />
                            <span className='ParamLabel'>{zh ? 'NMS IoU 阈值 (iou)' : 'NMS IoU threshold (iou)'}</span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>{iou.toFixed(2)}</span>
                            {iou !== DEF.iou && iouEnabled && (
                                <button className='ParamResetBtn' onClick={() => setIou(DEF.iou)}>
                                    ↺ {DEF.iou.toFixed(2)}
                                </button>
                            )}
                        </div>
                    </div>
                    <input type='range' min={0} max={1} step={0.01} value={iou}
                        disabled={!iouEnabled}
                        onChange={(e) => setIou(Number(e.target.value))} />
                    <div className='ParamDesc'>
                        {zh
                            ? '两个框 IoU 超过此值时视作重复，合并保留分数高者。越小越激进（重叠检测被合并更多）。'
                            : 'Boxes overlapping by more than this IoU are merged (keep higher score). Lower = more aggressive merging.'}
                    </div>
                </div>

                {/* max_det */}
                <div className={`ParamRow${!maxDetEnabled ? ' param-disabled' : ''}`}>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={maxDetEnabled}
                                onChange={(e) => setMaxDetEnabled(e.target.checked)} />
                            <span className='ParamLabel'>{zh ? '最大检出数 (max_det)' : 'Max detections (max_det)'}</span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>{maxDet}</span>
                            {maxDet !== DEF.max_det && maxDetEnabled && (
                                <button className='ParamResetBtn' onClick={() => setMaxDet(DEF.max_det)}>
                                    ↺ {DEF.max_det}
                                </button>
                            )}
                        </div>
                    </div>
                    <input type='number' min={1} max={10000} step={1} value={maxDet}
                        disabled={!maxDetEnabled}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setMaxDet(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
                    <div className='ParamDesc'>
                        {zh
                            ? '单张图像最多保留多少个目标。默认 300，大部分场景不用改。'
                            : 'Maximum predictions per image. Default 300 — rarely needs changing.'}
                    </div>
                </div>

                {/* agnostic_nms */}
                <div className='ParamRow'>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={agnosticNms}
                                onChange={(e) => setAgnosticNms(e.target.checked)} />
                            <span className='ParamLabel'>
                                {zh ? '类别无关 NMS (agnostic_nms)' : 'Class-agnostic NMS (agnostic_nms)'}
                            </span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>
                                {agnosticNms ? (zh ? '开启' : 'on') : (zh ? '关闭' : 'off')}
                            </span>
                        </div>
                    </div>
                    <div className='ParamDesc'>
                        {zh
                            ? '跨类别执行 NMS，重叠的不同类别目标也会被合并。多目标密集叠加时有效。默认关闭。'
                            : 'Merge overlapping boxes regardless of class during NMS. Useful for densely overlapping objects. Default: off.'}
                    </div>
                </div>

                {/* classes */}
                <div className={`ParamRow${!classesEnabled ? ' param-disabled' : ''}`}>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={classesEnabled}
                                onChange={(e) => setClassesEnabled(e.target.checked)} />
                            <span className='ParamLabel'>
                                {zh ? '过滤类别 (classes)' : 'Filter classes (classes)'}
                            </span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>
                                {classes.trim() ? classes.trim() : (zh ? '全部' : 'all')}
                            </span>
                            {classes !== DEF.classes && classesEnabled && (
                                <button className='ParamResetBtn' onClick={() => setClasses(DEF.classes)}>
                                    ↺ {zh ? '全部' : 'all'}
                                </button>
                            )}
                        </div>
                    </div>
                    <input type='text' placeholder={zh ? '例: 0,1,2（空=全部）' : 'e.g. 0,1,2 (empty = all)'}
                        value={classes}
                        disabled={!classesEnabled}
                        onChange={(e) => setClasses(e.target.value)} />
                    <div className='ParamDesc'>
                        {zh
                            ? '只保留指定 class ID 的目标，多个用逗号分隔。留空表示不过滤（保留全部类别）。'
                            : 'Keep only predictions for the listed class IDs (comma-separated). Empty = keep all classes.'}
                    </div>
                </div>
            </div>

            {showSeg && <div className='ParamSection'>
                <div className='ParamSectionTitle'>{zh ? '[ 分割参数 ]' : '[ Segmentation ]'}</div>

                {/* retina_masks */}
                <div className='ParamRow'>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={retinaMasks}
                                onChange={(e) => setRetinaMasks(e.target.checked)} />
                            <span className='ParamLabel'>
                                {zh ? '高分辨率 mask (retina_masks)' : 'High-res masks (retina_masks)'}
                            </span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>
                                {retinaMasks ? (zh ? '开启' : 'on') : (zh ? '关闭' : 'off')}
                            </span>
                        </div>
                    </div>
                    <div className='ParamDesc'>
                        {zh
                            ? '使用原始图像分辨率输出 mask（retina 质量），边缘更精细但略慢。仅 YOLO-seg 有效，SAM 忽略。默认关闭。'
                            : 'Output masks at full input resolution (retina quality) for sharper edges. YOLO-seg only; SAM ignores. Default: off.'}
                    </div>
                </div>
            </div>}

            <div className='ResetRow'>
                <button onClick={onReset}>{zh ? '恢复默认' : 'Reset to defaults'}</button>
            </div>
        </div>
    );

    return (
        <GenericYesNoPopup
            title={zh ? '推理过程' : 'Inference'}
            renderContent={renderContent}
            acceptLabel={zh ? '保存' : 'Save'}
            onAccept={onAccept}
            rejectLabel={zh ? '返回' : 'Back'}
            onReject={backToCallModel}
        />
    );
};

const mapStateToProps = (state: AppState) => {
    const models = state.aimodels.models;
    const hasCustom = models.some(m => m.modelType === 'custom');
    let activeModelType: AIModel['modelType'] | null = null;
    if (models.length > 0 && !hasCustom) {
        const hasDet = models.some(m => m.modelType === 'detection');
        const hasSeg = models.some(m => m.modelType === 'segmentation');
        if (hasDet && hasSeg) activeModelType = 'custom';
        else if (hasDet) activeModelType = 'detection';
        else activeModelType = 'segmentation';
    } else if (hasCustom) {
        activeModelType = 'custom';
    }
    return { language: state.general.language, activeModelType };
};
export default connect(mapStateToProps)(PipelineInferencePopup);
