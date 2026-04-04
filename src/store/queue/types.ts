import { Action } from '../Actions';

export enum QueueItemType {
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
    FOLDER = 'FOLDER'
}

export enum QueueItemStatus {
    PENDING = 'PENDING',
    PROCESSING = 'PROCESSING',
    COMPLETED = 'COMPLETED',
    ERROR = 'ERROR'
}

export type QueueItem = {
    id: string;
    name: string;
    type: QueueItemType;
    file?: File;
    files?: File[]; // For folders
    extractedFrames?: File[];          // FFmpeg 拆出的 JPEG 帧（VIDEO 模式专用）
    extractionMetadata?: {             // 拆帧时的视频元信息
        fps: number;
        duration: number;
        totalFrames: number;
        width: number;
        height: number;
    };
    status: QueueItemStatus;
    uploadedAt: number; // timestamp
    thumbnail?: string; // Base64 thumbnail for images/videos
    error?: string;
}

export type QueueState = {
    items: QueueItem[];
    activeQueueItemId: string | null;
}

interface AddQueueItem {
    type: typeof Action.ADD_QUEUE_ITEM;
    payload: {
        item: QueueItem;
    }
}

interface AddQueueItems {
    type: typeof Action.ADD_QUEUE_ITEMS;
    payload: {
        items: QueueItem[];
    }
}

interface RemoveQueueItem {
    type: typeof Action.REMOVE_QUEUE_ITEM;
    payload: {
        itemId: string;
    }
}

interface UpdateQueueItem {
    type: typeof Action.UPDATE_QUEUE_ITEM;
    payload: {
        itemId: string;
        updates: Partial<QueueItem>;
    }
}

interface SetActiveQueueItem {
    type: typeof Action.SET_ACTIVE_QUEUE_ITEM;
    payload: {
        itemId: string | null;
    }
}

interface ClearQueue {
    type: typeof Action.CLEAR_QUEUE;
}

export type QueueActionTypes = 
    | AddQueueItem
    | AddQueueItems
    | RemoveQueueItem
    | UpdateQueueItem
    | SetActiveQueueItem
    | ClearQueue;

