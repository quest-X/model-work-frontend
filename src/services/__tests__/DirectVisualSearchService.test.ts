import {store} from '../../index';
import {ImageDataUtil} from '../../utils/ImageDataUtil';
import {LabelUtil} from '../../utils/LabelUtil';
import {QuerySnapshotService} from '../QuerySnapshotService';
import {visualSearchAcceptanceService} from '../VisualSearchAcceptanceService';
import {visualSearchJobService} from '../VisualSearchJobService';
import {resolveVisualSearchSource} from '../../views/PopupView/VisualSearchPopup/VisualSearchPopup';
import {loadVisualSearchCollections} from '../../views/PopupView/VisualSearchPopup/VisualSearchCatalog';
import {runDirectVisualSearch} from '../DirectVisualSearchService';

jest.mock('../../index', () => ({store: {getState: jest.fn(), dispatch: jest.fn()}}));
jest.mock('../QuerySnapshotService', () => ({QuerySnapshotService: {capture: jest.fn()}}));
jest.mock('../VisualSearchAcceptanceService', () => ({visualSearchAcceptanceService: {accept: jest.fn()}}));
jest.mock('../VisualSearchJobService', () => ({visualSearchJobService: {start: jest.fn()}}));
jest.mock('../../views/PopupView/VisualSearchPopup/VisualSearchPopup', () => ({
    resolveVisualSearchSource: jest.fn(), createVisualSearchSnapshotInput: jest.fn(input => input),
}));
jest.mock('../../views/PopupView/VisualSearchPopup/VisualSearchCatalog', () => ({
    loadVisualSearchCollections: jest.fn(), collectionSupportsQuery: () => true,
}));
jest.mock('../../logic/actions/SmartAnnotationActions', () => ({SmartAnnotationActions: {getPromptRects: () => []}}));

beforeEach(() => jest.clearAllMocks());

it('accepts only scoped results sequentially and keeps the source lease until acceptance finishes', async () => {
    const image = ImageDataUtil.createImageDataFromFileData(new File(['query'], 'query.png'));
    image.labelRects = [LabelUtil.createLabelRect('class-1', {x: 1, y: 2, width: 10, height: 20})];
    const state = {
        labels: {imagesData: [image], activeImageIndex: 0, activeLabelId: null, labels: []},
        video: {isVideoMode: false, activeVideo: null},
        queue: {items: [{id: 'queue-1', datasetId: 'dataset-1'}], activeQueueItemId: 'queue-1'},
        visualSearch: {jobsById: {job: {result: {items: [
            {resultId: 'first', fileName: 'query.png', path: ''},
            {resultId: 'outside', fileName: 'other.png', path: ''},
            {resultId: 'second', fileName: 'query.png', path: ''},
        ]}}}},
    };
    (store.getState as jest.Mock).mockReturnValue(state);
    (loadVisualSearchCollections as jest.Mock).mockResolvedValue([{name: 'collection', datasetId: null, datasetRevision: null, datasetRevisions: {'dataset-1': 7}}]);
    const release = jest.fn();
    (resolveVisualSearchSource as jest.Mock).mockResolvedValue({release});
    (QuerySnapshotService.capture as jest.Mock).mockResolvedValue({snapshotId: 'snapshot'});
    (visualSearchJobService.start as jest.Mock).mockReturnValue({clientJobId: 'job', done: Promise.resolve({state: 'succeeded'})});
    let finishFirst: () => void;
    let started: () => void;
    const firstStarted = new Promise<void>(resolve => { started = resolve; });
    (visualSearchAcceptanceService.accept as jest.Mock)
        .mockImplementationOnce(() => new Promise<void>(resolve => { finishFirst = resolve; started(); }))
        .mockRejectedValueOnce(new Error('changed target digest'));
    const pending = runDirectVisualSearch({collectionName: 'collection'});
    await Promise.race([firstStarted, pending]);
    expect(visualSearchAcceptanceService.accept).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    finishFirst();
    await expect(pending).resolves.toEqual({returned: 2, accepted: 1, rejected: 1});
    expect(visualSearchAcceptanceService.accept).toHaveBeenNthCalledWith(2, 'job', 'second');
    expect(release).toHaveBeenCalledTimes(1);
    expect(QuerySnapshotService.capture).toHaveBeenCalledWith(expect.objectContaining({
        selectedCollection: expect.objectContaining({datasetId: 'dataset-1', datasetRevision: 7}),
        query: expect.objectContaining({kind: 'bbox'}),
    }));
});
