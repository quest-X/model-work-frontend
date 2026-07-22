import {DataBatchSyncService} from '../DataBatchSyncService';
import {ImageData, LabelName} from '../../store/labels/types';

describe('DataBatchSyncService', () => {
    it('serializes rectangles and polygon bounding boxes by file index', () => {
        const file = new File(['image'], '炉口.png', {type: 'image/png', lastModified: 1});
        const labels: LabelName[] = [{id: 'hot', name: 'hot'}];
        const image = {
            id: 'image-1',
            fileData: file,
            labelRects: [
                {labelId: 'hot', rect: {x: 10, y: 20, width: 30, height: 40}},
                {labelId: 'hot', rect: {x: 1, y: 1, width: 2, height: 2}, isPrompt: true},
            ],
            labelPolygons: [
                {labelId: 'hot', vertices: [{x: 5, y: 7}, {x: 25, y: 9}, {x: 20, y: 30}]},
            ],
        } as ImageData;

        const metadata = DataBatchSyncService.buildMetadata([file], [image], labels);

        expect(metadata.classes).toEqual([{id: 'hot', name: 'hot'}]);
        expect(metadata.images).toEqual([{
            index: 0,
            regions: [
                {label_id: 'hot', bbox: [10, 20, 30, 40]},
                {label_id: 'hot', bbox: [5, 7, 20, 23]},
            ],
        }]);
    });
});
