import {inferModelTaskFromName} from '../ModelTaskUtil';

const PRODUCTION_SEGMENTATION_MODELS = [
    '/models/260529_SEG_DLK_gangye_Yv8x_imgsz1024_ep300_B2mAP99493_M2mAP99480.pt',
    '/models/260531_SEG_DLK_gangye_Yv8x_imgsz1024_ep300_B2mAP99496_M2mAP99479.pt',
    '/models/260604_SEG_DLK_gangye_Yv8x_imgsz1024_ep300_B2mAP99494_M2mAP99476.pt',
    '/models/260626_SEG_GBYW_gbyw-out_gbyw_Yv8s_imgsz1152_ep176_B2mAP99401_M2mAP99165.pt',
    '/models/260627_SEG_GBYW_gbyw-out_gbyw_Yv8s_imgsz1280_ep151_B2mAP99420_M2mAP99191.pt',
    '/models/260710_SEG_GBYW_gbyw-out_gbyw_Yv8x_imgsz1280_ep144_B2mAP99379_M2mAP99199.pt',
];

describe('model filename task inference', () => {
    it.each(PRODUCTION_SEGMENTATION_MODELS)('recognizes dated SEG model %s', model => {
        expect(inferModelTaskFromName(model)).toBe('segment');
    });

    it.each([
        'seg_custom.pt',
        'yolov8x-seg.pt',
        'sam2.1_b.pt',
        'FastSAM-x.pt',
        'mobile_sam.onnx',
    ])('keeps existing segmentation conventions for %s', model => {
        expect(inferModelTaskFromName(model)).toBe('segment');
    });

    it.each([
        '260529_DET_DLK_gangye_Yv8x_imgsz1024.pt',
        'yolov8x.pt',
        'consecutive_model.pt',
    ])('does not overmatch detection model %s', model => {
        expect(inferModelTaskFromName(model)).toBe('detect');
    });
});
