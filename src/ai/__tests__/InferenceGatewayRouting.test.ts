import {store} from '../../index';
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
    sessionStorage.removeItem('opensight.annotation.targetClasses');
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


it('filters annotation targets per browser session without changing inference preferences', async () => {
    const cat = {info: {id: 15, name: 'cat', confidence: 0.9}, bbox: [1, 2, 10, 20]};
    const dog = {info: {id: 16, name: 'dog', confidence: 0.8}, bbox: [2, 3, 20, 30]};
    (axios.post as jest.Mock).mockResolvedValue({data: {status: 'success', results: [cat, dog]}});
    jest.spyOn(FrameExtractorService, 'fetchFrameRange').mockResolvedValue([new File(['frame'], 'frame_0.jpg')]);
    EditorModel.videoSessionId = 'annotation-test';
    const image = ImageDataUtil.createImageDataFromFileData(new File([], 'frame_0.jpg'));
    const success = jest.fn();
    const preferences = DetectionAPIDetector.getInferenceParams();
    sessionStorage.setItem('opensight.annotation.targetClasses', JSON.stringify(['CAT']));
    await DetectionAPIDetector.predict(image, success);
    expect(success).toHaveBeenLastCalledWith([cat]);
    sessionStorage.removeItem('opensight.annotation.targetClasses');
    await DetectionAPIDetector.predict(image, success);
    expect(success).toHaveBeenLastCalledWith([cat, dog]);
    expect(DetectionAPIDetector.getInferenceParams()).toEqual(preferences);
});


