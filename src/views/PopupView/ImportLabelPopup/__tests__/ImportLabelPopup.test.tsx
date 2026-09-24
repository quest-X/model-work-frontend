import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Provider} from 'react-redux';
import JSZip from 'jszip';
import configureStore from '../../../../configureStore';
import {store} from '../../../../index';
import {Language, LanguageConfig} from '../../../../data/LanguageConfig';
import {COCOObject} from '../../../../data/labels/COCO';
import {VGGObject} from '../../../../data/labels/VGG';
import {LabelType} from '../../../../data/enums/LabelType';
import {updateLanguage} from '../../../../store/general/actionCreators';
import {updateActiveLabelType, updateImageData, updateLabelNames} from '../../../../store/labels/actionCreators';
import {ImageDataUtil} from '../../../../utils/ImageDataUtil';
import {LabelUtil} from '../../../../utils/LabelUtil';
import {PendingImportFiles} from '../../../../utils/PendingImportFiles';
import {ImageRepository} from '../../../../logic/imageRepository/ImageRepository';
import {QueueActions} from '../../../../logic/actions/QueueActions';
import {PopupActions} from '../../../../logic/actions/PopupActions';
import {DataBatchSyncService} from '../../../../services/DataBatchSyncService';
import ImportLabelPopup from '../ImportLabelPopup';

jest.mock('../../../../index', () => ({store: {dispatch: jest.fn(), getState: jest.fn()}}));

const coco: COCOObject = {
    info: {description: 'full archive'},
    images: [{id: 1, file_name: 'new.png', width: 1, height: 1}],
    categories: [{id: 1, name: 'new class'}],
    annotations: [{id: 1, image_id: 1, category_id: 1, iscrowd: 0, area: 1,
        bbox: [0, 0, 1, 1], segmentation: [[0, 0, 1, 0, 1, 1]]}],
};
const vgg: VGGObject = {
    'new.png': {filename: 'new.png', fileref: '', size: 0, base64_img_data: '', file_attributes: {},
        regions: {'0': {region_attributes: {label: 'new class'},
            shape_attributes: {name: 'polygon', all_points_x: [0, 1, 1], all_points_y: [0, 0, 1]}}}},
};
const formats = [
    {format: 'coco', labelType: LabelType.RECT, file: 'annotations.json', text: JSON.stringify(coco)},
    {format: 'voc', labelType: LabelType.RECT, file: 'new.xml', text: '<annotation><filename>new.png</filename>' +
        '<object><name>new class</name><bndbox><xmin>0</xmin><ymin>0</ymin><xmax>1</xmax><ymax>1</ymax>' +
        '</bndbox></object></annotation>'},
    {format: 'vgg', labelType: LabelType.POLYGON, file: 'annotations.json', text: JSON.stringify(vgg)},
];
const cases = formats.flatMap(format => ['full', 'simple'].map(mode => ({...format, mode})));
const texts = LanguageConfig[Language.ENGLISH].popups.importAnnotations;
const nativeFileText = Object.getOwnPropertyDescriptor(File.prototype, 'text');
let testStore: ReturnType<typeof configureStore>;
let existing: ReturnType<typeof ImageDataUtil.createImageDataFromFileData>;
let save: jest.SpyInstance<ReturnType<typeof ImageRepository.saveFileCache>, Parameters<typeof ImageRepository.saveFileCache>>;

beforeAll(() => {
    // jsdom lacks File.text; retain native FileReader bytes for the VOC reader.
    Object.defineProperty(File.prototype, 'text', {configurable: true, value: function(this: File) {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsText(this);
        });
    }});
});

afterAll(() => {
    if (nativeFileText) Object.defineProperty(File.prototype, 'text', nativeFileText);
    else Reflect.deleteProperty(File.prototype, 'text');
});

beforeEach(() => {
    testStore = configureStore();
    jest.mocked(store.dispatch).mockImplementation(testStore.dispatch);
    jest.mocked(store.getState).mockImplementation(testStore.getState);
    testStore.dispatch(updateLanguage(Language.ENGLISH));
    existing = ImageDataUtil.createImageDataFromFileData(new File(['old'], 'new.png'));
    existing.labelRects.push(LabelUtil.createLabelRect('old-class', {x: 0, y: 0, width: 1, height: 1}));
    testStore.dispatch(updateImageData([existing]));
    testStore.dispatch(updateLabelNames([{id: 'old-class', name: 'old class'}]));
    save = jest.spyOn(ImageRepository, 'saveFileCache').mockImplementation(() => undefined);
    jest.spyOn(QueueActions, 'switchToQueueItem').mockResolvedValue(undefined);
    jest.spyOn(DataBatchSyncService, 'syncQueueItem').mockResolvedValue(undefined);
    jest.spyOn(PopupActions, 'close').mockImplementation(() => undefined);
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,thumbnail');
    jest.spyOn(window, 'Image').mockImplementation(() => {
        const image = document.createElement('img');
        image.width = image.height = 1;
        Object.defineProperty(image, 'src', {set() {
            Promise.resolve().then(() => image.dispatchEvent(new Event('load')));
        }});
        return image;
    });
});

