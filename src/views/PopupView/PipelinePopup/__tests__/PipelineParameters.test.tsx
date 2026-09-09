import React from 'react';
import {fireEvent, render, screen, within} from '@testing-library/react';
import {store} from '../../../../index';
import {Language} from '../../../../data/LanguageConfig';
import {PopupWindowType} from '../../../../data/enums/PopupWindowType';
import {updateActivePopupType} from '../../../../store/general/actionCreators';
import {DetectionAPIDetector, DEFAULT_INFERENCE_PARAMS, DEFAULT_DETECTION_POSTPROCESS_PARAMS} from '../../../../ai/DetectionAPIDetector';
import {SegmentationAPIDetector, DEFAULT_SEGMENTATION_INFERENCE_PARAMS, DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS} from '../../../../ai/SegmentationAPIDetector';
import {PipelineStore} from '../../../../ai/PipelineStore';
import ConnectedPreprocess from '../PipelinePreprocessPopup';
import ConnectedInference from '../PipelineInferencePopup';
import ConnectedPostprocess from '../PipelinePostprocessPopup';

jest.mock('../../../../index', () => ({store: {dispatch: jest.fn(), getState: () => ({})}}));
jest.mock('../ScriptSection', () => ({ScriptSection: () => null}));
jest.mock('../../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({renderContent, acceptLabel, onAccept, rejectLabel, onReject}: {
        renderContent: () => React.ReactNode;
        acceptLabel: string;
        onAccept: () => void;
        rejectLabel: string;
        onReject: () => void;
    }) => <div>{renderContent()}<button onClick={onAccept}>{acceptLabel}</button><button onClick={onReject}>{rejectLabel}</button></div>,
}));

const Preprocess = ConnectedPreprocess.WrappedComponent;
const Inference = ConnectedInference.WrappedComponent;
const Postprocess = ConnectedPostprocess.WrappedComponent;
const row = (label: string) => within(screen.getByText(label).closest('.ParamRow') as HTMLElement);

beforeEach(() => {
    jest.clearAllMocks();
    DetectionAPIDetector.setInferenceParams(DEFAULT_INFERENCE_PARAMS);
    DetectionAPIDetector.setPostprocessParams(DEFAULT_DETECTION_POSTPROCESS_PARAMS);
    SegmentationAPIDetector.setInferenceParams(DEFAULT_SEGMENTATION_INFERENCE_PARAMS);
    SegmentationAPIDetector.setPostprocessParams(DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS);
    PipelineStore.setStage('preprocess', false);
    PipelineStore.setStage('inference', false);
    PipelineStore.setStage('postprocess', false);
});

it('saves input size and augmentation to both engines without changing unrelated parameters', () => {
    DetectionAPIDetector.setInferenceParams({imgsz: 960, conf: 0.42});
    render(<Preprocess language={Language.ENGLISH}/>);
    expect(screen.getByText('Stage inactive · params not sent to backend')).toBeInTheDocument();
    fireEvent.click(screen.getByText('▼').parentElement as HTMLElement);
    fireEvent.click(screen.getByText('1280'));
    fireEvent.click(row('Input size (imgsz)').getByRole('checkbox'));
    fireEvent.click(row('Test-time augmentation (augment)').getByRole('checkbox'));
    expect(DetectionAPIDetector.getInferenceParams().imgsz).toBe(960);

    fireEvent.click(screen.getByRole('button', {name: 'Save'}));
    for (const params of [DetectionAPIDetector.getInferenceParams(), SegmentationAPIDetector.getInferenceParams()]) {
        expect(params).toMatchObject({imgsz: 1280, imgsz_enabled: false, augment: true, augment_enabled: true});
    }
    expect(DetectionAPIDetector.getInferenceParams().conf).toBe(0.42);
    expect(JSON.parse(localStorage.getItem('detectionAPI.inferenceParams') as string).imgsz).toBe(1280);
    expect(DetectionAPIDetector.buildParamsDict()).toEqual({});
    expect(store.dispatch).toHaveBeenCalledWith(updateActivePopupType(PopupWindowType.CALL_MODEL));
});

