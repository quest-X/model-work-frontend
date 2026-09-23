import {MachineHistoryService} from '../MachineHistoryService';

const originalFetch = global.fetch;

describe('MachineHistoryService', () => {
    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it('uses the independent machine-history extension routes', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({objects: []}),
        } as Response);

        await MachineHistoryService.status('node/1');
        await MachineHistoryService.objects('node/1');
        await MachineHistoryService.object('node/1', 'program-overflow', 'dlk:2026-09-23:480');

        expect(jest.mocked(global.fetch).mock.calls.map(call => call[0])).toEqual([
            expect.stringContaining('/extensions/machine-history/nodes/node%2F1/status'),
            expect.stringContaining('/extensions/machine-history/nodes/node%2F1/objects?limit=100'),
            expect.stringContaining(
                '/extensions/machine-history/nodes/node%2F1/objects/program-overflow/dlk%3A2026-09-23%3A480',
            ),
        ]);
    });
});
