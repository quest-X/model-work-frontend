import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Provider} from 'react-redux';
import configureStore from '../../../../configureStore';
import {store} from '../../../../index';
import {updateImageData, updateActiveImageIndex} from '../../../../store/labels/actionCreators';
import {ImageDataUtil} from '../../../../utils/ImageDataUtil';
import {AIDetectionActions} from '../../../../logic/actions/AIDetectionActions';
import {AISegmentationActions} from '../../../../logic/actions/AISegmentationActions';
import EditorTopNavigationBar from '../EditorTopNavigationBar';

jest.mock('../../../../index', () => ({store: {getState: jest.fn(), dispatch: jest.fn()}}));
jest.mock('../../../../logic/actions/AIDetectionActions', () => ({AIDetectionActions: {detectObjects: jest.fn(), detectBatch: jest.fn()}}));
jest.mock('../../../../logic/actions/AISegmentationActions', () => ({AISegmentationActions: {segmentBatch: jest.fn()}}));

const originalFetch = global.fetch;

async function showToolbar() {
    const testStore = configureStore();
    (store.getState as jest.Mock).mockImplementation(testStore.getState);
    jest.mocked(store.dispatch).mockImplementation(testStore.dispatch);
    testStore.dispatch(updateImageData([ImageDataUtil.createImageDataFromFileData(new File(['image'], 'image.png'))]));
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
    jest.clearAllMocks();
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
