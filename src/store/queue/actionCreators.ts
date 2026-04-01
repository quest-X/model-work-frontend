import { Action } from '../Actions';
import { QueueActionTypes, QueueItem } from './types';

export const addQueueItem = (item: QueueItem): QueueActionTypes => ({
    type: Action.ADD_QUEUE_ITEM,
    payload: {
        item
    }
});

export const addQueueItems = (items: QueueItem[]): QueueActionTypes => ({
    type: Action.ADD_QUEUE_ITEMS,
    payload: {
        items
    }
});

export const removeQueueItem = (itemId: string): QueueActionTypes => ({
    type: Action.REMOVE_QUEUE_ITEM,
    payload: {
        itemId
    }
});

export const updateQueueItem = (itemId: string, updates: Partial<QueueItem>): QueueActionTypes => ({
    type: Action.UPDATE_QUEUE_ITEM,
    payload: {
        itemId,
        updates
    }
});

export const setActiveQueueItem = (itemId: string | null): QueueActionTypes => ({
    type: Action.SET_ACTIVE_QUEUE_ITEM,
    payload: {
        itemId
    }
});

export const clearQueue = (): QueueActionTypes => ({
    type: Action.CLEAR_QUEUE
});

