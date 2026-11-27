import {applyMiddleware, createStore, Store} from 'redux';
import {rootReducer, AppState} from '../../../store';
import {addImageData, updateImageData, updateImageDataById, updateLabelNames} from '../../../store/labels/actionCreators';
import {updateVideoMode} from '../../../store/video/actionCreators';
import {ImageData, LabelRect} from '../../../store/labels/types';
import {LabelStatus} from '../../../data/enums/LabelStatus';
import {UndoActions} from '../../actions/UndoActions';
import {RestoreFlag, UndoStack} from '../UndoStack';
import {undoMiddleware} from '../undoMiddleware';

let mockReduxStore: Store<AppState>;
jest.mock('../../../index', () => ({get store() { return mockReduxStore; }}));
jest.mock('../../actions/EditorActions', () => ({EditorActions: {fullRender: jest.fn()}}));

const rect = (id: string): LabelRect => ({
    id, labelId: 'cat', rect: {x: 1, y: 2, width: 10, height: 20},
    isVisible: true, isCreatedByAI: false, status: LabelStatus.ACCEPTED, suggestedLabel: '',
});
const image = (id: string): ImageData => ({
    id, fileData: new File(['pixels'], `${id}.jpg`), loadStatus: false,
    labelRects: [rect(`${id}-existing`)], labelPoints: [], labelLines: [], labelPolygons: [],
    labelNameIds: ['cat'], isVisitedByRoboflowAPI: false,
});
const editingStore = () => {
    const initial = createStore(rootReducer).getState();
    const reduxStore = createStore(rootReducer, {
        ...initial,
        labels: {...initial.labels, imagesData: [image('frame-1'), image('frame-2')],
            labels: [{id: 'cat', name: 'cat'}], activeImageIndex: 0},
    }, applyMiddleware(undoMiddleware));
    return reduxStore;
};
const draw = (id: string) => {
    const frame = mockReduxStore.getState().labels.imagesData[0];
    frame.labelRects.push(rect(id));
    mockReduxStore.dispatch(updateImageDataById(frame.id, frame));
};

beforeEach(() => {
    UndoStack.clear();
    RestoreFlag.set(false);
    jest.spyOn(performance, 'now').mockReturnValue(100);
    mockReduxStore = editingStore();
    mockReduxStore.dispatch(updateVideoMode(true));
});
afterEach(() => {
    UndoStack.clear();
    RestoreFlag.set(false);
    jest.restoreAllMocks();
});

it('does not add undo steps for single-frame or bulk pixel cache refreshes', () => {
    for (let i = 0; i < 110; i++) {
        const frame = mockReduxStore.getState().labels.imagesData[0];
        mockReduxStore.dispatch(updateImageDataById(frame.id, {...frame,
            fileData: new File([String(i)], 'decoded.jpg'), loadStatus: true}));
    }
    mockReduxStore.dispatch(updateImageData(mockReduxStore.getState().labels.imagesData.map(frame => (
        {...frame, fileData: new File(['decoded'], 'decoded.jpg'), loadStatus: true}
    ))));
    expect(UndoStack.size()).toBe(0);
    expect(mockReduxStore.getState().labels.imagesData[0].loadStatus).toBe(true);
});

it('undoes a drawn rectangle once after more cache refreshes than the stack limit', () => {
    draw('temporary');
    for (let i = 0; i < 110; i++) {
        const frames = mockReduxStore.getState().labels.imagesData;
        mockReduxStore.dispatch(updateImageDataById(frames[0].id, {...frames[0], loadStatus: true}));
    }
    expect(UndoStack.size()).toBe(1);
    UndoActions.undo();
    expect(mockReduxStore.getState().labels.imagesData.map(frame => frame.labelRects.map(r => r.id)))
        .toEqual([['frame-1-existing'], ['frame-2-existing']]);
    expect(UndoStack.size()).toBe(0);
});

it('keeps each rapid edit separate instead of undoing an earlier annotation too', () => {
    draw('first-edit');
    draw('second-edit');
    UndoActions.undo();
    expect(mockReduxStore.getState().labels.imagesData[0].labelRects.map(r => r.id))
        .toEqual(['frame-1-existing', 'first-edit']);
    UndoActions.undo();
    expect(mockReduxStore.getState().labels.imagesData[0].labelRects.map(r => r.id))
        .toEqual(['frame-1-existing']);
});

it('seeds the pre-edit snapshot before an in-place first edit', () => {
    mockReduxStore = editingStore();
    draw('first-edit');
    UndoActions.undo();
    expect(mockReduxStore.getState().labels.imagesData[0].labelRects.map(r => r.id))
        .toEqual(['frame-1-existing']);
});

it('keeps newly imported frames and label names when the first edit is undone immediately', () => {
    mockReduxStore.dispatch(addImageData([image('frame-3')]));
    mockReduxStore.dispatch(updateLabelNames([{id: 'cat', name: 'cat'}, {id: 'dog', name: 'dog'}]));
    draw('first-edit');
    UndoActions.undo();
    expect(mockReduxStore.getState().labels.imagesData.map(frame => frame.id))
        .toEqual(['frame-1', 'frame-2', 'frame-3']);
    expect(mockReduxStore.getState().labels.labels.map(label => label.id)).toEqual(['cat', 'dog']);
});
