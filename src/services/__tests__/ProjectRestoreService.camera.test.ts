import {ProjectRestoreService} from '../ProjectRestoreService';
import {IndexedDBManager, StoredProjectData} from '../../utils/IndexedDBManager';
import {ImageRepository} from '../../logic/imageRepository/ImageRepository';
import {QueueItemStatus, QueueItemType} from '../../store/queue/types';
import {LocalStorageManager} from '../../utils/LocalStorageManager';
import {ProjectType} from '../../data/enums/ProjectType';
import {Action} from '../../store/Actions';

const mockDispatch = jest.fn();

jest.mock('../../index', () => ({
    store: {
        dispatch: (action: unknown) => mockDispatch(action),
        getState: () => ({general: {projectData: {type: 'OBJECT_DETECTION', name: 'default-project'}}}),
    },
}));

jest.mock('../../logic/imageRepository/ImageRepository', () => ({
    ImageRepository: {
        setActiveFileId: jest.fn(),
        saveFileCache: jest.fn(),
    },
}));

describe('ProjectRestoreService camera durability', () => {
    beforeEach(() => jest.clearAllMocks());

    afterEach(() => jest.restoreAllMocks());

    it('restores the saved project name without changing its type', async () => {
        jest.spyOn(LocalStorageManager, 'getSettings').mockReturnValue({
            ...LocalStorageManager.getSettings(),
            lastSaved: 1,
            projectName: 'agent-demo',
        });

        await expect(ProjectRestoreService.restoreSettings()).resolves.toBe(true);
        expect(mockDispatch).toHaveBeenCalledWith({
            type: Action.UPDATE_PROJECT_DATA,
            payload: {projectData: {type: ProjectType.OBJECT_DETECTION, name: 'agent-demo'}},
        });
    });

    it('restores a camera workspace even though live streams have no image files', async () => {
        const project: StoredProjectData = {
            id: 'workspace:camera',
            workspaceId: 'camera',
            images: [],
            labelNames: [],
            currentImageIndex: 0,
            lastModified: 10,
            version: '3.0.0-recovery',
            queueItems: [{
                id: 'camera-resource-1',
                name: 'North gate',
                type: QueueItemType.CAMERA,
                status: QueueItemStatus.COMPLETED,
                uploadedAt: 1,
                cameraResourceId: 'resource-1',
                cameraChannelId: '101',
                cameraHost: '192.168.10.12',
                cameraModel: 'DS-2CD2686FWDA2-IZS',
            }],
            activeQueueItemId: 'camera-resource-1',
        };
        jest.spyOn(IndexedDBManager, 'loadProject').mockResolvedValue(project);

        await expect(ProjectRestoreService.restoreProject()).resolves.toBe(true);

        expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
            payload: {items: [expect.objectContaining({
                id: 'camera-resource-1',
                type: QueueItemType.CAMERA,
                cameraResourceId: 'resource-1',
            })]},
        }));
        expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
            payload: {itemId: 'camera-resource-1'},
        }));
        expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
            payload: {imageData: []},
        }));
        expect(ImageRepository.setActiveFileId).toHaveBeenCalledWith('camera-resource-1');
        expect(ImageRepository.saveFileCache).toHaveBeenCalledWith('camera-resource-1', []);
    });

    it('presents a camera-only snapshot as interrupted project data', async () => {
        jest.spyOn(IndexedDBManager, 'getProjectMeta').mockResolvedValue({
            imageCount: 0,
            validImageCount: 0,
            labelCount: 0,
            isVideoProject: false,
            hasRecoverableProject: true,
            lastModified: 10,
        });

        await expect(ProjectRestoreService.checkForStoredData()).resolves.toEqual(
            expect.objectContaining({hasProject: true}),
        );
    });
});
