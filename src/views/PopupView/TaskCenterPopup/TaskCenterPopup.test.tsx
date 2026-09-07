import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../data/LanguageConfig';
import {ManagedTask, TaskType} from '../../../store/tasks/types';
import {TaskCenterPopupComponent} from './TaskCenterPopup';

jest.mock('../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));
jest.mock('../../../index', () => ({
    store: {getState: jest.fn(() => ({general: {language: Language.CHINESE}}))},
}));
jest.mock('../../../utils/DefaultBackendUrl', () => ({
    getEngineBaseUrl: () => 'https://core.test',
}));
jest.mock('../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({title, renderContent}: {title: React.ReactNode; renderContent: () => React.ReactNode}) => <>
        <h1>{title}</h1>
        {renderContent()}
    </>,
}));

const localTask: ManagedTask = {
    id: 'local-running',
    type: TaskType.DATA_SYNC,
    priority: 'P1',
    title: '同步数据',
    subtitle: '数据集 A',
    progress: 40,
    status: 'running',
    startedAt: 20,
    cancellable: false,
};

it('switches one task list between running and planned tabs', async () => {
    global.fetch = jest.fn(async (url: RequestInfo | URL) => ({
        ok: true,
        json: async () => String(url).includes('dataset-inference') ? {jobs: [
            {job_id: 'queued', state: 'queued', name: '计划推理', dataset_id: 'dataset-a'},
            {job_id: 'done', state: 'completed', name: '已完成推理'},
        ]} : {jobs: [
            {job_id: 'running', state: 'running', name: '模型训练', dataset_id: 'dataset-b', progress: {epoch: 5, total_epochs: 10}},
        ]},
    })) as jest.Mock;

    render(<TaskCenterPopupComponent language={Language.CHINESE} tasks={[localTask]}/>);

    expect(await screen.findByText('模型训练')).toBeInTheDocument();
    expect(screen.getByText('同步数据')).toBeInTheDocument();
    expect(screen.queryByText('计划推理')).not.toBeInTheDocument();
    expect(screen.queryByText('已完成推理')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('tab', {name: '计划任务 1'})).toBeInTheDocument());
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'task-phase-running');

    fireEvent.click(screen.getByRole('tab', {name: '计划任务 1'}));
    expect(screen.getByText('计划推理')).toBeInTheDocument();
    expect(screen.queryByText('模型训练')).not.toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'task-phase-planned');
});
