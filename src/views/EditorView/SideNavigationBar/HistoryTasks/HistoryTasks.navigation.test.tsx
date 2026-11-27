import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {AutoSaveService} from '../../../../services/AutoSaveService';
import {IndexedDBManager} from '../../../../utils/IndexedDBManager';
import {HistoryTasks} from './HistoryTasks';
import {QueueItemType} from '../../../../store/queue/types';

jest.mock('../../../../services/AutoSaveService', () => ({
    AutoSaveService: {saveCurrentState: jest.fn()},
}));
jest.mock('../../../../utils/IndexedDBManager', () => ({
    IndexedDBManager: {
        listAnnotatedProjects: jest.fn(), getWorkspaceId: jest.fn(),
        getWorkspaceSaveTime: jest.fn(), getProjectMeta: jest.fn(),
        deleteAnnotatedProject: jest.fn(),
    },
}));

beforeEach(() => jest.clearAllMocks());

it('shows the same video title as the file queue', async () => {
    const database = IndexedDBManager as jest.Mocked<typeof IndexedDBManager>;
    database.listAnnotatedProjects.mockResolvedValue([{
        workspaceId: 'video-workspace', projectName: 'cat_7429360',
        queueDisplay: {name: 'cat_7429360', type: QueueItemType.VIDEO, totalFrames: 900, fps: 30},
        labelCount: 880, imageCount: 900, isVideoProject: true, lastModified: 1,
    } as never]);
    render(<HistoryTasks language={Language.CHINESE}/>);
    expect(await screen.findByText('cat_7429360 (900 帧 @ 30fps)')).toBeInTheDocument();
    expect(screen.getByText('880/900 帧已标注')).toBeInTheDocument();
});

it('refreshes embedded history from the shared sidebar without adding a second header', async () => {
    const database = IndexedDBManager as jest.Mocked<typeof IndexedDBManager>;
    const task = {workspaceId: 'saved', projectName: 'before', imageCount: 2,
        validImageCount: 2, labelCount: 1, isVideoProject: false,
        hasRecoverableProject: true, lastModified: 1};
    database.listAnnotatedProjects.mockReset()
        .mockResolvedValueOnce([task])
        .mockResolvedValueOnce([{...task, projectName: 'after'}]);
    const {rerender} = render(<HistoryTasks language={Language.CHINESE} embedded refreshToken={0}/>);
    expect(await screen.findByText('before')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: '刷新历史任务'})).not.toBeInTheDocument();
    rerender(<HistoryTasks language={Language.CHINESE} embedded refreshToken={1}/>);
    expect(await screen.findByText('after')).toBeInTheDocument();
    expect(database.listAnnotatedProjects).toHaveBeenCalledTimes(2);
});

it('keeps the current editor open when its recovery snapshot could not be saved', async () => {
    const save = AutoSaveService.saveCurrentState as jest.Mock;
    const database = IndexedDBManager as jest.Mocked<typeof IndexedDBManager>;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(100);
    save.mockResolvedValue(undefined);
    database.getWorkspaceId.mockReturnValue('current-workspace');
    database.getWorkspaceSaveTime.mockResolvedValue(10);
    database.listAnnotatedProjects.mockResolvedValue([{
        workspaceId: 'older-workspace', projectName: 'dog_4166347',
        labelCount: 1, imageCount: 2, isVideoProject: true, lastModified: 1,
    } as never]);
    try {
        render(<HistoryTasks language={Language.CHINESE}/>);
        fireEvent.click(await screen.findByTitle('在当前页面打开此任务'));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('当前任务保存失败'));
        expect(save).toHaveBeenCalledWith(true);
        expect(database.getWorkspaceSaveTime).toHaveBeenCalledWith('current-workspace');
        expect(database.getProjectMeta).not.toHaveBeenCalledWith('older-workspace');
        expect(window.location.search).toBe('');
    } finally {
        clock.mockRestore();
    }
});

it('deletes a confirmed historical task without opening it', async () => {
    const save = AutoSaveService.saveCurrentState as jest.Mock;
    const database = IndexedDBManager as jest.Mocked<typeof IndexedDBManager>;
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const clock = jest.spyOn(Date, 'now').mockReturnValue(100);
    save.mockResolvedValue(undefined);
    database.getWorkspaceId.mockReturnValue('current-workspace');
    database.getWorkspaceSaveTime.mockResolvedValue(100);
    database.deleteAnnotatedProject.mockResolvedValue(true);
    database.listAnnotatedProjects.mockReset()
        .mockResolvedValueOnce([{
            workspaceId: 'older-workspace', projectName: 'dog_4166347',
            labelCount: 1, imageCount: 2, isVideoProject: true, lastModified: 1,
        } as never])
        .mockResolvedValueOnce([]);
    try {
        render(<HistoryTasks language={Language.CHINESE}/>);
        fireEvent.click(await screen.findByRole('button', {name: '删除历史任务 dog_4166347'}));
        await waitFor(() => expect(database.deleteAnnotatedProject)
            .toHaveBeenCalledWith('older-workspace', 1));
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(database.getProjectMeta).not.toHaveBeenCalled();
        expect(await screen.findByText('还没有已保存的标注任务')).toBeInTheDocument();
    } finally {
        confirm.mockRestore();
        clock.mockRestore();
    }
});