afterEach(() => {
    PendingImportFiles.take();
    jest.restoreAllMocks();
});

const archive = async (format: string, mode: string, file: string, text: string) => {
    const zip = new JSZip();
    zip.file(file, text);
    if (mode === 'full') {
        zip.file('images/new.png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=', {base64: true});
    }
    return new File([await zip.generateAsync({type: 'arraybuffer'})], `${format}_${mode}.zip`);
};

it.each(cases)('imports $format $mode archives onto the intended images', async ({format, mode, labelType, file, text}) => {
    testStore.dispatch(updateActiveLabelType(labelType));
    PendingImportFiles.set([await archive(format, mode, file, text)]);
    render(<Provider store={testStore}><ImportLabelPopup/></Provider>);
    const accept = screen.getByText(texts.acceptButton);
    await waitFor(() => expect(accept).not.toHaveClass('disabled'));
    if (mode === 'full') expect(existing.labelRects[0].labelId).toBe('old-class');
    fireEvent.click(accept);
    await waitFor(() => expect(PopupActions.close).toHaveBeenCalledTimes(1));

    const imported = mode === 'full' ? save.mock.calls[0][1] : testStore.getState().labels.imagesData;
    expect(imported.map(image => image.fileData.name)).toEqual(['new.png']);
    expect(imported[0].fileData.size).toBeGreaterThan(0);
    const labels = labelType === LabelType.RECT ? imported[0].labelRects : imported[0].labelPolygons;
    expect(labels).toHaveLength(1);
    expect(testStore.getState().labels.labels).toEqual([
        expect.objectContaining({id: labels[0].labelId, name: 'new class'}),
    ]);
    if (labelType === LabelType.RECT) {
        expect(imported[0].labelRects[0].rect).toEqual({x: 0, y: 0, width: 1, height: 1});
    } else {
        expect(imported[0].labelPolygons[0].vertices).toEqual([{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}]);
    }
    if (mode === 'full') {
        expect(imported[0].id).not.toBe(existing.id);
        expect(existing.labelRects[0].labelId).toBe('old-class');
    } else {
        expect(imported[0].id).toBe(existing.id);
        expect(save).not.toHaveBeenCalled();
    }
});

it('keeps workspace annotations and queue unchanged when a full archive cannot be parsed', async () => {
    PendingImportFiles.set([await archive('coco', 'full', 'annotations.json', '{')]);
    render(<Provider store={testStore}><ImportLabelPopup/></Provider>);
    await screen.findByText(texts.importError);
    expect(screen.getByText(texts.acceptButton)).toHaveClass('disabled');
    expect(save).not.toHaveBeenCalled();
    expect(testStore.getState().queue.items).toEqual([]);
    expect(testStore.getState().labels.imagesData).toEqual([existing]);
    expect(existing.labelRects[0].labelId).toBe('old-class');
    expect(testStore.getState().labels.labels).toEqual([{id: 'old-class', name: 'old class'}]);
});


it('keeps each full zip image attached to its annotations while sharing the merged class', async () => {
    testStore.dispatch(updateActiveLabelType(LabelType.RECT));
    const files = await Promise.all([0, 1].map(async index => {
        const file = await archive('coco', 'full', 'annotations.json', JSON.stringify(coco));
        return new File([file], `coco_full_${index}.zip`);
    }));
    PendingImportFiles.set(files);
    render(<Provider store={testStore}><ImportLabelPopup/></Provider>);
    const accept = screen.getByText(texts.acceptButton);
    await waitFor(() => expect(accept).not.toHaveClass('disabled'));
    fireEvent.click(accept);
    await waitFor(() => expect(PopupActions.close).toHaveBeenCalledTimes(1));

    const imported = save.mock.calls[0][1];
    expect(imported.map(image => image.fileData.name)).toEqual(['coco_full_0_new.png', 'coco_full_1_new.png']);
    expect(imported.map(image => image.labelRects.length)).toEqual([1, 1]);
    expect(new Set(imported.map(image => image.id)).size).toBe(2);
    const labels = testStore.getState().labels.labels;
    expect(labels).toHaveLength(1);
    expect(imported.map(image => image.labelRects[0].labelId)).toEqual([labels[0].id, labels[0].id]);
});
