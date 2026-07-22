import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {VectorDbPopup} from '../VectorDbPopup';

jest.mock('../../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({title, renderContent}: {title: React.ReactNode; renderContent: () => React.ReactNode}) => (
        <div><h1>{title}</h1>{renderContent()}</div>
    ),
}));

jest.mock('../../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));

jest.mock('../../../../utils/DefaultBackendUrl', () => ({
    getEngineBaseUrl: () => 'https://core.test/core_service',
    getExtensionEngineBaseUrl: () => 'https://extension.test/extension_service',
}));

const collection = {
    name: 'frame_index',
    display_name: '产线帧库',
    dim: 768,
    embedder: 'dinov2:base',
    granularity: 'image',
    mode: 'images',
    count: 12,
    created_at: '2026-07-20T10:00:00',
    last_ingest_at: '2026-07-20T11:00:00',
    schema_version: 2,
    profile_id: 'fp_test_image',
    profile: {profile_id: 'fp_test_image', model: 'dinov2:base', dimension: 768, granularity: 'image', metric: 'COSINE'},
    library_id: 'library_test',
    version: 1,
    active: true,
    index_type: 'IVF_FLAT',
    index_params: {nlist: 1024},
    compatible: true,
    compatibility_reason: null,
    quality: {valid_vectors: 12, invalid_vectors: 0, norm_min: 1, norm_max: 1, norm_mean: 1},
};

const readyStatus = {
    status: 'ok',
    vector_store: {state: 'ready', db_path: '/data/vector.db', error: null},
    embedder: {
        state: 'ready', progress: 100, backend: 'dinov2', model: 'facebook/dinov2-base',
        dim: 768, device: 'mps', error: null,
    },
    collections_count: 1,
};

const jsonResponse = (body: unknown, status = 200): Response => ({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
} as unknown as Response);

describe('VectorDbPopup', () => {
    let statusBody: typeof readyStatus;
    let collectionList: Array<typeof collection>;

    beforeEach(() => {
        jest.clearAllMocks();
        statusBody = readyStatus;
        collectionList = [collection];
        global.fetch = jest.fn((input: RequestInfo, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/status')) return Promise.resolve(jsonResponse(statusBody));
            if (url.endsWith('/versions') && init?.method === 'POST') {
                return Promise.resolve(jsonResponse({...collection, name: 'frame_index_v2', version: 2}));
            }
            if (url.endsWith('/collections') && init?.method === 'POST') {
                const request = JSON.parse(String(init.body));
                return Promise.resolve(jsonResponse({
                    ...collection,
                    name: request.name,
                    display_name: request.name,
                    granularity: request.granularity,
                }, 201));
            }
            if (url.endsWith('/collections')) {
                return Promise.resolve(jsonResponse({status: 'success', collections: collectionList}));
            }
            if (url.endsWith('/datasets')) {
                return Promise.resolve(jsonResponse({datasets: [{id: 'dataset-1', name: '一号产线', image_count: 24}]}));
            }
            if (url.endsWith('/jobs')) return Promise.resolve(jsonResponse({status: 'success', jobs: []}));
            if (url.endsWith('/warmup')) return Promise.resolve(jsonResponse({status: 'accepted'}));
            if (url.includes('/ingest')) return Promise.resolve(jsonResponse({status: 'accepted', job_id: 'job-1'}));
            return Promise.resolve(jsonResponse({status: 'success'}));
        }) as jest.Mock;
    });

    it('keeps vector management and quick query separate from the L2G workflow', async () => {
        render(<VectorDbPopup language={Language.CHINESE}/>);

        expect((await screen.findAllByText('产线帧库')).length).toBeGreaterThan(0);
        expect(screen.getByRole('tab', {name: '快速向量检索'})).toBeInTheDocument();
        expect(screen.queryByRole('tab', {name: '高精度检索'})).not.toBeInTheDocument();
        expect(screen.getByText(/高精度检索保持为独立功能/)).toBeInTheDocument();
    });

    it('does not warm up implicitly and exposes an explicit model load action', async () => {
        statusBody = {...readyStatus, embedder: {...readyStatus.embedder, state: 'not_loaded', progress: 0}};
        render(<VectorDbPopup language={Language.CHINESE}/>);

        const loadButton = await screen.findByRole('button', {name: '加载特征模型'});
        expect((global.fetch as jest.Mock).mock.calls.some(([url, init]) =>
            String(url).endsWith('/warmup') && init?.method === 'POST')).toBe(false);

        await act(async () => {
            fireEvent.click(loadButton);
        });
        await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([url, init]) =>
            String(url).endsWith('/warmup') && init?.method === 'POST')).toBe(true));
    });

    it('creates a collection with the explicitly selected immutable vector unit', async () => {
        render(<VectorDbPopup language={Language.CHINESE}/>);
        await screen.findAllByText('产线帧库');

        fireEvent.click(screen.getByRole('button', {name: /新建集合/}));
        fireEvent.click(screen.getByRole('radio', {name: /整张图片/}));
        fireEvent.change(screen.getByPlaceholderText('例如：产线缺陷'), {target: {value: '缺陷整图库'}});
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: '创建集合'}));
        });

        await waitFor(() => {
            const createCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) =>
                String(url).endsWith('/collections') && init?.method === 'POST');
            expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({name: '缺陷整图库', granularity: 'image'});
        });
    });

    it('always ingests with the selected collection mode', async () => {
        render(<VectorDbPopup language={Language.CHINESE}/>);
        await screen.findAllByText('产线帧库');

        fireEvent.change(screen.getByRole('combobox'), {target: {value: 'dataset-1'}});
        const ingestButton = screen.getByRole('button', {name: '开始生成向量'});
        await waitFor(() => expect(ingestButton).toBeEnabled());
        await act(async () => {
            fireEvent.click(ingestButton);
        });

        await waitFor(() => {
            const ingestCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes('/ingest'));
            const body = ingestCall?.[1]?.body as FormData;
            expect(body.get('granularity')).toBe('image');
            expect(body.get('dataset_id')).toBe('dataset-1');
        });
    });

    it('blocks an incompatible profile and creates a current-model physical version', async () => {
        collectionList = [{
            ...collection,
            compatible: false,
            compatibility_reason: 'fp_old 与 fp_current 不兼容',
        }];
        render(<VectorDbPopup language={Language.CHINESE}/>);

        expect(await screen.findByText('当前特征模型与这个版本不兼容')).toBeInTheDocument();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: '新建当前模型版本'}));
        });

        await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([url, init]) =>
            String(url).endsWith('/versions') && init?.method === 'POST')).toBe(true));
    });
});
