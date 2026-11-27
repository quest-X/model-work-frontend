import type {AppState} from '../../store';
import {addAIModel} from '../../store/aimodels/actionCreators';
import type {AIModelsActionTypes} from '../../store/aimodels/types';
import {getDefaultCoreServiceBase, isLocalOpenSightGateway} from '../../utils/DefaultBackendUrl';

export const restoreLocalCoreEngine = async (store: {
    getState: () => Pick<AppState, 'aimodels'>;
    dispatch: (action: AIModelsActionTypes) => unknown;
}): Promise<void> => {
    const hasCore = () => store.getState().aimodels.models.some(model => model.modelType === 'core');
    if (!isLocalOpenSightGateway() || hasCore()) return;

    const url = getDefaultCoreServiceBase();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(`${url}/health`, {signal: controller.signal});
        if (!response.ok) return;
        const health = await response.json();
        if (health?.status !== 'ok' || health?.engine?.type !== 'core' || hasCore()) return;
        store.dispatch(addAIModel({
            id: 'opensight-local-core',
            name: 'OpenSight Core',
            url,
            modelType: 'core',
            createdAt: new Date(),
            isActive: true,
        }));
    } catch {
        // A stopped backend should not interrupt startup or prevent manual registration.
    } finally {
        clearTimeout(timeout);
    }
};
