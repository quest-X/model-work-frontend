import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {DatasetInferenceSelection} from '../../../../services/DatasetActionSelection';
import {DatasetInferencePopup} from '../DatasetInferencePopup';

jest.mock('../../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({title, renderContent, rejectLabel, onReject}: any) => <div>
        <h1>{title}</h1>
        {renderContent()}
        <button onClick={onReject}>{rejectLabel}</button>
    </div>,
}));

jest.mock('../../../../services/DatasetActionSelection', () => ({
    DatasetInferenceSelection: {get: jest.fn(), set: jest.fn()},
}));

jest.mock('../../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));

jest.mock('../../../../utils/DefaultBackendUrl', () => ({
    getEngineBaseUrl: () => 'https://core.test/core_service',
}));

const response = (body: unknown): Response => ({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
} as unknown as Response);

describe('DatasetInferencePopup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (DatasetInferenceSelection.get as jest.Mock).mockReturnValue('dataset-1');
        global.fetch = jest.fn((input: RequestInfo, options?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/datasets')) {
                return Promise.resolve(response({datasets: [{id: 'dataset-1', name: 'default-project', image_count: 465}]}));
            }
            if (options?.method === 'POST') return Promise.resolve(response({status: 'success', job_id: 'job-1'}));
            return Promise.resolve(response({jobs: []}));
        }) as jest.Mock;
    });

    it('publishes an automatic labelling job for the selected dataset', async () => {
        render(<DatasetInferencePopup language={Language.CHINESE} />);
        await screen.findByRole('option', {name: 'default-project (465)'});

        fireEvent.change(screen.getByLabelText('置信度'), {target: {value: '0.4'}});
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: '发布推理任务'}));
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
            'https://core.test/core_service/dataset-inference/jobs',
            expect.objectContaining({method: 'POST'}),
        ));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
        const postCall = (global.fetch as jest.Mock).mock.calls.find(([, options]) => options?.method === 'POST');
        expect(JSON.parse(postCall[1].body)).toEqual(expect.objectContaining({
            dataset_id: 'dataset-1',
            confidence: 0.4,
            overwrite_existing: false,
        }));
    });
});
