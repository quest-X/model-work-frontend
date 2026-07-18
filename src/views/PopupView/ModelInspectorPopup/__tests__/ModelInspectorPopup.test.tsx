import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {ImageData} from '../../../../store/labels/types';
import {ModelInspectorPopup} from '../ModelInspectorPopup';
import {InspectionSession, InspectorStatus, ModelInspectorAPI} from '../ModelInspectorAPI';


jest.mock('../../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));

jest.mock('../ModelInspectorAPI', () => {
    const actual = jest.requireActual('../ModelInspectorAPI');
    return {
        ...actual,
        ModelInspectorAPI: {
            status: jest.fn(),
            layers: jest.fn(),
            createSession: jest.fn(),
            deleteSession: jest.fn().mockResolvedValue(undefined),
            createAttribution: jest.fn().mockResolvedValue(undefined),
            mapUrl: jest.fn((_session: string, layer: string) => `data:image/png,${layer}`),
        },
    };
});

const status: InspectorStatus = {
    status: 'ok',
    version: '0.1.0',
    sessions: 0,
    cache_bytes: 0,
    limits: {
        max_upload_mb: 25,
        max_layers: 32,
        max_top_channels: 16,
        max_map_side: 256,
        session_ttl_seconds: 120,
        max_cache_mb: 128,
    },
    slots: [
        {
            slot: 'detection', state: 'ready', model: 'yolo11n.pt', runtime: 'pytorch',
            family: 'yolo', supports_activations: true, supports_attribution: true, reason: null,
        },
        {
            slot: 'segmentation', state: 'not_loaded', model: '', runtime: 'unknown',
            family: 'unknown', supports_activations: false, supports_attribution: false,
            reason: '该模型 slot 尚未加载模型',
        },
    ],
};

const catalog = {
    status: 'success' as const,
    slot: 'detection' as const,
    model: 'yolo11n.pt',
    family: 'yolo',
    runtime: 'pytorch',
    default_layer_ids: ['layer-a', 'layer-b'],
    layers: [
        {id: 'layer-a', path: 'model.0', type: 'Conv', group: 'Backbone', depth: 2, parameters: 464, default_selected: true},
        {id: 'layer-b', path: 'model.1', type: 'Conv', group: 'Backbone', depth: 2, parameters: 4672, default_selected: true},
    ],
};

const session: InspectionSession = {
    status: 'success', id: 'session-1', slot: 'detection', model: 'yolo11n.pt', family: 'yolo', runtime: 'pytorch',
    filename: 'bus.jpg', original_size: [320, 160], input_size: [320, 160], created_at: 1, expires_at: 121,
    elapsed_ms: 42, warnings: [], predictions: [
        {index: 0, class_id: 5, name: 'bus', confidence: 0.91, bbox: [20, 20, 280, 150]},
    ],
    layers: [
        {
            id: 'layer-a', path: 'model.0', type: 'Conv', group: 'Backbone', output_shape: [1, 16, 80, 160],
            layout: 'NCHW', status: 'ready', reason: null, maps: ['mean_abs', 'max_abs', 'eigen'],
            channels: [{index: 7, score: 0.32}],
        },
        {
            id: 'layer-b', path: 'model.1', type: 'Conv', group: 'Backbone', output_shape: [1, 32, 40, 80],
            layout: 'NCHW', status: 'ready', reason: null, maps: ['mean_abs', 'max_abs', 'eigen'],
            channels: [{index: 3, score: 0.21}],
        },
    ],
};

const activeImage: ImageData = {
    id: 'image-1',
    fileData: new File(['pixels'], 'bus.jpg', {type: 'image/jpeg'}),
    loadStatus: true,
    labelRects: [],
    labelPoints: [],
    labelLines: [],
    labelPolygons: [],
    labelNameIds: [],
    isVisitedByRoboflowAPI: false,
};

describe('ModelInspectorPopup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (ModelInspectorAPI.status as jest.Mock).mockResolvedValue(status);
        (ModelInspectorAPI.layers as jest.Mock).mockResolvedValue(catalog);
        (ModelInspectorAPI.createSession as jest.Mock).mockResolvedValue(session);
        (ModelInspectorAPI.deleteSession as jest.Mock).mockResolvedValue(undefined);
        Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: jest.fn(() => 'blob:source')});
        Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: jest.fn()});
    });

    it('captures semantic stages, exposes comparison, and cleans the session on unmount', async () => {
        const view = render(<ModelInspectorPopup language={Language.CHINESE} activeImage={activeImage}/>);

        const capture = await screen.findByTestId('inspector-capture');
        await waitFor(() => expect(capture).toHaveTextContent('生成 2 层透视'));
        await act(async () => fireEvent.click(capture));

        expect(await screen.findByTestId('inspector-view-a')).toBeInTheDocument();
        expect(screen.getAllByText('model.0').length).toBeGreaterThan(0);
        expect(ModelInspectorAPI.createSession).toHaveBeenCalledWith(
            activeImage.fileData,
            'detection',
            ['layer-a', 'layer-b'],
            expect.objectContaining({imgsz: 640, topK: 8, maxSide: 256}),
            expect.any(AbortSignal),
        );

        fireEvent.click(screen.getByText('A/B'));
        expect(await screen.findByTestId('inspector-compare-b')).toBeInTheDocument();
        fireEvent.click(screen.getByText('ch 7'));
        expect(ModelInspectorAPI.mapUrl).toHaveBeenCalled();

        view.unmount();
        await waitFor(() => expect(ModelInspectorAPI.deleteSession).toHaveBeenCalledWith('session-1'));
    });

    it('explains how to enable the plugin when status cannot be reached', async () => {
        (ModelInspectorAPI.status as jest.Mock).mockRejectedValue(new Error('offline'));

        render(<ModelInspectorPopup language={Language.ENGLISH} activeImage={activeImage}/>);

        expect(await screen.findByText('Plugin unavailable')).toBeInTheDocument();
        expect(screen.getByText('OPENSIGHT_PLUGIN_MODEL_INSPECTOR_ENABLED=true')).toBeInTheDocument();
    });
});
