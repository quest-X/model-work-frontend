import { createStore, applyMiddleware, compose } from 'redux';
import { rootReducer } from './store';
import { undoMiddleware } from './logic/undo/undoMiddleware';

declare global {
    interface Window {
        __REDUX_DEVTOOLS_EXTENSION_COMPOSE__?: typeof compose;
    }
}

export default function configureStore() {
    const devtools = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;
    return createStore(
        rootReducer,
        devtools(applyMiddleware(undoMiddleware))
    );
}