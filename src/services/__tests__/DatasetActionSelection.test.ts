import {
    clearDatasetActionSelections,
    DatasetActionTarget,
    DatasetEditSelection,
    DatasetExportSelection,
    DatasetInferenceSelection,
} from '../DatasetActionSelection';

describe('DatasetActionSelection', () => {
    it('clears every pending dataset action when a popup is dismissed', () => {
        const target: DatasetActionTarget = {
            id: 'dataset-1',
            name: 'Dataset 1',
            revision: 1,
            imageCount: 2,
            classCount: 1,
        };
        DatasetEditSelection.set(target);
        DatasetExportSelection.set(target);
        DatasetInferenceSelection.set(target.id);

        clearDatasetActionSelections();

        expect(DatasetEditSelection.get()).toBeNull();
        expect(DatasetExportSelection.get()).toBeNull();
        expect(DatasetInferenceSelection.get()).toBeNull();
    });
});
