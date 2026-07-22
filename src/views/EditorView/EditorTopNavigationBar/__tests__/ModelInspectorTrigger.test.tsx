import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {ModelInspectorAPI} from '../../../PopupView/ModelInspectorPopup/ModelInspectorAPI';
import {ModelInspectorTrigger} from '../ModelInspectorTrigger';

jest.mock('../../../PopupView/ModelInspectorPopup/ModelInspectorAPI', () => ({
    ModelInspectorAPI: {status: jest.fn()},
}));

describe('ModelInspectorTrigger', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders and opens only after the plugin reports ready', async () => {
        const onOpen = jest.fn();
        (ModelInspectorAPI.status as jest.Mock).mockResolvedValue({status: 'ok'});
        render(<ModelInspectorTrigger
            backendKey='core-a|extension-a'
            disabled={false}
            hasExtensionEngine={true}
            language={Language.CHINESE}
            onOpen={onOpen}
        />);

        expect(screen.queryByTestId('open-model-inspector')).not.toBeInTheDocument();
        fireEvent.click(await screen.findByTestId('open-model-inspector'));
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('stays hidden when the plugin endpoint is unavailable', async () => {
        (ModelInspectorAPI.status as jest.Mock).mockRejectedValue(new Error('404'));
        render(<ModelInspectorTrigger
            backendKey='core-a|extension-a'
            disabled={false}
            hasExtensionEngine={true}
            language={Language.CHINESE}
            onOpen={jest.fn()}
        />);

        await waitFor(() => expect(ModelInspectorAPI.status).toHaveBeenCalledTimes(1));
        expect(screen.queryByTestId('open-model-inspector')).not.toBeInTheDocument();
    });

    it('hides immediately when the backend disconnects', async () => {
        (ModelInspectorAPI.status as jest.Mock).mockResolvedValue({status: 'ok'});
        render(<ModelInspectorTrigger
            backendKey='core-a|extension-a'
            disabled={false}
            hasExtensionEngine={true}
            language={Language.CHINESE}
            onOpen={jest.fn()}
        />);
        await screen.findByTestId('open-model-inspector');

        act(() => {
            window.dispatchEvent(new CustomEvent('opensight:backend-status', {detail: {connected: false}}));
        });
        await waitFor(() => expect(screen.queryByTestId('open-model-inspector')).not.toBeInTheDocument());
    });

    it('does not probe or render without a registered extension engine', async () => {
        (ModelInspectorAPI.status as jest.Mock).mockResolvedValue({status: 'ok'});
        render(<ModelInspectorTrigger
            backendKey='core-a'
            disabled={false}
            hasExtensionEngine={false}
            language={Language.CHINESE}
            onOpen={jest.fn()}
        />);

        await act(async () => Promise.resolve());
        expect(ModelInspectorAPI.status).not.toHaveBeenCalled();
        expect(screen.queryByTestId('open-model-inspector')).not.toBeInTheDocument();
    });

    it('ignores a stale successful probe after the backend disconnects', async () => {
        let resolveStatus: ((value: {status: string}) => void) | undefined;
        (ModelInspectorAPI.status as jest.Mock).mockImplementation(() => new Promise(resolve => {
            resolveStatus = resolve;
        }));
        render(<ModelInspectorTrigger
            backendKey='core-a|extension-a'
            disabled={false}
            hasExtensionEngine={true}
            language={Language.CHINESE}
            onOpen={jest.fn()}
        />);

        act(() => {
            window.dispatchEvent(new CustomEvent('opensight:backend-status', {detail: {connected: false}}));
        });
        await act(async () => {
            resolveStatus?.({status: 'ok'});
        });

        expect(screen.queryByTestId('open-model-inspector')).not.toBeInTheDocument();
    });
});
