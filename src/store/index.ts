import {AnyAction, combineReducers} from 'redux';
import {Action} from './Actions';
import {labelsReducer} from './labels/reducer';
import {generalReducer} from './general/reducer';
import {aiReducer} from './ai/reducer';
import {notificationsReducer} from './notifications/reducer';
import {aiModelsReducer} from './aimodels/reducer';
import {videoReducer} from './video/reducer';
import {queueReducer} from './queue/reducer';
import {tasksReducer} from './tasks/reducer';
import {visualSearchReducer} from './visualSearch/reducer';

const appReducer = combineReducers({
    general: generalReducer,
    labels: labelsReducer,
    ai: aiReducer,
    notifications: notificationsReducer,
    aimodels: aiModelsReducer,
    video: videoReducer,
    queue: queueReducer,
    tasks: tasksReducer,
    visualSearch: visualSearchReducer,
});

export type AppState = ReturnType<typeof appReducer>;

export const rootReducer = (state: AppState | undefined, action: AnyAction): AppState => {
    if (state && action.type === Action.RESET_ANNOTATION_PROJECT) {
        const empty = appReducer(undefined, {type: Action.CLEAR_QUEUE});
        state = {...state, labels: empty.labels, video: empty.video, queue: empty.queue,
            ai: {...state.ai, segmentationResults: [], imageSegmentationResults: new Map(),
                isFullImageInferenceInProgress: false}};
    }
    return appReducer(state, action);
};
