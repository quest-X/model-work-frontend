/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"http://127.0.0.1:58600/"}
 */

import {createStore} from 'redux';
import {aiModelsReducer} from '../../../store/aimodels/reducer';
import {addAIModel} from '../../../store/aimodels/actionCreators';
import {AIModelsStorageManager} from '../../../utils/AIModelsStorageManager';
import {restoreLocalCoreEngine} from '../restoreLocalCoreEngine';

const createEngineStore = () => {
    const store = createStore(aiModelsReducer, {models: [], activeModelId: null, selectedModelTask: null});
    return {
        getState: () => ({aimodels: store.getState()}),
        dispatch: store.dispatch,
    };
};

const initialFetch = global.fetch;
const healthyCore = () => Promise.resolve({
    ok: true,
    json: async () => ({status: 'ok', engine: {type: 'core'}}),
});

afterEach(() => {
    global.fetch = initialFetch;
    localStorage.clear();
});

it('restores the same-origin core after the browser loses its engine settings', async () => {
    const store = createEngineStore();
    global.fetch = jest.fn(healthyCore) as jest.Mock;

    await restoreLocalCoreEngine(store);

    expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:58600/core_service/health', expect.objectContaining({signal: expect.anything()}),
    );
    expect(store.getState().aimodels.models).toEqual([expect.objectContaining({
        url: 'http://127.0.0.1:58600/core_service', modelType: 'core',
    })]);
    expect(AIModelsStorageManager.loadModels()).toEqual(store.getState().aimodels.models);
});

it('preserves a core engine already configured by the user', async () => {
    const store = createEngineStore();
    const registered = {
        id: 'custom', name: 'Custom', url: 'https://engine.example.test/core_service',
        modelType: 'core' as const, createdAt: new Date(), isActive: true,
    };
    store.dispatch(addAIModel(registered));
    global.fetch = jest.fn(healthyCore) as jest.Mock;

    await restoreLocalCoreEngine(store);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(store.getState().aimodels.models).toEqual([registered]);
});

it('keeps the registry empty when the local gateway does not return a core engine', async () => {
    const store = createEngineStore();
    global.fetch = jest.fn(async () => ({
        ok: true, json: async () => ({status: 'ok', engine: {type: 'extension'}}),
    })) as jest.Mock;

    await restoreLocalCoreEngine(store);

    expect(store.getState().aimodels.models).toEqual([]);
});
