import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.scss';
import App from './App';
import configureStore from './configureStore';
import {rootReducer} from './store';
import { Provider } from 'react-redux';
import { AppInitializer } from './logic/initializer/AppInitializer';
import { registerEngineStore } from './utils/DefaultBackendUrl';
import {AuthPreview} from './views/AuthPreview/AuthPreview';
import {DemoBanner} from './demo/DemoBanner';
import {isDemoMode, prepareDemoMode} from './demo/DemoMode';

// Store imports can bring this entry through HMR again; keep one owner of the DOM and state.
const runtime: {root: ReactDOM.Root; store: ReturnType<typeof configureStore>; initialized: boolean} =
    import.meta.hot?.data.runtime ?? {
        root: ReactDOM.createRoot(document.getElementById('root') || document.createElement('div')),
        store: configureStore(),
        initialized: false,
    };
const {root} = runtime;
export const store = runtime.store;
if (import.meta.hot) {
    import.meta.hot.data.runtime = runtime;
    store.replaceReducer(rootReducer);
    import.meta.hot.accept();
}
registerEngineStore(store);

const renderApp = () => {
    // shortcut: bootstrap JSX changes need a reload; normal components use Fast Refresh.
    if (runtime.initialized) return;
    AppInitializer.inti();
    runtime.initialized = true;
    root.render(
        <React.StrictMode>
            <Provider store={store}>
                <DemoBanner/>
                <AuthPreview>
                    <App />
                </AuthPreview>
            </Provider>
        </React.StrictMode>
    );
};

if (isDemoMode && !runtime.initialized) {
    root.render(<main className='DemoBootstrap'>正在准备大鹅演示数据…</main>);
    prepareDemoMode().then(ready => {
        if (ready) renderApp();
    }).catch(cause => root.render(<main className='DemoBootstrap error'>
        {cause instanceof Error ? cause.message : '演示模式初始化失败'}
    </main>));
} else {
    renderApp();
}
