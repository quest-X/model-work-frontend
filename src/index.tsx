import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.scss';
import App from './App';
import configureStore from './configureStore';
import { Provider } from 'react-redux';
import { AppInitializer } from './logic/initializer/AppInitializer';
import { registerEngineStore } from './utils/DefaultBackendUrl';
import {AuthPreview} from './views/AuthPreview/AuthPreview';
import {DemoBanner} from './demo/DemoBanner';
import {isDemoMode, prepareDemoMode} from './demo/DemoMode';

const root = ReactDOM.createRoot(document.getElementById('root') || document.createElement('div'));
export const store = configureStore();
registerEngineStore(store);

const renderApp = () => {
    AppInitializer.inti();
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

if (isDemoMode) {
    root.render(<main className='DemoBootstrap'>正在准备大鹅演示数据…</main>);
    prepareDemoMode().then(ready => {
        if (ready) renderApp();
    }).catch(cause => root.render(<main className='DemoBootstrap error'>
        {cause instanceof Error ? cause.message : '演示模式初始化失败'}
    </main>));
} else {
    renderApp();
}
