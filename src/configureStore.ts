import { createStore, applyMiddleware, compose } from 'redux';
import { rootReducer } from './store';
import { undoMiddleware } from './logic/undo/undoMiddleware';

export default function configureStore() {
    // @ts-ignore
    const devtools = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;
    return createStore(
        rootReducer,
        devtools(applyMiddleware(undoMiddleware))
    );
}