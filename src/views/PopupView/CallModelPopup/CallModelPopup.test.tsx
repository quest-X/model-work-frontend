import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../data/LanguageConfig';
import {PopupWindowType} from '../../../data/enums/PopupWindowType';
import {CallModelPopup} from './CallModelPopup';

jest.mock('../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({title, renderContent, acceptLabel, onAccept, disableAcceptButton}: {
        title: React.ReactNode;
        renderContent: () => React.ReactNode;
        acceptLabel: string;
        onAccept: () => void;
        disableAcceptButton: boolean;
    }) => (
        <div>
            <h1>{title}</h1>
            {renderContent()}
            <button type='button' disabled={disableAcceptButton} onClick={onAccept}>{acceptLabel}</button>
        </div>
    ),
}));

jest.mock('./PipelineCanvas', () => function MockPipelineCanvas() {
    return <div data-testid='pipeline-canvas'/>;
});

jest.mock('../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));

jest.mock('../../../utils/DefaultBackendUrl', () => ({
    ...jest.requireActual('../../../utils/DefaultBackendUrl'),
    getDefaultCoreServiceBase: () => 'https://core.test/core_service',
    resolveEngineBaseUrl: () => 'https://core.test/core_service',
}));

jest.mock('../../../utils/HostSystem', () => ({
    getHostSystem: () => 'linux',
    supportsCoreML: () => false,
    showsTensorRTPlaceholder: () => false,
}));

describe('CallModelPopup inference capabilities', () => {
    beforeEach(() => {
        global.fetch = jest.fn(() => new Promise<Response>(() => undefined));
    });

    it('opens OCR from the inference system', async () => {
        const updatePopup = jest.fn();
        render(<CallModelPopup
            updateActivePopupType={updatePopup}
            language={Language.CHINESE}
            aiModels={[{
                id: 'core',
                name: '核心引擎',
                url: 'https://core.test',
                modelType: 'core',
                createdAt: new Date('2026-09-06T00:00:00Z'),
                isActive: true,
            }]}
            activeAIModelId='core'
        />);

        expect(screen.getByRole('heading', {name: '推理系统'})).toBeInTheDocument();
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
        expect(fetch).toHaveBeenCalledWith('https://core.test/core_service/sigine-review/status');
        expect(fetch).toHaveBeenCalledWith('https://core.test/core_service/sigine-infra/catalog');
        fireEvent.click(screen.getByText('文字识别 OCR'));
        fireEvent.click(screen.getByRole('button', {name: '进入'}));
        expect(updatePopup).toHaveBeenCalledWith(PopupWindowType.OCR);
    });

    it('enables Sigine review only when the core engine reports a configured route', async () => {
        localStorage.removeItem('opensight.sigineReview');
        global.fetch = jest.fn(async (url: RequestInfo | URL) => ({ok: true, json: async () =>
            String(url).endsWith('/sigine-review/status') ? {configured: true} : {models: []}} as Response));
        render(<CallModelPopup updateActivePopupType={jest.fn()} language={Language.CHINESE}
            aiModels={[{id: 'core', name: '核心引擎', url: 'https://core.test', modelType: 'core',
                createdAt: new Date('2026-09-06T00:00:00Z'), isActive: true}]} activeAIModelId='core'/>);
        await waitFor(() => expect(screen.queryByText('未配置')).not.toBeInTheDocument());
        fireEvent.click(screen.getByText('Sigine GPT 复审可疑帧'));
        expect(localStorage.getItem('opensight.sigineReview')).toBe('true');
    });

    it('adds an independent Sigine INFRA option only for a catalog-available model', async () => {
        localStorage.removeItem('opensight.sigineInfra');
        global.fetch = jest.fn(async (url: RequestInfo | URL) => ({ok: true, json: async () =>
            String(url).endsWith('/sigine-infra/status')
                ? {configured: true, available: true, model: 'gpt-4o'} : {models: []}} as Response));
        render(<CallModelPopup updateActivePopupType={jest.fn()} language={Language.CHINESE}
            aiModels={[{id: 'core', name: '核心引擎', url: 'https://core.test', modelType: 'core',
                createdAt: new Date('2026-09-06T00:00:00Z'), isActive: true}]} activeAIModelId='core'/>);
        await waitFor(() => expect(screen.getByText('gpt-4o')).toBeInTheDocument());
        fireEvent.click(screen.getByText('gpt-4o'));
        expect(localStorage.getItem('opensight.sigineInfra')).toBe('true');
        expect(localStorage.getItem('opensight.sigineReview')).not.toBe('true');
    });
});