it('discards reset drafts on Back', () => {
    DetectionAPIDetector.setInferenceParams({imgsz: 1280, augment: true});
    const initial = DetectionAPIDetector.getInferenceParams();
    render(<Preprocess language={Language.ENGLISH}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Reset to defaults'}));
    fireEvent.click(screen.getByRole('button', {name: 'Back'}));
    expect(DetectionAPIDetector.getInferenceParams()).toEqual(initial);
    expect(store.dispatch).toHaveBeenCalledWith(updateActivePopupType(PopupWindowType.CALL_MODEL));
});

it('preserves inference switches, numeric normalization and segmentation-only options on Save', () => {
    PipelineStore.setStage('inference', true);
    render(<Inference language={Language.ENGLISH} activeModelType='custom'/>);
    fireEvent.change(row('Confidence threshold (conf)').getByRole('slider'), {target: {value: '0.63'}});
    fireEvent.click(row('NMS IoU threshold (iou)').getByRole('checkbox'));
    expect(row('NMS IoU threshold (iou)').getByRole('slider')).toBeDisabled();
    fireEvent.change(row('Max detections (max_det)').getByRole('spinbutton'), {target: {value: '-5'}});
    fireEvent.click(row('Filter classes (classes)').getByRole('checkbox'));
    fireEvent.change(row('Filter classes (classes)').getByRole('textbox'), {target: {value: ' 1,3 '}});
    fireEvent.click(row('Class-agnostic NMS (agnostic_nms)').getByRole('checkbox'));
    fireEvent.click(row('High-res masks (retina_masks)').getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', {name: 'Save'}));

    expect(DetectionAPIDetector.getInferenceParams()).toMatchObject({conf: 0.63, iou_enabled: false, max_det: 1, classes: ' 1,3 ', classes_enabled: true, agnostic_nms: true});
    expect(SegmentationAPIDetector.getInferenceParams()).toMatchObject({conf: 0.63, iou_enabled: false, max_det: 1, retina_masks: true, retina_masks_enabled: true});
    expect(DetectionAPIDetector.buildParamsDict()).toEqual({conf: 0.63, max_det: 1, agnostic_nms: true, classes: [1, 3]});
});

it('keeps hidden postprocess values while preserving task-specific enablement gates', () => {
    DetectionAPIDetector.setPostprocessParams({min_bbox_area: 400, bbox_padding: 3});
    SegmentationAPIDetector.setPostprocessParams({polygon_epsilon: 2, polygon_epsilon_enabled: true, min_mask_area: 350, mask_dilate: 2, mask_dilate_enabled: true});
    PipelineStore.setStage('postprocess', true);
    render(<Postprocess language={Language.ENGLISH} activeModelType='custom' selectedModelTask='detect'/>);
    expect(screen.queryByText('Min mask area (pixels²)')).not.toBeInTheDocument();
    fireEvent.change(row('Min bbox area (pixels²)').getByRole('spinbutton'), {target: {value: '721.9'}});
    fireEvent.click(row('BBox padding (bbox_padding)').getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', {name: 'Save'}));

    expect(DetectionAPIDetector.getPostprocessParams()).toEqual({min_bbox_area: 721, min_bbox_area_enabled: true, bbox_padding: 3, bbox_padding_enabled: false});
    expect(SegmentationAPIDetector.getPostprocessParams()).toMatchObject({polygon_epsilon: 2, polygon_epsilon_enabled: false, min_mask_area: 350, min_mask_area_enabled: false, mask_dilate: 2, mask_dilate_enabled: false, mask_iou_threshold_enabled: false});
    expect(DetectionAPIDetector.buildParamsDict()).toEqual({min_bbox_area: 721});
});

it('saves segmentation edits and reset values without losing the disabled parameter values', () => {
    SegmentationAPIDetector.setPostprocessParams({polygon_epsilon: 2, polygon_epsilon_enabled: true});
    render(<Postprocess language={Language.CHINESE} activeModelType='segmentation' selectedModelTask={null}/>);
    fireEvent.change(row('Polygon 抽稀 epsilon').getByRole('slider'), {target: {value: '3.2'}});
    fireEvent.click(row('Polygon 抽稀 epsilon').getByRole('checkbox'));
    fireEvent.change(row('最大顶点数 (max_polygon_points)').getByRole('spinbutton'), {target: {value: '75.8'}});
    fireEvent.click(row('仅保留最大 mask').getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', {name: '保存'}));
    expect(SegmentationAPIDetector.getPostprocessParams()).toMatchObject({polygon_epsilon: 3.2, polygon_epsilon_enabled: false, max_polygon_points: 75, largest_cc_only: true, largest_cc_only_enabled: true});

    fireEvent.click(screen.getByRole('button', {name: '恢复默认'}));
    fireEvent.click(screen.getByRole('button', {name: '保存'}));
    expect(SegmentationAPIDetector.getPostprocessParams()).toMatchObject({polygon_epsilon: DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS.polygon_epsilon, polygon_epsilon_enabled: true, max_polygon_points: DEFAULT_SEGMENTATION_POSTPROCESS_PARAMS.max_polygon_points, largest_cc_only: false, largest_cc_only_enabled: false});
});
