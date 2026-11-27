import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {AutoSaveService} from '../../../../services/AutoSaveService';
import {IndexedDBManager} from '../../../../utils/IndexedDBManager';
import {HistoryTasks} from './HistoryTasks';

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
