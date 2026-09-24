import {AIStateStorageManager} from '../AIStateStorageManager';
import {Action} from '../../store/Actions';

const storageKey = 'make-sense-ai-state';

describe('AI state storage compatibility', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.spyOn(Date, 'now').mockReturnValue(200000000);
    });

    afterEach(() => jest.restoreAllMocks());

    it.each(['entries', 'object'])('restores %s snapshots into Redux and preserves them on save', format => {
        const entries: Array<[string, unknown]> = [
            ['legacy', {
                aiLabelsVisible: false,
                inferenceHistory: [{timestamp: 123, detectedCount: 4, success: true}],
            }],
            ['oldest', {aiLabelsVisible: true, isInferred: true}],
            ['current', {
                aiLabelsVisible: true,
                segmentationLabelsVisible: false,
                inferenceHistory: [{timestamp: 456, detectedCount: 0, success: false, type: 'segmentation'}],
            }],
        ];
        const stored = JSON.stringify({
            imageAIStates: format === 'object' ? Object.fromEntries(entries) : entries,
            lastSaved: 1234,
            version: '1.0.0',
        });
        localStorage.setItem(storageKey, stored);

        jest.isolateModules(() => {
            const {aiReducer} = jest.requireActual<typeof import('../../store/ai/reducer')>('../../store/ai/reducer');
            const restored = aiReducer(undefined, {
                type: Action.UPDATE_DISABLED_AI_FLAG,
                payload: {isAIDisabled: false},
            }).imageAIStates;

            expect(restored.get('legacy')).toEqual({
                aiLabelsVisible: false,
                segmentationLabelsVisible: true,
                inferenceHistory: [{timestamp: 123, detectedCount: 4, success: true, type: 'detection'}],
            });
            expect(restored.get('oldest')).toMatchObject({
                aiLabelsVisible: true,
                segmentationLabelsVisible: true,
                inferenceHistory: [{timestamp: 113600000, detectedCount: 1, success: true, type: 'detection'}],
            });
            expect(restored.get('current')).toEqual(entries[2][1]);
            expect(localStorage.getItem(storageKey)).toBe(stored);
            expect(AIStateStorageManager.getLastSavedTime()).toBe(1234);

            AIStateStorageManager.saveImageAIStates(restored);
            expect(AIStateStorageManager.loadImageAIStates()).toEqual(restored);
        });
    });

    it('keeps valid state and history when a neighboring entry is malformed', () => {
        localStorage.setItem(storageKey, JSON.stringify({
            imageAIStates: [null, ['broken', null], ['valid', {
                aiLabelsVisible: false,
                inferenceHistory: [null, {timestamp: 'bad'}, {timestamp: 5, detectedCount: 2, success: true}],
            }]],
        }));

        expect(Array.from(AIStateStorageManager.loadImageAIStates())).toEqual([['valid', {
            aiLabelsVisible: false,
            segmentationLabelsVisible: true,
            inferenceHistory: [{timestamp: 5, detectedCount: 2, success: true, type: 'detection'}],
        }]]);
    });
});
