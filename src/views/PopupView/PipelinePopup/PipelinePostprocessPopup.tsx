import React, {useState} from 'react';
import {connect} from 'react-redux';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {store} from '../../../index';
import {updateActivePopupType} from '../../../store/general/actionCreators';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {AppState} from '../../../store';
import {Language} from '../../../data/LanguageConfig';
import {
    SegmentationAPIDetector,
    DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS,
} from '../../../ai/SegmentationAPIDetector';
import {
    DetectionAPIDetector,
    DEFAULT_DETECTION_POSTPROCESS_PARAMS,
} from '../../../ai/DetectionAPIDetector';
import {PipelineStore} from '../../../ai/PipelineStore';
import {InferenceModelType} from '../../../store/aimodels/types';
import {ScriptSection} from './ScriptSection';
import './PipelinePopup.scss';

const backToCallModel = () => store.dispatch(updateActivePopupType(PopupWindowType.CALL_MODEL));

const DEF = DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS;
const DEF_DET = DEFAULT_DETECTION_POSTPROCESS_PARAMS;

interface IProps { language: Language; activeModelType: InferenceModelType | null; selectedModelTask: string | null; }

const PipelinePostprocessPopup: React.FC<IProps> = ({language, activeModelType, selectedModelTask}) => {
    const zh = language === Language.CHINESE;
    const isActive = PipelineStore.isActivated('postprocess');
    const showDet = activeModelType === 'detection' || activeModelType === 'custom';
    const showSeg = activeModelType === 'segmentation' || activeModelType === 'custom';
    const initialSeg = SegmentationAPIDetector.getPostprocessParams();
    const initialDet = DetectionAPIDetector.getPostprocessParams();

    // 多模型时只有当前 task 对应的 section 激活；单模型或未选 task 时两侧均激活
    const isMultiModel = activeModelType === 'custom';
    const detSectionActive = !isMultiModel || !selectedModelTask || selectedModelTask === 'detect';
    const segSectionActive = !isMultiModel || !selectedModelTask || selectedModelTask === 'segment';

    // 检测后处理
    const [minBboxArea, setMinBboxArea] = useState<number>(initialDet.min_bbox_area);
    const [bboxPadding, setBboxPadding] = useState<number>(initialDet.bbox_padding);
    const [minBboxAreaEnabled, setMinBboxAreaEnabled] = useState<boolean>(detSectionActive && initialDet.min_bbox_area_enabled !== false && initialDet.min_bbox_area > 0);
    const [bboxPaddingEnabled, setBboxPaddingEnabled] = useState<boolean>(detSectionActive && initialDet.bbox_padding_enabled !== false && initialDet.bbox_padding > 0);

    // 分割后处理
    const [epsilon, setEpsilon] = useState<number>(initialSeg.polygon_epsilon);
    const [minArea, setMinArea] = useState<number>(initialSeg.min_mask_area);
    const [largestOnly, setLargestOnly] = useState<boolean>(initialSeg.largest_cc_only);
    const [maskDilate, setMaskDilate] = useState<number>(initialSeg.mask_dilate);
    const [maxPolygonPoints, setMaxPolygonPoints] = useState<number>(initialSeg.max_polygon_points);
    const [epsilonEnabled, setEpsilonEnabled] = useState<boolean>(segSectionActive && initialSeg.polygon_epsilon_enabled !== false && initialSeg.polygon_epsilon > 0);
    const [minAreaEnabled, setMinAreaEnabled] = useState<boolean>(segSectionActive && initialSeg.min_mask_area_enabled !== false && initialSeg.min_mask_area > 0);
    const [maskDilateEnabled, setMaskDilateEnabled] = useState<boolean>(segSectionActive && initialSeg.mask_dilate_enabled !== false && initialSeg.mask_dilate > 0);
    const [maxPolygonPointsEnabled, setMaxPolygonPointsEnabled] = useState<boolean>(segSectionActive && initialSeg.max_polygon_points_enabled !== false && initialSeg.max_polygon_points > 0);
    const [maskIouThreshold, setMaskIouThreshold] = useState<number>(initialSeg.mask_iou_threshold);
    const [maskIouThresholdEnabled, setMaskIouThresholdEnabled] = useState<boolean>(segSectionActive && initialSeg.mask_iou_threshold_enabled !== false);

    const detHasAnyEnabled = minBboxAreaEnabled || bboxPaddingEnabled;
    const segHasAnyEnabled = epsilonEnabled || minAreaEnabled || maskDilateEnabled || maxPolygonPointsEnabled || maskIouThresholdEnabled || largestOnly;
    const detEffectiveActive = detSectionActive && detHasAnyEnabled;
    const segEffectiveActive = segSectionActive && segHasAnyEnabled;

    // 折叠状态：无激活参数时自动折叠
    const [detCollapsed, setDetCollapsed] = useState<boolean>(!detEffectiveActive);
    const [segCollapsed, setSegCollapsed] = useState<boolean>(!segEffectiveActive);

    const onAccept = () => {
        DetectionAPIDetector.setPostprocessParams({
            min_bbox_area: minBboxArea,
            bbox_padding: bboxPadding,
            min_bbox_area_enabled: minBboxAreaEnabled,
            bbox_padding_enabled: bboxPaddingEnabled,
        });
        SegmentationAPIDetector.setPostprocessParams({
            polygon_epsilon: epsilon,
            min_mask_area: minArea,
            largest_cc_only: largestOnly,
            mask_dilate: maskDilate,
            max_polygon_points: maxPolygonPoints,
            mask_iou_threshold: maskIouThreshold,
            polygon_epsilon_enabled: epsilonEnabled,
            min_mask_area_enabled: minAreaEnabled,
            largest_cc_only_enabled: largestOnly,
            mask_dilate_enabled: maskDilateEnabled,
            max_polygon_points_enabled: maxPolygonPointsEnabled,
            mask_iou_threshold_enabled: maskIouThresholdEnabled,
        });
        backToCallModel();
    };

    const onReset = () => {
        setMinBboxArea(DEF_DET.min_bbox_area);
        setBboxPadding(DEF_DET.bbox_padding);
        setMinBboxAreaEnabled(true);
        setBboxPaddingEnabled(true);
        setEpsilon(DEF.polygon_epsilon);
        setMinArea(DEF.min_mask_area);
        setLargestOnly(DEF.largest_cc_only);
        setMaskDilate(DEF.mask_dilate);
        setMaxPolygonPoints(DEF.max_polygon_points);
        setMaskIouThreshold(DEF.mask_iou_threshold);
        setEpsilonEnabled(true);
        setMinAreaEnabled(true);
        setMaskDilateEnabled(true);
        setMaxPolygonPointsEnabled(true);
        setMaskIouThresholdEnabled(true);
    };

    const epsilonLabel = (v: number) => v === 0 ? (zh ? '关闭' : 'off') : `${v.toFixed(1)} px`;

    const renderContent = () => (
        <div className='PipelinePopupContent'>
            {!isActive && (
                <div className='StageInactiveWarning'>
                    <span className='Dot' />
                    {zh ? '此阶段未激活 · 参数不传入后端' : 'Stage inactive · params not sent to backend'}
                </div>
            )}

            <ScriptSection stage='postprocess' zh={zh} />

            {!showDet && !showSeg && (
                <div className='StageInactiveWarning'>
                    <span className='Dot' />
                    {zh ? '未加载任何模型引擎 · 请先添加引擎' : 'No engine loaded · add an engine first'}
                </div>
            )}

            {showDet && <div className={`ParamSection${!detSectionActive ? ' section-inactive' : !detHasAnyEnabled ? ' section-dimmed' : ''}`}>
                <div className='ParamSectionTitle' onClick={() => setDetCollapsed(c => !c)}>
                    {zh ? '[ 检测参数 ]' : '[ Detection ]'}
                    <span className='SectionTitleLine' />
                    <span className={`SectionChevron${!detCollapsed ? ' open' : ''}`}>▾</span>
                </div>

                {!detCollapsed && <>{/* min_bbox_area */}
                <div className={`ParamRow${!minBboxAreaEnabled ? ' param-disabled' : minBboxArea === 0 ? ' param-zero' : ''}`}>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={minBboxAreaEnabled}
                                onChange={(e) => setMinBboxAreaEnabled(e.target.checked)} />
                            <span className='ParamLabel'>
                                {zh ? 'bbox 最小面积 (像素²)' : 'Min bbox area (pixels²)'}
                            </span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>{minBboxArea}</span>
                            {minBboxArea !== DEF_DET.min_bbox_area && minBboxAreaEnabled && (
                                <button className='ParamResetBtn' onClick={() => setMinBboxArea(DEF_DET.min_bbox_area)}>
                                    ↺ {DEF_DET.min_bbox_area}
                                </button>
                            )}
                        </div>
                    </div>
                    <input type='number' min={0} step={100} value={minBboxArea}
                        disabled={!minBboxAreaEnabled}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => { const v = Math.max(0, Math.floor(Number(e.target.value) || 0)); setMinBboxArea(v); e.target.value = String(v); }} />
                    <div className='ParamDesc'>
                        {zh
                            ? '过滤掉面积（宽×高）小于此阈值的检测框（像素²）。用来去除零散小目标。0 = 不过滤。'
                            : 'Drop detection boxes whose area (w×h) is below this threshold (pixels²). Removes tiny false positives. 0 = no filter.'}
                    </div>
                </div>

                {/* bbox_padding */}
                <div className={`ParamRow${!bboxPaddingEnabled ? ' param-disabled' : bboxPadding === 0 ? ' param-zero' : ''}`}>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={bboxPaddingEnabled}
                                onChange={(e) => setBboxPaddingEnabled(e.target.checked)} />
                            <span className='ParamLabel'>
                                {zh ? 'bbox 扩展边距 (bbox_padding)' : 'BBox padding (bbox_padding)'}
                            </span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>
                                {bboxPadding === 0 ? (zh ? '关闭' : 'off') : `${bboxPadding} px`}
                            </span>
                            {bboxPadding !== DEF_DET.bbox_padding && bboxPaddingEnabled && (
                                <button className='ParamResetBtn' onClick={() => setBboxPadding(DEF_DET.bbox_padding)}>
                                    ↺ {DEF_DET.bbox_padding === 0 ? (zh ? '关闭' : 'off') : `${DEF_DET.bbox_padding} px`}
                                </button>
                            )}
                        </div>
                    </div>
                    <input type='range' min={0} max={50} step={1} value={bboxPadding}
                        disabled={!bboxPaddingEnabled}
                        onChange={(e) => setBboxPadding(Number(e.target.value))} />
                    <div className='ParamDesc'>
                        {zh
                            ? '将每个检测框向四周各扩张 N 像素（裁到图像边界）。用于为后续裁图留白。0 = 不扩展。'
                            : 'Expand each detection box outward by N pixels on all sides (clipped to image bounds). Useful for adding context around crops. 0 = off.'}
                    </div>
                </div>
                </>}
            </div>}

            {showSeg && <div className={`ParamSection${!segSectionActive ? ' section-inactive' : !segHasAnyEnabled ? ' section-dimmed' : ''}`}>
                <div className='ParamSectionTitle' onClick={() => setSegCollapsed(c => !c)}>
                    {zh ? '[ 分割参数 ]' : '[ Segmentation ]'}
                    <span className='SectionTitleLine' />
                    <span className={`SectionChevron${!segCollapsed ? ' open' : ''}`}>▾</span>
                </div>

                {!segCollapsed && <>{/* min_mask_area */}
                <div className={`ParamRow${!minAreaEnabled ? ' param-disabled' : minArea === 0 ? ' param-zero' : ''}`}>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={minAreaEnabled}
                                onChange={(e) => setMinAreaEnabled(e.target.checked)} />
                            <span className='ParamLabel'>
                                {zh ? 'mask 最小面积 (像素²)' : 'Min mask area (pixels²)'}
                            </span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>{minArea}</span>
                            {minArea !== DEF.min_mask_area && minAreaEnabled && (
                                <button className='ParamResetBtn' onClick={() => setMinArea(DEF.min_mask_area)}>
                                    ↺ {DEF.min_mask_area}
                                </button>
                            )}
                        </div>
                    </div>
                    <input type='number' min={0} step={100} value={minArea}
                        disabled={!minAreaEnabled}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => { const v = Math.max(0, Math.floor(Number(e.target.value) || 0)); setMinArea(v); e.target.value = String(v); }} />
                    <div className='ParamDesc'>
                        {zh
                            ? '过滤掉面积小于此阈值的 mask（像素平方）。用来去除零散碎块。0 = 不过滤。'
                            : 'Drop masks below this polygon area (in pixels²). Useful for removing tiny fragments. 0 = no filter.'}
                    </div>
                </div>

                {/* polygon_epsilon */}
                <div className={`ParamRow${!epsilonEnabled ? ' param-disabled' : epsilon === 0 ? ' param-zero' : ''}`}>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={epsilonEnabled}
                                onChange={(e) => setEpsilonEnabled(e.target.checked)} />
                            <span className='ParamLabel'>
                                {zh ? 'Polygon 抽稀 epsilon' : 'Polygon simplify (epsilon)'}
                            </span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>{epsilonLabel(epsilon)}</span>
                            {epsilon !== DEF.polygon_epsilon && epsilonEnabled && (
                                <button className='ParamResetBtn' onClick={() => setEpsilon(DEF.polygon_epsilon)}>
                                    ↺ {epsilonLabel(DEF.polygon_epsilon)}
                                </button>
                            )}
                        </div>
                    </div>
                    <input type='range' min={0} max={10} step={0.1} value={epsilon}
                        disabled={!epsilonEnabled}
                        onChange={(e) => setEpsilon(Number(e.target.value))} />
                    <div className='ParamDesc'>
                        {zh
                            ? 'Douglas–Peucker 算法简化多边形，像素距离阈值。0 = 不抽稀；越大顶点越少、越好手改，但可能丢细节。典型值 1–3 px。'
                            : 'Douglas–Peucker polygon simplification (pixel tolerance). 0 = off; larger = fewer vertices, easier to edit but may lose detail. Typical 1–3 px.'}
                    </div>
                </div>

                {/* max_polygon_points */}
                <div className={`ParamRow${!maxPolygonPointsEnabled ? ' param-disabled' : maxPolygonPoints === 0 ? ' param-zero' : ''}`}>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={maxPolygonPointsEnabled}
                                onChange={(e) => setMaxPolygonPointsEnabled(e.target.checked)} />
                            <span className='ParamLabel'>
                                {zh ? '最大顶点数 (max_polygon_points)' : 'Max polygon points'}
                            </span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>
                                {maxPolygonPoints === 0 ? (zh ? '关闭' : 'off') : `${maxPolygonPoints} pts`}
                            </span>
                            {maxPolygonPoints !== DEF.max_polygon_points && maxPolygonPointsEnabled && (
                                <button className='ParamResetBtn' onClick={() => setMaxPolygonPoints(DEF.max_polygon_points)}>
                                    ↺ {DEF.max_polygon_points === 0 ? (zh ? '关闭' : 'off') : `${DEF.max_polygon_points}`}
                                </button>
                            )}
                        </div>
                    </div>
                    <input type='number' min={0} max={2000} step={10} value={maxPolygonPoints}
                        disabled={!maxPolygonPointsEnabled}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => { const v = Math.max(0, Math.floor(Number(e.target.value) || 0)); setMaxPolygonPoints(v); e.target.value = String(v); }} />
                    <div className='ParamDesc'>
                        {zh
                            ? '限制输出多边形的最大顶点数。使用自适应 RDP 算法压缩到指定点数以内，便于手动修改标签。0 = 不限制。建议值：50–200。'
                            : 'Limit the maximum number of polygon vertices. Uses adaptive RDP to reduce to the target count, making labels easier to edit. 0 = no limit. Suggested: 50–200.'}
                    </div>
                </div>

                {/* mask_dilate */}
                <div className={`ParamRow${!maskDilateEnabled ? ' param-disabled' : maskDilate === 0 ? ' param-zero' : ''}`}>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={maskDilateEnabled}
                                onChange={(e) => setMaskDilateEnabled(e.target.checked)} />
                            <span className='ParamLabel'>
                                {zh ? 'Mask 膨胀半径 (mask_dilate)' : 'Mask dilation radius (mask_dilate)'}
                            </span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>
                                {maskDilate === 0 ? (zh ? '关闭' : 'off') : `${maskDilate} px`}
                            </span>
                            {maskDilate !== DEF.mask_dilate && maskDilateEnabled && (
                                <button className='ParamResetBtn' onClick={() => setMaskDilate(DEF.mask_dilate)}>
                                    ↺ {DEF.mask_dilate === 0 ? (zh ? '关闭' : 'off') : `${DEF.mask_dilate} px`}
                                </button>
                            )}
                        </div>
                    </div>
                    <input type='range' min={1} max={20} step={1} value={maskDilate}
                        disabled={!maskDilateEnabled}
                        onChange={(e) => setMaskDilate(Number(e.target.value))} />
                    <div className='ParamDesc'>
                        {zh
                            ? '对 mask 进行椭圆核形态学膨胀，向外扩张边界（半径像素）。0 = 不膨胀。可用于扩大标注区域或填补边缘空洞。'
                            : 'Morphological dilation with an elliptical kernel (radius in pixels). 0 = off. Useful for expanding mask boundaries or filling edge gaps.'}
                    </div>
                </div>

                {/* mask_iou_threshold */}
                <div className={`ParamRow${!maskIouThresholdEnabled ? ' param-disabled' : ''}`}>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={maskIouThresholdEnabled}
                                onChange={(e) => setMaskIouThresholdEnabled(e.target.checked)} />
                            <span className='ParamLabel'>
                                {zh ? '去重 IoU 阈值 (mask_iou_threshold)' : 'Dedup IoU threshold (mask_iou_threshold)'}
                            </span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>
                                {maskIouThreshold.toFixed(2)}
                            </span>
                            {maskIouThreshold !== DEF.mask_iou_threshold && maskIouThresholdEnabled && (
                                <button className='ParamResetBtn' onClick={() => setMaskIouThreshold(DEF.mask_iou_threshold)}>
                                    ↺ {DEF.mask_iou_threshold.toFixed(2)}
                                </button>
                            )}
                        </div>
                    </div>
                    <input type='range' min={0.05} max={1} step={0.05} value={maskIouThreshold}
                        disabled={!maskIouThresholdEnabled}
                        onChange={(e) => setMaskIouThreshold(Number(e.target.value))} />
                    <div className='ParamDesc'>
                        {zh
                            ? '对同一目标的多个重叠 mask 做 NMS 去重：IoU 超过此阈值的低置信度 mask 将被丢弃。0.5 = 适中；越小去得越激进。关闭 = 不去重。'
                            : 'NMS-style deduplication for overlapping masks: lower-confidence masks with IoU above this threshold are dropped. 0.5 = moderate; lower = more aggressive. Off = no dedup.'}
                    </div>
                </div>

                {/* largest_cc_only */}
                <div className={`ParamRow${!largestOnly ? ' param-disabled' : ''}`}>
                    <div className='ParamHeader'>
                        <label className='ParamLabelRow'>
                            <input type='checkbox' checked={largestOnly}
                                onChange={(e) => setLargestOnly(e.target.checked)} />
                            <span className='ParamLabel'>
                                {zh ? '仅保留最大 mask' : 'Keep only the largest mask'}
                            </span>
                        </label>
                        <div className='ParamValueGroup'>
                            <span className='ParamValue'>
                                {largestOnly ? (zh ? '开启' : 'on') : (zh ? '关闭' : 'off')}
                            </span>
                        </div>
                    </div>
                    <div className='ParamDesc'>
                        {zh
                            ? '单图只保留面积最大的一个 mask，其余丢弃。适合"一张图一个主目标"的场景（例如钢液炉口）。'
                            : 'Keep only the single mask with the largest area per image. Good for "one main target per image" cases.'}
                    </div>
                </div>
                </>}
            </div>}

            <div className='ResetRow'>
                <button onClick={onReset}>{zh ? '恢复默认' : 'Reset to defaults'}</button>
            </div>
        </div>
    );

    return (
        <GenericYesNoPopup
            title={zh ? '后处理' : 'Post-processing'}
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
    const activeModelType: InferenceModelType | null = models.some(m => m.modelType === 'core')
        ? 'custom'
        : null;
    return {
        language: state.general.language,
        activeModelType,
        selectedModelTask: state.aimodels.selectedModelTask,
    };
};
export default connect(mapStateToProps)(PipelinePostprocessPopup);
