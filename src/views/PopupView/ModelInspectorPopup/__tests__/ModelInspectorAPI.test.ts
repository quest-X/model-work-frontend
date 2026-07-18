import {InspectorAPIError, ModelInspectorAPI} from '../ModelInspectorAPI';


const mockResponse = (body: unknown, status: number = 200): Response => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
} as Response);

describe('ModelInspectorAPI', () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock;
    });

    it('builds an encoded cached-map URL with explicit channel parameters', () => {
        const url = ModelInspectorAPI.mapUrl('session id', 'layer/a', {
            kind: 'channel',
            palette: 'magma',
            channel: 17,
            revision: 3,
        });

        expect(url).toContain('/extensions/model-inspector/sessions/session%20id/layers/layer%2Fa/map?');
        expect(url).toContain('kind=channel');
        expect(url).toContain('palette=magma');
        expect(url).toContain('channel=17');
        expect(url).toContain('v=3');
    });

    it('creates a bounded multipart capture request', async () => {
        fetchMock.mockResolvedValue(mockResponse({id: 'abc', status: 'success'}));
        const file = new File(['pixels'], 'frame.png', {type: 'image/png'});

        await ModelInspectorAPI.createSession(
            file,
            'segmentation',
            ['layer-1', 'layer-2'],
            {imgsz: 640, topK: 8, maxSide: 256},
        );

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('/extensions/model-inspector/sessions');
        expect(init.method).toBe('POST');
        expect(init.body).toBeInstanceOf(FormData);
        const form = init.body as FormData;
        expect(form.get('slot')).toBe('segmentation');
        expect(form.get('layer_ids')).toBe('layer-1,layer-2');
        expect(form.get('top_k')).toBe('8');
    });

    it('surfaces backend detail as a typed API error', async () => {
        fetchMock.mockResolvedValue(mockResponse({detail: '模型已切换'}, 409));

        await expect(ModelInspectorAPI.layers('detection', 'stages')).rejects.toEqual(
            expect.objectContaining<Partial<InspectorAPIError>>({
                name: 'InspectorAPIError',
                message: '模型已切换',
                status: 409,
            }),
        );
    });
});
