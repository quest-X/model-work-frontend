import {GeneralSelector} from '../../store/selectors/GeneralSelector';
import {AgentChatService} from '../AgentChatService';
import {TextDecoder, TextEncoder} from 'util';

beforeEach(() => {
    Object.defineProperty(globalThis, 'TextDecoder', {configurable: true, value: TextDecoder});
});

afterEach(() => jest.restoreAllMocks());

it('sends the signed-in cookie and active project scope to Agent routes', async () => {
    jest.spyOn(GeneralSelector, 'getProjectName').mockReturnValue('project-a');
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({tasks: [], total: 0}),
    });

    await AgentChatService.tasks();

    expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/extensions/llm-control/tasks'),
        expect.objectContaining({
            credentials: 'same-origin',
            headers: expect.objectContaining({'X-OpenSight-Project': 'project-a'}),
        }),
    );
});

const streamedResponse = (chunks: Uint8Array[]) => {
    const reader = {
        read: jest.fn(async () => chunks.length ? {done: false, value: chunks.shift()} : {done: true}),
        cancel: jest.fn(async () => undefined),
        releaseLock: jest.fn(),
    };
    return {
        ok: true,
        headers: new Map([['content-type', 'application/x-ndjson']]),
        body: {getReader: () => reader},
        reader,
    };
};

it('decodes split UTF-8 frames and reports deltas before the final response', async () => {
    jest.spyOn(GeneralSelector, 'getProjectName').mockReturnValue('project-a');
    const final = {conversation_id: 'c1', message: '你好', model: 'local', degraded: false};
    const bytes = new TextEncoder().encode([
        JSON.stringify({type: 'status', phase: 'model'}),
        JSON.stringify({type: 'delta', content: '你好'}),
        JSON.stringify({type: 'done', response: final}),
    ].join('\r\n'));
    const response = streamedResponse(Array.from(bytes, byte => new Uint8Array([byte])));
    global.fetch = jest.fn().mockResolvedValue(response);
    const events = jest.fn();
    expect(await AgentChatService.send('hello', undefined, 'task1', events)).toEqual(final);
    expect(events.mock.calls.map(([event]) => event)).toEqual([
        {type: 'status', phase: 'model'}, {type: 'delta', content: '你好'},
    ]);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/chat'), expect.objectContaining({
        headers: expect.objectContaining({Accept: 'application/x-ndjson', 'X-OpenSight-Project': 'project-a'}),
    }));
    expect(response.reader.cancel).toHaveBeenCalled();
});

it.each([
    [{type: 'delta', content: 'partial'}, 'interrupted'],
    [{type: 'error', detail: '模型超时'}, '模型超时'],
])('rejects an unfinished or failed stream', async (event, reason) => {
    jest.spyOn(GeneralSelector, 'getProjectName').mockReturnValue('project-a');
    global.fetch = jest.fn().mockResolvedValue(streamedResponse([
        new TextEncoder().encode(JSON.stringify(event) + '\n'),
    ]));
    await expect(AgentChatService.send('hello', undefined, undefined, jest.fn())).rejects.toThrow(reason);
});

it('accepts JSON from a pre-streaming backend without retrying a tool request', async () => {
    jest.spyOn(GeneralSelector, 'getProjectName').mockReturnValue('project-a');
    const final = {conversation_id: 'c1', message: 'ok', model: 'old', degraded: false};
    global.fetch = jest.fn().mockResolvedValue({
        ok: true, headers: new Map([['content-type', 'application/json']]), json: async () => final,
    });
    expect(await AgentChatService.send('hello', undefined, undefined, jest.fn())).toEqual(final);
    expect(fetch).toHaveBeenCalledTimes(1);
});
