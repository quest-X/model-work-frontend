import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {Provider} from 'react-redux';
import configureStore from '../../../../configureStore';
import {store} from '../../../../index';
import {EditorActions} from '../../../../logic/actions/EditorActions';
import {SegmentationResult} from '../../../../store/ai/types';
import {updateSegmentationResults} from '../../../../store/ai/actionCreators';
import {updateActiveImageIndex, updateImageData, updateLabelNames} from '../../../../store/labels/actionCreators';
import {updateLanguage} from '../../../../store/general/actionCreators';
import {Language} from '../../../../data/LanguageConfig';
import {ImageDataUtil} from '../../../../utils/ImageDataUtil';
import {LabelUtil} from '../../../../utils/LabelUtil';
import {inferenceThumbnailCache} from '../../../../utils/InferenceThumbnailCache';
import InferenceResultsView from '../InferenceResultsView';

jest.mock('../../../../index', () => ({store: {dispatch: jest.fn(), getState: jest.fn()}}));

let testStore: ReturnType<typeof configureStore>;
const result = (name: string, x = 0): SegmentationResult => ({
    class_id: 1, class_name: name, confidence: 0.9,
    bbox: {x1: x, y1: 0, x2: x + 10, y2: 10, width: 10, height: 10},
    mask: {area: 100},
});
const polygon = (id: string, x = 0) => ({
    ...LabelUtil.createLabelPolygon('person', [
        {x, y: 0}, {x: x + 10, y: 0}, {x: x + 10, y: 10}, {x, y: 10},
    ]),
    id, isCreatedByAI: true,
});
const image = () => ({
    ...ImageDataUtil.createImageDataFromFileData(new File(['image'], 'image.jpg')),
    id: 'active-image',
});

beforeEach(() => {
    testStore = configureStore();
    jest.mocked(store.dispatch).mockImplementation(testStore.dispatch);
    jest.mocked(store.getState).mockImplementation(testStore.getState);
    jest.spyOn(EditorActions, 'fullRender').mockImplementation(() => undefined);
    jest.spyOn(inferenceThumbnailCache, 'get').mockReturnValue('blob:thumbnail');
    testStore.dispatch(updateLanguage(Language.ENGLISH));
    testStore.dispatch(updateLabelNames([{id: 'person', name: 'person'}]));
    testStore.dispatch(updateActiveImageIndex(0));
});

afterEach(() => jest.restoreAllMocks());

it('deletes the selected cached result after class filtering, preserving hidden results and other images', () => {
    const active = {...image(), labelPolygons: [polygon('selected'), polygon('neighbor', 20)]};
    const hidden = result('removed-class');
    const selected = result('person');
    const neighbor = result('person', 20);
    const otherImage = [result('person', 50)];
    testStore.dispatch(updateImageData([active]));
    testStore.dispatch(updateSegmentationResults(otherImage, 'other-image'));
    testStore.dispatch(updateSegmentationResults([hidden, selected, neighbor], active.id));
    render(<Provider store={testStore}><InferenceResultsView/></Provider>);

    fireEvent.click(screen.getAllByTitle('删除此推理结果')[0]);

    expect(testStore.getState().ai.imageSegmentationResults.get(active.id)).toEqual([hidden, neighbor]);
    expect(testStore.getState().ai.imageSegmentationResults.get('other-image')).toBe(otherImage);
    expect(testStore.getState().labels.imagesData[0].labelPolygons.map(p => p.id)).toEqual(['neighbor']);
    expect(screen.getAllByTitle('删除此推理结果')).toHaveLength(1);
});

it.each(['All', 'Detection'])('deletes a detection in the %s tab without removing an unrelated cache entry', tab => {
    const rect = {...LabelUtil.createLabelRect('person', {x: 30, y: 0, width: 10, height: 10}), id: 'rect', isCreatedByAI: true};
    const active = {...image(), labelRects: [rect], labelPolygons: [polygon('segment')]};
    const cached = [result('person'), result('removed-class')];
    testStore.dispatch(updateImageData([active]));
    testStore.dispatch(updateSegmentationResults(cached, active.id));
    render(<Provider store={testStore}><InferenceResultsView/></Provider>);

    fireEvent.click(screen.getByRole('button', {name: tab}));
    const deleteButtons = screen.getAllByTitle('删除此推理结果');
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    expect(testStore.getState().ai.imageSegmentationResults.get(active.id)).toBe(cached);
    expect(testStore.getState().labels.imagesData[0].labelRects).toEqual([]);
    expect(testStore.getState().labels.imagesData[0].labelPolygons.map(p => p.id)).toEqual(['segment']);
});

it('deletes the exact fallback polygon when two annotations have the same class and center', () => {
    const active = {...image(), labelPolygons: [polygon('first'), polygon('second')]};
    const cached = [result('removed-class')];
    testStore.dispatch(updateImageData([active]));
    testStore.dispatch(updateSegmentationResults(cached, active.id));
    render(<Provider store={testStore}><InferenceResultsView/></Provider>);

    fireEvent.click(screen.getAllByTitle('删除此推理结果')[1]);

    expect(testStore.getState().labels.imagesData[0].labelPolygons.map(p => p.id)).toEqual(['first']);
    expect(testStore.getState().ai.imageSegmentationResults.get(active.id)).toBe(cached);
});

it('selects and highlights the exact fallback polygon rather than a nearest-neighbor tie', () => {
    testStore.dispatch(updateImageData([{...image(), labelPolygons: [polygon('first'), polygon('second')]}]));
    const {container} = render(<Provider store={testStore}><InferenceResultsView/></Provider>);
    const second = container.querySelectorAll('.SegmentationResultItem')[1];

    fireEvent.mouseEnter(second);
    expect(testStore.getState().labels.activeLabelId).toBe('second');
    fireEvent.mouseLeave(second);
    expect(testStore.getState().labels.activeLabelId).toBeNull();
    fireEvent.click(second);
    expect(testStore.getState().labels.activeLabelId).toBe('second');
});
