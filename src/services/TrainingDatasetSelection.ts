let selectedDatasetId: string | null = null;

export const TrainingDatasetSelection = {
    get(): string | null {
        return selectedDatasetId;
    },

    set(datasetId: string | null): void {
        selectedDatasetId = datasetId;
    },
};
