import { combineReducers } from 'redux';
import {labelsReducer} from './labels/reducer';
import {generalReducer} from './general/reducer';
import {aiReducer} from './ai/reducer';
import {notificationsReducer} from './notifications/reducer';
import {aiModelsReducer} from './aimodels/reducer';
import {videoReducer} from './video/reducer';
import {queueReducer} from './queue/reducer';
import {tasksReducer} from './tasks/reducer';

export const rootReducer = combineReducers({
    general: generalReducer,
    labels: labelsReducer,
    ai: aiReducer,
    notifications: notificationsReducer,
    aimodels: aiModelsReducer,
    video: videoReducer,
    queue: queueReducer,
    tasks: tasksReducer
});

export type AppState = ReturnType<typeof rootReducer>;
