import React from 'react';
import {act, fireEvent, render} from '@testing-library/react';
import {Provider} from 'react-redux';
import {createStore} from 'redux';
import {rootReducer} from '../../../../../store';
import {store} from '../../../../../index';
import {addQueueItem, addQueueItems, clearQueue, setActiveQueueItem} from '../../../../../store/queue/actionCreators';
import {updateImageData} from '../../../../../store/labels/actionCreators';
import {QueueItemStatus, QueueItemType} from '../../../../../store/queue/types';
import {QueueActions} from '../../../../../logic/actions/QueueActions';
import {DataBatchSyncService} from '../../../../../services/DataBatchSyncService';
import {getQueueItemDisplayName} from '../../../../../utils/QueueDisplayNameUtil';
import {createVideoFramePlaceholders} from '../../../VideoEditor/VideoFrameState';
import QueueList from '../QueueList';

jest.mock('../../../../../index', () => ({store: {getState: jest.fn()}}));
jest.mock('../../../../../logic/actions/QueueActions', () => ({QueueActions: {switchToQueueItem: jest.fn()}}));
jest.mock('../../../../../services/DataBatchSyncService', () => ({
    DataBatchSyncService: {syncQueueItem: jest.fn().mockResolvedValue(undefined)},
}));
jest.mock('../../../../../utils/QueueDisplayNameUtil', () => ({
    ...jest.requireActual('../../../../../utils/QueueDisplayNameUtil'),
    getQueueItemDisplayName: jest.fn(jest.requireActual('../../../../../utils/QueueDisplayNameUtil').getQueueItemDisplayName),
}));

const fixture = () => {
    const testStore = createStore(rootReducer);
    jest.mocked(store.getState).mockImplementation(() => testStore.getState());
    for (let index = 0; index < 9; index++) {
        testStore.dispatch(addQueueItem({id: `item-${index}`, name: `video-${index}.mp4`,
            type: QueueItemType.VIDEO, status: QueueItemStatus.COMPLETED, uploadedAt: index}));
    }
    testStore.dispatch(setActiveQueueItem('item-0'));
    testStore.dispatch(updateImageData(createVideoFramePlaceholders(900)));
    const view = render(<Provider store={testStore}><QueueList/></Provider>);
    jest.mocked(getQueueItemDisplayName).mockClear();
    return {testStore, view};
};

beforeEach(() => { jest.clearAllMocks(); });

it('does not redraw queue cards on frame updates and reads the newest annotations at click time', () => {
    const {testStore, view} = fixture();
    for (let frame = 0; frame < 30; frame++) {
        act(() => { testStore.dispatch(updateImageData([...testStore.getState().labels.imagesData])); });
    }
    expect(getQueueItemDisplayName).not.toHaveBeenCalled();

    fireEvent.click(view.container.querySelector('[data-queue-item-id="item-1"]'));
    expect(QueueActions.switchToQueueItem).toHaveBeenCalledWith(
        testStore.getState().queue.items.find(item => item.id === 'item-1'), testStore.getState().labels.imagesData,
    );
});

it('only redraws the previous and next selected cards when switching', () => {
    const {testStore} = fixture();
    act(() => { testStore.dispatch(setActiveQueueItem('item-1')); });
    expect(getQueueItemDisplayName).toHaveBeenCalledTimes(2);
    expect(jest.mocked(getQueueItemDisplayName).mock.calls.map(([item]) => item.id).sort()).toEqual(['item-0', 'item-1']);
});

it('syncs the newest active annotations without subscribing the list to frame changes', () => {
    const {testStore, view} = fixture();
    act(() => {
        testStore.dispatch(addQueueItem({id: 'image', name: 'image.jpg', type: QueueItemType.IMAGE,
            status: QueueItemStatus.COMPLETED, uploadedAt: 10}));
        testStore.dispatch(setActiveQueueItem('image'));
        testStore.dispatch(updateImageData(createVideoFramePlaceholders(1)));
    });
    act(() => { testStore.dispatch(updateImageData([...testStore.getState().labels.imagesData])); });
    fireEvent.click(view.container.querySelector('[data-queue-item-id="image"] .card-sync-btn'));
    expect(DataBatchSyncService.syncQueueItem).toHaveBeenCalledWith(
        testStore.getState().queue.items.find(item => item.id === 'image'),
        testStore.getState().labels.imagesData, testStore.getState().labels.labels,
    );
});

it('shows one active card when the same video is restored repeatedly', () => {
    const {testStore, view} = fixture();
    const item = testStore.getState().queue.items.find(entry => entry.id === 'item-0');
    act(() => {
        testStore.dispatch(addQueueItems([item]));
        testStore.dispatch(addQueueItems([item]));
    });
    expect(view.container.querySelectorAll('[data-queue-item-id="item-0"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('.queue-item-card.active')).toHaveLength(1);
});

it('removes all legacy duplicate cards before showing the empty queue', () => {
    const testStore = createStore(rootReducer);
    jest.mocked(store.getState).mockImplementation(() => testStore.getState());
    const item = {id: 'legacy', name: 'cat_7429360', type: QueueItemType.VIDEO,
        status: QueueItemStatus.COMPLETED, uploadedAt: 1};
    const state = testStore.getState();
    const legacyStore = createStore(rootReducer, {...state,
        queue: {items: [item, item, item], activeQueueItemId: item.id}});
    jest.mocked(store.getState).mockImplementation(() => legacyStore.getState());
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = render(<Provider store={legacyStore}><QueueList/></Provider>);
    expect(view.container.querySelectorAll('.queue-item-card')).toHaveLength(1);
    expect(view.container.querySelectorAll('.queue-item-card.active')).toHaveLength(1);
    // Duplicate React keys in an older render can leave unmanaged card nodes behind.
    const ghost = document.createElement('div');
    ghost.className = 'queue-item-card';
    view.container.querySelector('.queue-list-scroll').appendChild(ghost);
    act(() => { legacyStore.dispatch(clearQueue()); });
    expect(view.container.querySelectorAll('.queue-item-card')).toHaveLength(0);
    expect(view.container.querySelector('.queue-list-empty')).not.toBeNull();
    errors.mockRestore();
});
