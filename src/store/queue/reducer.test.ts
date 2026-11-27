import {queueReducer} from './reducer';
import {addQueueItem, addQueueItems, setActiveQueueItem} from './actionCreators';
import {QueueItem, QueueItemStatus, QueueItemType} from './types';

const video = (id: string, name = 'cat_7429360'): QueueItem => ({
    id, name, type: QueueItemType.VIDEO, status: QueueItemStatus.COMPLETED, uploadedAt: 1,
});

it('replays restored queue items without duplicating the active video', () => {
    const items = [video('cat'), video('dog')];
    let state = queueReducer(undefined, addQueueItems(items));
    state = queueReducer(state, setActiveQueueItem('cat'));
    state = queueReducer(state, addQueueItems(items));
    expect(state.items.map(item => item.id)).toEqual(['cat', 'dog']);
    expect(state.activeQueueItemId).toBe('cat');
});

it('replaces an existing ID with its newest record and preserves distinct same-name videos', () => {
    const first = video('first');
    const second = video('second');
    let state = queueReducer(undefined, addQueueItems([first, second]));
    const updated = {...first, videoSessionId: 'fresh-session'};
    state = queueReducer(state, addQueueItem(updated));
    expect(state.items).toEqual([updated, second]);
});

it('repairs repeated IDs in both incoming and previously corrupted queues', () => {
    const first = video('first');
    const latest = {...first, videoSessionId: 'fresh-session'};
    const existing = video('existing');
    const state = queueReducer({items: [existing, existing], activeQueueItemId: 'existing'},
        addQueueItems([first, latest]));
    expect(state.items).toEqual([latest, existing]);
    expect(state.activeQueueItemId).toBe('existing');
});
