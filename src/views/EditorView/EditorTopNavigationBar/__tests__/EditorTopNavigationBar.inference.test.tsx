import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
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
jest.mock('../../../../logic/actions/AIDetectionActions', () => ({AIDetectionActions: {detectObjects: jest.fn(), detectBatch: jest.fn(), recognizeSigine: jest.fn()}}));
jest.mock('../../../../logic/actions/AISegmentationActions', () => ({AISegmentationActions: {segmentBatch: jest.fn()}}));

const originalFetch = global.fetch;

async function showToolbar(video = false, selected: number[] = [], activeIndex = 0, customModel = false) {
    const testStore = configureStore();
    (store.getState as jest.Mock).mockImplementation(testStore.getState);
    jest.mocked(store.dispatch).mockImplementation(testStore.dispatch);
    const images = Array.from({length: video ? 3 : 1}, (_, i) => ({...ImageDataUtil.createImageDataFromFileData(new File(['image'], `image-${i}.png`)), isSelected: selected.includes(i)}));
    testStore.dispatch(updateImageData(images));
    testStore.dispatch(updateVideoMode(video));
    testStore.dispatch(updateActiveImageIndex(activeIndex));
    global.fetch = jest.fn(async (input: RequestInfo | URL) => ({
        ok: true, json: async () => String(input).endsWith('/health') ? {
            model: customModel ? 'custom-det.pt' : 'yolov8n.pt', segmentation_model: 'sam2_t.pt',
            loaded_models: ['sam2_t.pt', customModel ? 'custom-det.pt' : 'yolov8n.pt'],
            model_tasks: {'yolov8n.pt': 'detect', 'custom-det.pt': 'detect', 'sam2_t.pt': 'segment'},
        } : {models: []},
    } as Response));
    render(<Provider store={testStore}><EditorTopNavigationBar/></Provider>);
    return await screen.findByRole('button', {name: customModel ? /custom-det/ : /ultralytics\/yolov8n/});
}

afterEach(() => {
    global.fetch = originalFetch;
    localStorage.removeItem('opensight.sigineInfra');
    localStorage.removeItem('opensight.sigineInfraSelection');
    jest.clearAllMocks();
    (AIDetectionActions.detectBatch as jest.Mock).mockReset();
});

