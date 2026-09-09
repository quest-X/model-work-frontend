import axios from 'axios';
import {EditorModel} from '../../staticModels/EditorModel';
import {FrameExtractorService} from '../../services/FrameExtractorService';
import {ImageDataUtil} from '../../utils/ImageDataUtil';
import {PipelineStore} from '../PipelineStore';
import {ScriptStore} from '../ScriptStore';
import {DetectionAPIDetector} from '../DetectionAPIDetector';
import {SegmentationAPIDetector} from '../SegmentationAPIDetector';

jest.mock('axios', () => ({
    __esModule: true,
    default: {
        get: jest.fn(),
        isAxiosError: jest.fn(() => false),
        post: jest.fn(),
    },
}));

jest.mock('../../index', () => ({
    store: {
        getState: jest.fn(() => ({})),
    },
}));

jest.mock('../../store/selectors/AIModelsSelector', () => ({
    AIModelsSelector: {
        getActiveModelByType: jest.fn(() => ({
            id: 'legacy-core',
            name: 'Legacy core engine',
            modelType: 'core',
            url: 'https://localhost:58600/core_service',
        })),
    },
}));

jest.mock('../../utils/DefaultBackendUrl', () => ({
    getDefaultCoreServiceUrl: (path: string = '') =>
        `http://192.168.10.205:3001/core_service${path}`,
    getEngineBaseUrl: () => 'http://192.168.10.205:3001/core_service',
}));

describe('inference gateway routing', () => {
    const post = axios.post as jest.Mock;

    beforeEach(() => {
        post.mockReset().mockResolvedValue({
            data: {status: 'success', results: []},
        });
    });

    it('routes segmentation through the canonical same-origin core service', async () => {
        await SegmentationAPIDetector.predictFromBlob(
            new Blob(['pixels'], {type: 'image/jpeg'}),
            'frame.jpg'
        );

        expect(post).toHaveBeenCalledWith(
            'http://192.168.10.205:3001/core_service/segment',
            expect.any(FormData),
            expect.any(Object)
        );
    });

    it('routes batch detection through the canonical same-origin core service', async () => {
        await DetectionAPIDetector.predictBatchFromBlobs(
            [new Blob(['pixels'], {type: 'image/jpeg'})],
            ['frame.jpg']
        );

        expect(post).toHaveBeenCalledWith(
            'http://192.168.10.205:3001/core_service/batch_detect',
            expect.any(FormData),
            expect.any(Object)
        );
    });
});


afterEach(() => {
    jest.restoreAllMocks();
    EditorModel.videoSessionId = null;
    EditorModel.videoFrameImage = null;
    PipelineStore.setStage('preprocess', false);
    PipelineStore.setStage('inference', false);
    PipelineStore.setStage('postprocess', false);
    ScriptStore.set({preprocess: '', postprocess: '', params: ''});
});

it('fetches an on-demand frame before using a decoded frame and reports missing indices', async () => {
    const frame = new File(['backend frame'], 'frame_12.jpg', {type: 'image/jpeg'});
    const fetchFrame = jest.spyOn(FrameExtractorService, 'fetchFrameRange').mockResolvedValue([frame]);
    const post = axios.post as jest.Mock;
    post.mockReset().mockResolvedValue({data: {status: 'success', results: [], total: 0}});
    EditorModel.videoSessionId = 'session-1';
    EditorModel.videoFrameImage = new Image();
    const success = jest.fn();
    const failure = jest.fn();
    await DetectionAPIDetector.predict(ImageDataUtil.createImageDataFromFileData(new File([], 'frame_12.jpg')), success, failure);
    expect(fetchFrame).toHaveBeenCalledWith('session-1', 12, 1);
    expect((post.mock.calls[0][1] as FormData).get('file')).toMatchObject({name: 'frame_12.jpg', size: frame.size});
    expect(success).toHaveBeenCalledWith([]);
    expect(failure).not.toHaveBeenCalled();
    await DetectionAPIDetector.predict(ImageDataUtil.createImageDataFromFileData(new File([], 'missing.jpg')), success, failure);
    expect(failure).toHaveBeenCalledWith(new Error('Cannot determine frame index from filename'));
    expect(post).toHaveBeenCalledTimes(1);
});

it('preserves segmentation stage and parameter gates including raw script parameters', async () => {
    const post = axios.post as jest.Mock;
    post.mockReset().mockResolvedValue({data: {status: 'success', results: []}});
    PipelineStore.setStage('inference', true);
    PipelineStore.setStage('postprocess', true);
    SegmentationAPIDetector.setInferenceParams({conf: 0.7, conf_enabled: true, iou_enabled: false, classes: ' 1,2 ', classes_enabled: true});
    SegmentationAPIDetector.setPostprocessParams({mask_dilate: 0, mask_dilate_enabled: true, mask_iou_threshold: 0.4, mask_iou_threshold_enabled: true});
    ScriptStore.set({preprocess: 'prepare', postprocess: 'finish', params: '{bad json'});
    await SegmentationAPIDetector.predictFromBlob(new Blob(['image']));
    const form = post.mock.calls[0][1] as FormData;
    expect(form.get('conf')).toBe('0.7');
    expect(form.has('iou')).toBe(false);
    expect(form.has('imgsz')).toBe(false);
    expect(form.get('classes')).toBe('1,2');
    expect(form.has('mask_dilate')).toBe(false);
    expect(form.get('mask_iou_threshold')).toBe('0.4');
    expect(form.has('preprocess_script')).toBe(false);
    expect(form.get('postprocess_script')).toBe('finish');
    expect(form.get('script_params')).toBe('{bad json');
});
