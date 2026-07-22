import {AutoSaveService} from '../AutoSaveService';
import {ProjectRestoreService} from '../ProjectRestoreService';
import {QueueDataSyncStatus, QueueItemStatus, QueueItemType} from '../../store/queue/types';

const baseItem = {
    id: 'queue-1',
    name: 'batch',
    type: QueueItemType.FOLDER,
    status: QueueItemStatus.COMPLETED,
    uploadedAt: 1,
};

describe('queue data persistence boundaries', () => {
    it('changes the autosave signature when only data sync metadata changes', () => {
        const local = AutoSaveService.queueSignature([{
            ...baseItem,
            dataSyncStatus: QueueDataSyncStatus.LOCAL,
        }]);
        const synced = AutoSaveService.queueSignature([{
            ...baseItem,
            dataSyncStatus: QueueDataSyncStatus.SYNCED,
            datasetId: 'dataset-1',
            datasetRevision: 2,
            syncedAt: 123,
        }]);

        expect(synced).not.toBe(local);
    });

    it('turns an interrupted sync into a retryable error during restore', () => {
        const [restored] = ProjectRestoreService.normalizeQueueItems([{
            ...baseItem,
            dataSyncStatus: QueueDataSyncStatus.SYNCING,
        }]);

        expect(restored.dataSyncStatus).toBe(QueueDataSyncStatus.ERROR);
        expect(restored.dataSyncError).toContain('retry');
    });

    it('preserves a completed data association during restore', () => {
        const synced = {
            ...baseItem,
            dataSyncStatus: QueueDataSyncStatus.SYNCED,
            datasetId: 'dataset-1',
            datasetRevision: 3,
            syncedAt: 456,
        };

        expect(ProjectRestoreService.normalizeQueueItems([synced])[0]).toEqual(synced);
    });
});