const builtinChoices = () => within(screen.getByText(/^内置模型 \(/).closest('details'));
const selectedChoices = () => within(screen.getByText(/^已选模型 \(/).closest('details'));

it('uses explicitly requested existing-workspace frames through the same inference button', async () => {
    const selector = await showToolbar(true, [0, 1]);
    const baseFetch = global.fetch;
    global.fetch = jest.fn((input: RequestInfo | URL) => String(input).endsWith('/sigine-infra/catalog')
        ? Promise.resolve({ok: true, json: async () => ({sources: [{id: 'selected-source', label: 'Chosen source',
            scope: 'online', models: [{id: 'chosen-vision', available: true}]}]})} as Response)
        : baseFetch(input));
    await act(async () => {fireEvent.click(selector);});
    fireEvent.click(await screen.findByLabelText('chosen-vision'));
    fireEvent.click(screen.getAllByLabelText('ultralytics/yolov8n')[0]);
    sessionStorage.setItem('opensight.annotation.imageIndices', '[2]');
    try {
        fireEvent.click(screen.getByRole('button', {name: /^(推理|Infer) x/}));
        await waitFor(() => expect(AIDetectionActions.recognizeSigine).toHaveBeenCalledTimes(1));
        expect(jest.mocked(AIDetectionActions.recognizeSigine).mock.calls[0][0].map(image => image.fileData.name))
            .toEqual(['image-2.png']);
        expect(screen.queryByRole('button', {name: /二次标注/})).not.toBeInTheDocument();
    } finally {
        sessionStorage.removeItem('opensight.annotation.imageIndices');
        localStorage.removeItem('opensight.sigineInfraSelection');
    }
});

it('shows Sigine INFRA beneath the YOLO model and keeps YOLO inference selected', async () => {
    const selector = await showToolbar();
    const baseFetch = global.fetch;
    global.fetch = jest.fn((input: RequestInfo | URL) => String(input).endsWith('/sigine-infra/status')
        ? Promise.resolve({ok: true, json: async () => ({available: true, model: 'gpt-4o'})} as Response)
        : baseFetch(input));
    await act(async () => { fireEvent.click(selector); });
    const yolo = builtinChoices().getByLabelText('ultralytics/yolov8n');
    const infra = await screen.findByText(/Sigine INFRA 推理引擎/);
    expect(yolo.compareDocumentPosition(infra) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(await screen.findByLabelText('gpt-4o'));
    expect(localStorage.getItem('opensight.sigineInfra')).toBe('true');
    expect(selector).toHaveTextContent('ultralytics/yolov8n');
    let finishSigine: () => void;
    jest.mocked(AIDetectionActions.recognizeSigine).mockImplementationOnce(
        () => new Promise<void>(resolve => { finishSigine = resolve; }));
    fireEvent.click(screen.getByRole('button', {name: /^(推理|Infer) x1$/}));
    await waitFor(() => expect(selector).toHaveTextContent('Sigine INFRA(gpt-4o)'));
    expect(AIDetectionActions.recognizeSigine).toHaveBeenCalledTimes(1);
    await act(async () => { finishSigine(); });
    expect(selector).toHaveTextContent('ultralytics/yolov8n');
});

it('shows an unavailable Sigine INFRA row without enabling it', async () => {
    const selector = await showToolbar();
    await act(async () => { fireEvent.click(selector); });
    const infra = await screen.findByText(/Sigine INFRA 推理引擎/);
    await screen.findByText(/未连接/);
    fireEvent.click(infra);
    expect(localStorage.getItem('opensight.sigineInfra')).toBeNull();
});

it('keeps unchecked summary rows until close and synchronizes both model groups', async () => {
    const selector = await showToolbar();
    const baseFetch = global.fetch;
    global.fetch = jest.fn((input: RequestInfo | URL) => String(input).endsWith('/sigine-infra/status')
        ? Promise.resolve({ok: true, json: async () => ({available: true, model: 'vision'})} as Response)
        : baseFetch(input));
    await act(async () => { fireEvent.click(selector); });
    const selectedGroup = screen.getByText('已选模型 (1)').closest('details');
    expect(selectedGroup).toHaveAttribute('open');
    expect(selectedGroup.compareDocumentPosition(screen.getByText('内置模型 (55)')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('外部模型 (1)')).toBeInTheDocument();
    expect(within(selectedGroup).getByText('ultralytics/yolov8n')).toBeInTheDocument();

    fireEvent.click(await screen.findByLabelText('vision'));
    expect(within(selectedGroup).getByText('已选模型 (2)')).toBeInTheDocument();
    expect(screen.getByText('外部模型 (1)')).toBeInTheDocument();
    expect(within(selectedGroup).getByText('Sigine INFRA(vision)')).toBeInTheDocument();
    const yolo = within(selectedGroup).getByRole('checkbox', {name: 'ultralytics/yolov8n'});
    fireEvent.click(yolo);
    expect(yolo).not.toBeChecked();
    expect(screen.getByText('内置模型 (55)')).toBeInTheDocument();
    expect(builtinChoices().getByLabelText('ultralytics/yolov8n')).not.toBeChecked();
    fireEvent.click(yolo);
    expect(yolo).toBeChecked();
    expect(screen.getByText('内置模型 (55)')).toBeInTheDocument();
    expect(builtinChoices().getByLabelText('ultralytics/yolov8n')).toBeChecked();

    const sigine = within(selectedGroup).getByRole('checkbox', {name: 'Sigine INFRA(vision)'});
    fireEvent.click(sigine);
    expect(sigine).not.toBeChecked();
    expect(screen.getByText('外部模型 (1)')).toBeInTheDocument();
    expect(screen.getByLabelText('vision')).not.toBeChecked();
    expect(localStorage.getItem('opensight.sigineInfra')).toBe('false');
    fireEvent.click(sigine);
    expect(sigine).toBeChecked();
    expect(screen.getByText('外部模型 (1)')).toBeInTheDocument();
    expect(screen.getByLabelText('vision')).toBeChecked();

    fireEvent.click(yolo);
    fireEvent.click(sigine);
    expect(within(selectedGroup).getByText('已选模型 (0)')).toBeInTheDocument();
    expect(screen.getByText('内置模型 (55)')).toBeInTheDocument();
    expect(screen.getByText('外部模型 (1)')).toBeInTheDocument();
    expect(within(selectedGroup).getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByRole('button', {name: /^(推理|Infer) x1$/})).toBeDisabled();
    fireEvent.click(selector);
    await act(async () => { fireEvent.click(selector); });
    expect(selectedChoices().queryAllByRole('checkbox')).toHaveLength(0);
    expect(selectedChoices().getByText('暂未选择模型')).toBeInTheDocument();
});

it('counts custom models in addition to catalog variants without counting import buttons', async () => {
    const selector = await showToolbar(false, [], 0, true);
    await act(async () => { fireEvent.click(selector); });
    expect(screen.getByText('内置模型 (56)')).toBeInTheDocument();
    fireEvent.click(selectedChoices().getByRole('checkbox', {name: 'custom-det.pt'}));
    expect(screen.getByText('内置模型 (56)')).toBeInTheDocument();
});

it('counts all source model entries even when unavailable or unchecked', async () => {
    const selector = await showToolbar();
    const baseFetch = global.fetch;
    global.fetch = jest.fn((input: RequestInfo | URL) => String(input).endsWith('/sigine-infra/catalog')
        ? Promise.resolve({ok: true, json: async () => ({model: 'vision', sources: [
            {id: 'account-a', label: 'Account A', scope: 'online', models: [{id: 'vision', available: true}]},
            {id: 'account-b', label: 'Account B', scope: 'online', models: [
                {id: 'vision', available: true}, {id: 'unloaded', available: false}]},
        ]})} as Response) : baseFetch(input));
    await act(async () => { fireEvent.click(selector); });
    expect(await screen.findByText('外部模型 (3)')).toBeInTheDocument();
    expect(screen.getByText('已选模型 (1)')).toBeInTheDocument();
    const source = screen.getByText('Account B').closest('details');
    fireEvent.click(within(source).getByLabelText('vision'));
    expect(screen.getByText('外部模型 (3)')).toBeInTheDocument();
    expect(screen.getByText('已选模型 (2)')).toBeInTheDocument();
    fireEvent.click(selectedChoices().getByRole('checkbox', {name: 'Sigine INFRA(vision)'}));
    expect(screen.getByText('外部模型 (3)')).toBeInTheDocument();
    fireEvent.click(selector);
    await act(async () => { fireEvent.click(selector); });
    expect(await screen.findByText('外部模型 (3)')).toBeInTheDocument();
});

it.each(['selector', 'outside'])('prunes only unchecked rows after closing through %s', async close => {
    const selector = await showToolbar();
    await act(async () => { fireEvent.click(selector); });
    fireEvent.click(builtinChoices().getByLabelText('ultralytics/sam2_t'));
    const yolo = selectedChoices().getByRole('checkbox', {name: 'ultralytics/yolov8n'});
    fireEvent.click(yolo);
    expect(yolo).not.toBeChecked();
    expect(selectedChoices().getByRole('checkbox', {name: 'ultralytics/sam2_t'})).toBeChecked();
    if (close === 'selector') fireEvent.click(selector);
    else fireEvent.mouseDown(document.body);
    expect(screen.queryByText(/^已选模型 \(/)).toBeNull();
    await act(async () => { fireEvent.click(selector); });
    expect(selectedChoices().queryByRole('checkbox', {name: 'ultralytics/yolov8n'})).toBeNull();
    expect(selectedChoices().getByRole('checkbox', {name: 'ultralytics/sam2_t'})).toBeChecked();
    fireEvent.click(builtinChoices().getByLabelText('ultralytics/yolov8n'));
    expect(selectedChoices().getByRole('checkbox', {name: 'ultralytics/yolov8n'})).toBeChecked();
});

it('restores the original Sigine source when a retained row is checked again', async () => {
    const selector = await showToolbar();
    const baseFetch = global.fetch;
    global.fetch = jest.fn((input: RequestInfo | URL) => String(input).endsWith('/sigine-infra/catalog')
        ? Promise.resolve({ok: true, json: async () => ({model: 'vision', sources: [
            {id: 'account-a', label: 'Account A', scope: 'online', models: [{id: 'vision', available: true}]},
            {id: 'account-b', label: 'Account B', scope: 'online', models: [{id: 'vision', available: true}]},
        ]})} as Response) : baseFetch(input));
    await act(async () => { fireEvent.click(selector); });
    const accountA = screen.getByText('Account A').closest('details').querySelector('input');
    const accountB = screen.getByText('Account B').closest('details').querySelector('input');
    fireEvent.click(accountB);
    const summaryB = selectedChoices().getByRole('checkbox', {name: 'Sigine INFRA(vision)'});
    fireEvent.click(summaryB);
    fireEvent.click(accountA);
    expect(selectedChoices().getAllByRole('checkbox', {name: 'Sigine INFRA(vision)'})).toHaveLength(2);
    expect(summaryB).not.toBeChecked();
    fireEvent.click(summaryB);
    expect(accountB).toBeChecked();
    expect(accountA).not.toBeChecked();
    expect(JSON.parse(localStorage.getItem('opensight.sigineInfraSelection'))).toEqual({source_id: 'account-b', model: 'vision'});
    fireEvent.click(selector);
    await act(async () => { fireEvent.click(selector); });
    expect(selectedChoices().getAllByRole('checkbox', {name: 'Sigine INFRA(vision)'})).toHaveLength(1);
    fireEvent.click(selectedChoices().getByRole('checkbox', {name: 'Sigine INFRA(vision)'}));
    fireEvent.mouseDown(document.body);
    await act(async () => { fireEvent.click(selector); });
    expect(selectedChoices().queryByRole('checkbox', {name: 'Sigine INFRA(vision)'})).toBeNull();
    expect(localStorage.getItem('opensight.sigineInfra')).toBe('false');
});

it('keeps retrieval configuration when an unchecked summary row is restored', async () => {
    const selector = await showToolbar();
    const baseFetch = global.fetch;
    global.fetch = jest.fn((input: RequestInfo | URL) => String(input).endsWith('/collections')
        ? Promise.resolve({ok: true, json: async () => ({collections: [{name: 'cats-v1', display_name: 'Cats vectors',
            scene_id: 'scene', scene_name: 'Scene', target_id: 'cats', target_name: 'Cats', version: 1,
            granularity: 'bbox', count: 10, compatible: true}]})} as Response) : baseFetch(input));
    await act(async () => { fireEvent.click(selector); });
    fireEvent.click(await screen.findByLabelText('Cats vectors'));
    expect(screen.getByText('内置模型 (55)')).toBeInTheDocument();
    const retrieval = selectedChoices().getByRole('checkbox', {name: '检索方案 (快速模式-Cats)'});
    fireEvent.click(retrieval);
    expect(retrieval).not.toBeChecked();
    expect(screen.getByText('内置模型 (55)')).toBeInTheDocument();
    expect(screen.getByLabelText('Cats vectors')).not.toBeChecked();
    fireEvent.click(retrieval);
    expect(retrieval).toBeChecked();
    expect(screen.getByText('内置模型 (55)')).toBeInTheDocument();
    expect(screen.getByLabelText('Cats vectors')).toBeChecked();
    fireEvent.click(selector);
    await act(async () => { fireEvent.click(selector); });
    expect(selectedChoices().getByRole('checkbox', {name: '检索方案 (快速模式-Cats)'})).toBeChecked();
});

it('keeps the single-model single-image lightweight inference path', async () => {
    await showToolbar();
    fireEvent.click(screen.getByRole('button', {name: /^(推理|Infer) x1$/}));
    await waitFor(() => expect(AIDetectionActions.detectObjects).toHaveBeenCalledTimes(1));
    expect(AIDetectionActions.detectBatch).not.toHaveBeenCalled();
    expect(AISegmentationActions.segmentBatch).not.toHaveBeenCalled();
});

it('waits for each selected model and stops before launching the next one when cancelled', async () => {
    let finishDetection: () => void;
    (AIDetectionActions.detectBatch as jest.Mock).mockImplementation(() => new Promise<void>(resolve => { finishDetection = resolve; }));
    const selector = await showToolbar();
    fireEvent.click(selector);
    fireEvent.click(screen.getByText('ultralytics/sam2_t'));
    fireEvent.click(screen.getByRole('button', {name: /^(推理|Infer) x1$/}));
    await waitFor(() => expect(AIDetectionActions.detectBatch).toHaveBeenCalledTimes(1));
    expect(AIDetectionActions.detectObjects).not.toHaveBeenCalled();
    expect(AISegmentationActions.segmentBatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: /^(停止|Stop)$/}));
    await act(async () => { finishDetection(); });
    expect(AISegmentationActions.segmentBatch).not.toHaveBeenCalled();
});

it('infers only the current video frame by default', async () => {
    await showToolbar(true, [], 1);
    fireEvent.click(screen.getByRole('button', {name: /^(推理|Infer) x1$/}));
    await waitFor(() => expect(AIDetectionActions.detectObjects).toHaveBeenCalledTimes(1));
    expect((AIDetectionActions.detectObjects as jest.Mock).mock.calls[0][0].fileData.name).toBe('image-1.png');
    expect(AIDetectionActions.detectBatch).not.toHaveBeenCalled();
});

it('infers only the current video frame when Sigine INFRA is selected without a frame selection', async () => {
    const selector = await showToolbar(true);
    const baseFetch = global.fetch;
    global.fetch = jest.fn((input: RequestInfo | URL) => String(input).endsWith('/sigine-infra/status')
        ? Promise.resolve({ok: true, json: async () => ({available: true, model: 'gpt-4o'})} as Response)
        : baseFetch(input));
    await act(async () => { fireEvent.click(selector); });
    fireEvent.click(await screen.findByLabelText('gpt-4o'));
    fireEvent.click(screen.getByRole('button', {name: /^(推理|Infer) x1$/}));
    await waitFor(() => expect(AIDetectionActions.recognizeSigine).toHaveBeenCalledTimes(1));
    expect((AIDetectionActions.recognizeSigine as jest.Mock).mock.calls[0][0][0].fileData.name).toBe('image-0.png');
    expect(AIDetectionActions.detectBatch).toHaveBeenCalledTimes(1);
});

it('keeps an explicit multi-frame selection when Sigine INFRA is selected', async () => {
    (AIDetectionActions.detectBatch as jest.Mock).mockResolvedValue(undefined);
    const selector = await showToolbar(true, [1, 2]);
    const baseFetch = global.fetch;
    global.fetch = jest.fn((input: RequestInfo | URL) => String(input).endsWith('/sigine-infra/status')
        ? Promise.resolve({ok: true, json: async () => ({available: true, model: 'gpt-4o'})} as Response)
        : baseFetch(input));
    await act(async () => { fireEvent.click(selector); });
    fireEvent.click(await screen.findByLabelText('gpt-4o'));
    fireEvent.click(screen.getByRole('button', {name: /^(推理|Infer) x2$/}));
    await waitFor(() => expect(AIDetectionActions.detectBatch).toHaveBeenCalledTimes(1));
    expect((AIDetectionActions.detectBatch as jest.Mock).mock.calls[0][0]).toHaveLength(2);
    expect(AIDetectionActions.detectObjects).not.toHaveBeenCalled();
});

it('uses the selected video frame even when another frame is active', async () => {
    await showToolbar(true, [1]);
    fireEvent.click(screen.getByRole('button', {name: /^(推理|Infer) x1$/}));
    await waitFor(() => expect(AIDetectionActions.detectObjects).toHaveBeenCalledTimes(1));
    expect((AIDetectionActions.detectObjects as jest.Mock).mock.calls[0][0].fileData.name).toBe('image-1.png');
    expect(AIDetectionActions.detectBatch).not.toHaveBeenCalled();
});

it('infers every frame when all video frames are selected', async () => {
    (AIDetectionActions.detectBatch as jest.Mock).mockResolvedValue(undefined);
    await showToolbar(true, [0, 1, 2]);
    fireEvent.click(screen.getByRole('button', {name: /^(推理|Infer) x3$/}));
    await waitFor(() => expect(AIDetectionActions.detectBatch).toHaveBeenCalledTimes(1));
    expect((AIDetectionActions.detectBatch as jest.Mock).mock.calls[0][0]).toHaveLength(3);
    expect(AIDetectionActions.detectObjects).not.toHaveBeenCalled();
});

it('enables inference with only Sigine selected', async () => {
    const selector = await showToolbar();
    const baseFetch = global.fetch;
    global.fetch = jest.fn((input: RequestInfo | URL) => String(input).endsWith('/sigine-infra/status')
        ? Promise.resolve({ok: true, json: async () => ({available: true, model: 'vision'})} as Response) : baseFetch(input));
    await act(async () => { fireEvent.click(selector); });
    fireEvent.click(builtinChoices().getByLabelText('ultralytics/yolov8n'));
    fireEvent.click(await screen.findByLabelText('vision'));
    expect(selector).toHaveTextContent('Sigine INFRA(vision)');
    const infer = screen.getByRole('button', {name: /^(推理|Infer) x1$/});
    expect(infer).not.toBeDisabled();
    fireEvent.click(infer);
    await waitFor(() => expect(AIDetectionActions.recognizeSigine).toHaveBeenCalledTimes(1));
    expect(AIDetectionActions.detectBatch).not.toHaveBeenCalled();
});
