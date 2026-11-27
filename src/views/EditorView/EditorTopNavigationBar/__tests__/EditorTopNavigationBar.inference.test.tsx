import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Provider} from 'react-redux';
import configureStore from '../../../../configureStore';
import {store} from '../../../../index';
import {updateImageData, updateActiveImageIndex} from '../../../../store/labels/actionCreators';
import {updateVideoMode} from '../../../../store/video/actionCreators';
import {ImageDataUtil} from '../../../../utils/ImageDataUtil';
import {AIDetectionActions} from '../../../../logic/actions/AIDetectionActions';
import {AISegmentationActions} from '../../../../logic/actions/AISegmentationActions';
import EditorTopNavigationBar from '../EditorTopNavigationBar';

jest.mock('../../../../index', () => ({store: {getState: jest.fn(), dispatch: jest.fn()}}));
jest.mock('../../../../logic/actions/AIDetectionActions', () => ({AIDetectionActions: {detectObjects: jest.fn(), detectBatch: jest.fn()}}));
jest.mock('../../../../logic/actions/AISegmentationActions', () => ({AISegmentationActions: {segmentBatch: jest.fn()}}));

const originalFetch = global.fetch;

async function showToolbar(video = false, selected: number[] = []) {
    const testStore = configureStore();
    (store.getState as jest.Mock).mockImplementation(testStore.getState);
    jest.mocked(store.dispatch).mockImplementation(testStore.dispatch);
    const images = Array.from({length: video ? 3 : 1}, (_, i) => ({...ImageDataUtil.createImageDataFromFileData(new File(['image'], `image-${i}.png`)), isSelected: selected.includes(i)}));
    testStore.dispatch(updateImageData(images));
    testStore.dispatch(updateVideoMode(video));
    testStore.dispatch(updateActiveImageIndex(0));
    global.fetch = jest.fn(async (input: RequestInfo | URL) => ({
        ok: true, json: async () => String(input).endsWith('/health') ? {
            model: 'yolov8n.pt', segmentation_model: 'sam2_t.pt',
            loaded_models: ['sam2_t.pt', 'yolov8n.pt'], model_tasks: {'yolov8n.pt': 'detect', 'sam2_t.pt': 'segment'},
        } : {models: []},
    } as Response));
    render(<Provider store={testStore}><EditorTopNavigationBar/></Provider>);
    return await screen.findByRole('button', {name: /yolov8n.pt/});
}

afterEach(() => {
    global.fetch = originalFetch;
    localStorage.removeItem('opensight.sigineInfra');
    jest.clearAllMocks();
});

it('shows Sigine INFRA beneath the YOLO model and keeps YOLO inference selected', async () => {
    const selector = await showToolbar();
    const baseFetch = global.fetch;
    global.fetch = jest.fn((input: RequestInfo | URL) => String(input).endsWith('/sigine-infra/status')
        ? Promise.resolve({ok: true, json: async () => ({available: true, model: 'gpt-4o'})} as Response)
        : baseFetch(input));
    await act(async () => { fireEvent.click(selector); });
    const yolo = screen.getByText('检测模型 (yolov8n.pt)', {selector: 'div'});
    const infra = await screen.findByText(/Sigine INFRA 推理引擎/);
    expect(yolo.compareDocumentPosition(infra) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(infra);
    expect(localStorage.getItem('opensight.sigineInfra')).toBe('true');
    fireEvent.click(screen.getByRole('button', {name: /^(推理|Infer)$/}));
    await waitFor(() => expect(AIDetectionActions.detectObjects).toHaveBeenCalledTimes(1));
});

it('shows an unavailable Sigine INFRA row without enabling it', async () => {
    const selector = await showToolbar();
    await act(async () => { fireEvent.click(selector); });
    const infra = await screen.findByText(/Sigine INFRA 推理引擎/);
    await screen.findByText(/未连接/);
    fireEvent.click(infra);
    expect(localStorage.getItem('opensight.sigineInfra')).toBeNull();
});

it('keeps the single-model single-image lightweight inference path', async () => {
    await showToolbar();
    fireEvent.click(screen.getByRole('button', {name: /^(推理|Infer)$/}));
    await waitFor(() => expect(AIDetectionActions.detectObjects).toHaveBeenCalledTimes(1));
    expect(AIDetectionActions.detectBatch).not.toHaveBeenCalled();
    expect(AISegmentationActions.segmentBatch).not.toHaveBeenCalled();
});

it('waits for each selected model and stops before launching the next one when cancelled', async () => {
    let finishDetection: () => void;
    (AIDetectionActions.detectBatch as jest.Mock).mockImplementation(() => new Promise<void>(resolve => { finishDetection = resolve; }));
    const selector = await showToolbar();
    fireEvent.click(selector);
    fireEvent.click(screen.getByText(/\(sam2_t.pt\)/));
    fireEvent.click(screen.getByRole('button', {name: /^(推理|Infer)$/}));
    await waitFor(() => expect(AIDetectionActions.detectBatch).toHaveBeenCalledTimes(1));
    expect(AIDetectionActions.detectObjects).not.toHaveBeenCalled();
    expect(AISegmentationActions.segmentBatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: /^(停止|Stop)$/}));
    await act(async () => { finishDetection(); });
    expect(AISegmentationActions.segmentBatch).not.toHaveBeenCalled();
});

it('starts one video batch for all frames by default without invoking single-frame inference', async () => {
    (AIDetectionActions.detectBatch as jest.Mock).mockResolvedValue(undefined);
    await showToolbar(true);
    fireEvent.click(screen.getByRole('button', {name: /^(视频推理|Infer video)$/}));
    await waitFor(() => expect(AIDetectionActions.detectBatch).toHaveBeenCalledTimes(1));
    expect((AIDetectionActions.detectBatch as jest.Mock).mock.calls[0][0]).toHaveLength(3);
    expect(AIDetectionActions.detectObjects).not.toHaveBeenCalled();
});

it('honors an explicit video frame selection', async () => {
    (AIDetectionActions.detectBatch as jest.Mock).mockResolvedValue(undefined);
    await showToolbar(true, [1, 2]);
    fireEvent.click(screen.getByRole('button', {name: /^(推理|Infer) x2$/}));
    await waitFor(() => expect(AIDetectionActions.detectBatch).toHaveBeenCalledTimes(1));
    expect((AIDetectionActions.detectBatch as jest.Mock).mock.calls[0][0]).toHaveLength(2);
    expect(AIDetectionActions.detectObjects).not.toHaveBeenCalled();
});
