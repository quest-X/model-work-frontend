import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {PopupWindowType} from '../../../../data/enums/PopupWindowType';
import {QueueDataSyncStatus, QueueItemStatus, QueueItemType} from '../../../../store/queue/types';
import {DataBatchSyncService} from '../../../../services/DataBatchSyncService';
import {TrainingDatasetSelection} from '../../../../services/TrainingDatasetSelection';
import {DataCenterPopup} from '../DataCenterPopup';

jest.mock('../../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({title, renderContent}: {title: React.ReactNode; renderContent: () => React.ReactNode}) => (
        <div><h1>{title}</h1>{renderContent()}</div>
    ),
}));

jest.mock('../../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));

jest.mock('../../../../logic/actions/QueueActions', () => ({
    QueueActions: {switchToQueueItem: jest.fn().mockResolvedValue(undefined)},
}));

jest.mock('../../../../logic/imageRepository/ImageRepository', () => ({
    ImageRepository: {
        getFileCacheSnapshot: jest.fn(() => []),
        hasFileCache: jest.fn(() => false),
    },
}));

jest.mock('../../../../services/DataBatchSyncService', () => ({
    DataBatchSyncService: {syncQueueItem: jest.fn().mockResolvedValue({dataset_id: 'dataset-1', revision: 1})},
}));

jest.mock('../../../../services/TrainingDatasetSelection', () => ({
    TrainingDatasetSelection: {set: jest.fn(), get: jest.fn()},
}));

jest.mock('../../../../utils/DefaultBackendUrl', () => ({
    getEngineBaseUrl: () => 'https://core.test/core_service',
}));

const jsonResponse = (body: unknown, status = 200): Response => ({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
} as unknown as Response);

const localItem = {
    id: 'queue-1',
    name: '导入标注',
    type: QueueItemType.FOLDER,
    files: [new File(['image'], 'frame.jpg', {type: 'image/jpeg'})],
    status: QueueItemStatus.COMPLETED,
    uploadedAt: 1,
    dataSyncStatus: QueueDataSyncStatus.LOCAL,
};

const dataset = {
    id: 'dataset-1',
    name: 'default-project',
    project_name: 'default-project',
    created_at: '2026-07-22T00:00:00Z',
    image_count: 465,
    classes: ['gangye'],
    format: 'opensight-batch',
    source_type: 'file_queue',
    source_id: 'queue-1',
    revision: 1,
};

describe('DataCenterPopup', () => {
    const updateActivePopupTypeAction = jest.fn();
    const updateQueueItemAction = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn((input: RequestInfo) => {
            const url = String(input);
            if (url.endsWith('/datasets')) return Promise.resolve(jsonResponse({datasets: [dataset]}));
            if (url.endsWith('/datasets/dataset-1/stats')) {
                return Promise.resolve(jsonResponse({
                    image_count: 465,
                    annotated_count: 465,
                    annotation_coverage: 1,
                    class_distribution: {gangye: 465},
                }));
            }
            return Promise.resolve(jsonResponse({status: 'success'}));
        }) as jest.Mock;
    });

    const renderPopup = () => render(<DataCenterPopup
        language={Language.CHINESE}
        projectName='default-project'
        queueItems={[localItem]}
        activeQueueItemId='queue-1'
        imagesData={[]}
        labels={[]}
        updateActivePopupTypeAction={updateActivePopupTypeAction}
        updateQueueItemAction={updateQueueItemAction}
    />);

    it('separates browser work data from server snapshots', async () => {
        renderPopup();
        await screen.findByRole('tab', {name: '持久化数据 1'});

        expect(screen.getByText('浏览器工作副本')).toBeInTheDocument();
        expect(screen.getByText('导入标注')).toBeInTheDocument();
        expect(screen.getByText('仅本地')).toBeInTheDocument();
        expect(screen.queryByText('服务器数据快照')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', {name: /持久化数据/}));
        expect(await screen.findByText('服务器数据快照')).toBeInTheDocument();
        expect(await screen.findByText('default-project', {selector: '.DatasetName'})).toBeInTheDocument();
        expect(screen.getByText(/项目 default-project/)).toBeInTheDocument();
    });

    it('syncs a temporary batch from its own card', async () => {
        renderPopup();
        await screen.findByRole('tab', {name: '持久化数据 1'});

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: '同步到服务器'}));
        });

        expect(DataBatchSyncService.syncQueueItem).toHaveBeenCalledWith(localItem, [], []);
    });

    it('does not sync an inactive batch without a trustworthy annotation snapshot', async () => {
        render(<DataCenterPopup
            language={Language.CHINESE}
            projectName='default-project'
            queueItems={[localItem]}
            activeQueueItemId={null}
            imagesData={[]}
            labels={[]}
            updateActivePopupTypeAction={updateActivePopupTypeAction}
            updateQueueItemAction={updateQueueItemAction}
        />);

        await screen.findByRole('tab', {name: '持久化数据 1'});
        const syncButton = await screen.findByRole('button', {name: '先打开后同步'});
        expect(syncButton).toBeDisabled();
        fireEvent.click(syncButton);
        expect(DataBatchSyncService.syncQueueItem).not.toHaveBeenCalled();
    });

    it('shows downstream tasks only inside the expanded persistent dataset', async () => {
        renderPopup();
        await screen.findByRole('tab', {name: '持久化数据 1'});
        fireEvent.click(screen.getByRole('tab', {name: /持久化数据/}));
        await screen.findByText('default-project', {selector: '.DatasetName'});
        expect(screen.queryByRole('button', {name: '训练设置'})).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: /default-project.*465/}));
        expect(await screen.findByText('标注覆盖率')).toBeInTheDocument();
        expect(screen.getByRole('link', {name: '导出数据集'})).toHaveAttribute(
            'href',
            'https://core.test/core_service/datasets/dataset-1/export',
        );
        fireEvent.click(screen.getByRole('button', {name: '训练设置'}));

        expect(TrainingDatasetSelection.set).toHaveBeenCalledWith('dataset-1');
        expect(updateActivePopupTypeAction).toHaveBeenCalledWith(PopupWindowType.TRAINING_TASK);
    });

    it('requires confirmation before deleting a server snapshot', async () => {
        const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
        renderPopup();
        fireEvent.click(await screen.findByRole('tab', {name: '持久化数据 1'}));
        await screen.findByText('default-project', {selector: '.DatasetName'});

        fireEvent.click(screen.getByRole('button', {name: '删除 default-project'}));

        expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('不可撤销'));
        expect((global.fetch as jest.Mock).mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
        confirmSpy.mockRestore();
    });

    it('ignores a stale statistics response after another dataset is selected', async () => {
        const secondDataset = {...dataset, id: 'dataset-2', source_id: null, name: 'second-project'};
        let resolveFirstStats: ((response: Response) => void) | undefined;
        (global.fetch as jest.Mock).mockImplementation((input: RequestInfo) => {
            const url = String(input);
            if (url.endsWith('/datasets')) return Promise.resolve(jsonResponse({datasets: [dataset, secondDataset]}));
            if (url.endsWith('/dataset-1/stats')) {
                return new Promise<Response>(resolve => { resolveFirstStats = resolve; });
            }
            if (url.endsWith('/dataset-2/stats')) {
                return Promise.resolve(jsonResponse({
                    image_count: 12,
                    annotated_count: 6,
                    annotation_coverage: 0.5,
                    class_distribution: {second: 6},
                }));
            }
            return Promise.resolve(jsonResponse({status: 'success'}));
        });
        renderPopup();
        fireEvent.click(screen.getByRole('tab', {name: /持久化数据/}));
        await screen.findByText('second-project');
        fireEvent.click(screen.getByRole('button', {name: /default-project.*465/}));
        fireEvent.click(screen.getByRole('button', {name: /second-project.*465/}));
        expect(await screen.findByText('50%')).toBeInTheDocument();

        await act(async () => {
            resolveFirstStats?.(jsonResponse({
                image_count: 465,
                annotated_count: 465,
                annotation_coverage: 1,
                class_distribution: {stale: 465},
            }));
        });

        await waitFor(() => expect(screen.queryByText('100%')).not.toBeInTheDocument());
        expect(screen.getByText('50%')).toBeInTheDocument();
    });
});