describe('annotation label mapping', () => {
    const get = axios.get as jest.Mock;
    beforeEach(() => {
        get.mockReset().mockResolvedValue({data: {state: 'ready', model: 'yolov8n.pt', class_names: ['cat', 'dog']}});
    });
    afterEach(() => sessionStorage.removeItem('opensight.annotation.classMapping'));

    it('rejects wolf without an explicit mapping before any detection request', async () => {
        sessionStorage.setItem('opensight.annotation.targetClasses', '["wolf"]');
        (axios.post as jest.Mock).mockClear();
        await expect(DetectionAPIDetector.validateAnnotationTargets()).rejects.toThrow(/yolov8n.pt.*wolf.*class_mapping/);
        expect(axios.post).not.toHaveBeenCalled();
        expect(sessionStorage.getItem('opensight.annotation.classMapping')).toBeNull();
    });

    it('accepts native cats through the detection gateway without scanning machine routes', async () => {
        sessionStorage.setItem('opensight.annotation.targetClasses', '["CAT"]');
        await expect(DetectionAPIDetector.validateAnnotationTargets()).resolves.toBeUndefined();
        expect(get).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledWith('http://192.168.10.205:3001/core_service/load-status', {
            params: {service: 'detection'}, timeout: 5000,
        });
    });

    it('uses the current custom model taxonomy on every validation', async () => {
        sessionStorage.setItem('opensight.annotation.targetClasses', '["wolf"]');
        get.mockResolvedValueOnce({data: {state: 'ready', model: 'custom.pt', class_names: ['wolf', 'ferret']}});
        await expect(DetectionAPIDetector.validateAnnotationTargets()).resolves.toBeUndefined();
        await expect(DetectionAPIDetector.validateAnnotationTargets()).rejects.toThrow(/yolov8n.pt.*wolf/);
    });

    it('rejects a misspelled mapping source instead of silently filtering every result', async () => {
        sessionStorage.setItem('opensight.annotation.targetClasses', '["wolf"]');
        sessionStorage.setItem('opensight.annotation.classMapping', '{"doog":"wolf"}');
        await expect(DetectionAPIDetector.validateAnnotationTargets()).rejects.toThrow(/映射源类别.*doog/);
    });

    it('requires every requested label to remain reachable after mapping', async () => {
        sessionStorage.setItem('opensight.annotation.targetClasses', '["cat","wolf"]');
        sessionStorage.setItem('opensight.annotation.classMapping', '{"cat":"wolf"}');
        await expect(DetectionAPIDetector.validateAnnotationTargets()).rejects.toThrow(/目标类别.*cat/);
        sessionStorage.setItem('opensight.annotation.classMapping', '{"DOG":"Wolf"}');
        await expect(DetectionAPIDetector.validateAnnotationTargets()).resolves.toBeUndefined();
    });

    it.each([undefined, null, [], [''], [123]])('blocks unavailable or invalid class metadata (%p)', async classNames => {
        sessionStorage.setItem('opensight.annotation.targetClasses', '["cat"]');
        get.mockResolvedValue({data: {state: 'ready', class_names: classNames}});
        await expect(DetectionAPIDetector.validateAnnotationTargets()).rejects.toThrow('未提供有效类别表');
    });

    it.each(['loading', 'error', 'not_loaded'])('blocks inference while the model is %s', async state => {
        sessionStorage.setItem('opensight.annotation.targetClasses', '["cat"]');
        get.mockResolvedValue({data: {state, class_names: ['cat']}});
        await expect(DetectionAPIDetector.validateAnnotationTargets()).rejects.toThrow('模型尚未就绪');
    });

    it('reports a metadata request failure before inference', async () => {
        sessionStorage.setItem('opensight.annotation.targetClasses', '["cat"]');
        get.mockRejectedValue(new Error('network error'));
        await expect(DetectionAPIDetector.validateAnnotationTargets()).rejects.toThrow('无法读取当前检测模型的类别表');
    });

    it('does not require class metadata for an unscoped all-objects request', async () => {
        await expect(DetectionAPIDetector.validateAnnotationTargets()).resolves.toBeUndefined();
        expect(get).not.toHaveBeenCalled();
    });

    it('validates the active video intent instead of a leftover global target', async () => {
        const getState = store.getState as jest.Mock;
        getState.mockReturnValue({queue: {activeQueueItemId: 'wolf-video'}});
        sessionStorage.setItem('opensight.annotation.targetClasses', '["cat"]');
        sessionStorage.setItem('opensight.annotation.intents', JSON.stringify({'wolf-video': {targets: ['wolf'], mapping: {}}}));
        try {
            await expect(DetectionAPIDetector.validateAnnotationTargets()).rejects.toThrow(/目标类别.*wolf/);
        } finally {
            getState.mockReturnValue({});
            sessionStorage.removeItem('opensight.annotation.intents');
        }
    });

    it('uses dog geometry for the requested wolf label and retains the raw class', async () => {
        const dog = {info: {id: 16, name: 'dog', confidence: 0.8}, bbox: [1, 2, 30, 40] as [number, number, number, number]};
        const cat = {info: {id: 15, name: 'cat', confidence: 0.9}, bbox: dog.bbox};
        sessionStorage.setItem('opensight.annotation.targetClasses', '["wolf"]');
        sessionStorage.setItem('opensight.annotation.classMapping', '{"dog":"wolf"}');
        await expect(DetectionAPIDetector.validateAnnotationTargets()).resolves.toBeUndefined();
        const mapped = DetectionAPIDetector.filterAnnotationTargets([dog, cat]);
        expect(mapped).toEqual([{...dog, info: {...dog.info, name: 'wolf', sourceName: 'dog', sourceId: 16}}]);
        expect(dog.info.name).toBe('dog');
    });
    it('rejects a mapping to a label outside the user request', async () => {
        sessionStorage.setItem('opensight.annotation.targetClasses', '["wolf"]');
        sessionStorage.setItem('opensight.annotation.classMapping', '{"dog":"cat"}');
        await expect(DetectionAPIDetector.validateAnnotationTargets()).rejects.toThrow('Invalid annotation class mapping');
    });
});


it('retains the cats-only intent after the MCP call and scopes it to its own video', () => {
    const getState = store.getState as jest.Mock;
    getState.mockReturnValue({queue: {activeQueueItemId: 'cats-video'}});
    sessionStorage.setItem('opensight.annotation.intents', JSON.stringify({'cats-video': {targets: ['cat'], mapping: {}}}));
    sessionStorage.removeItem('opensight.annotation.targetClasses');
    const cat = {info: {id: 15, name: 'cat', confidence: 0.9}, bbox: [1, 2, 3, 4] as [number, number, number, number]};
    const dog = {...cat, info: {id: 16, name: 'dog', confidence: 0.9}};
    try {
        expect(DetectionAPIDetector.filterAnnotationTargets([cat, dog])).toEqual([cat]);
        getState.mockReturnValue({queue: {activeQueueItemId: 'other-video'}});
        expect(DetectionAPIDetector.filterAnnotationTargets([cat, dog])).toEqual([cat, dog]);
    } finally {
        getState.mockReturnValue({});
        sessionStorage.removeItem('opensight.annotation.intents');
    }
});
