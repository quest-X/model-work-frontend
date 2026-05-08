import {Middleware} from 'redux';
import {Action} from '../../store/Actions';
import {UndoStack, RestoreFlag, UndoSnapshot} from './UndoStack';
import {AppState} from '../../store';
import {ImageData} from '../../store/labels/types';

// Actions whose "before" state we want on the undo stack
const SNAPSHOT_ACTIONS = new Set<string>([
    Action.UPDATE_IMAGE_DATA_BY_ID,
    Action.UPDATE_IMAGES_DATA,
    Action.DELETE_IMAGE_BY_ID,
    Action.DELETE_SELECTED_IMAGES
]);

// Actions that change labels state and should refresh the cached clean snapshot
const LABEL_STATE_ACTIONS = new Set<string>([
    Action.UPDATE_IMAGE_DATA_BY_ID,
    Action.UPDATE_IMAGES_DATA,
    Action.ADD_IMAGES_DATA,
    Action.DELETE_IMAGE_BY_ID,
    Action.DELETE_SELECTED_IMAGES,
    Action.UPDATE_LABEL_NAMES
]);

const clone: <T>(value: T) => T = typeof (globalThis as any).structuredClone === 'function'
    ? (v) => (globalThis as any).structuredClone(v)
    : (v) => JSON.parse(JSON.stringify(v));

function cloneImageData(list: ImageData[]): ImageData[] {
    // File objects in fileData can't be structured-cloned reliably in all envs; preserve reference.
    return list.map(d => ({
        ...d,
        labelRects: clone(d.labelRects),
        labelPoints: clone(d.labelPoints),
        labelLines: clone(d.labelLines),
        labelPolygons: clone(d.labelPolygons),
        labelNameIds: [...d.labelNameIds]
    }));
}

// Cached deep-clone of the most recent clean state. Because render engines mutate
// ImageData in place before dispatching, we cannot snapshot inside the middleware
// at dispatch time — state is already dirty. Instead, after every label-state
// change we cache a deep clone; on the next mutation we push that clean cache.
let lastSnapshot: UndoSnapshot | null = null;

// Throttle snapshots: structuredClone of 15k+ ImageData entries costs ~50-100ms.
// During playback, UPDATE_IMAGE_DATA_BY_ID fires on every frame (25+ times/sec),
// causing >2.5s of cloning overhead per 16s of playback. Throttle to at most
// one snapshot every 300ms — still captures undo points for interactive edits,
// while eliminating 90%+ of cloning during rapid-fire dispatches.
let lastSnapshotTime = 0;
const SNAPSHOT_MIN_INTERVAL_MS = 300;

function takeSnapshot(state: AppState): UndoSnapshot {
    return {
        imagesData: cloneImageData(state.labels.imagesData),
        labels: [...state.labels.labels]
    };
}

export const undoMiddleware: Middleware<{}, AppState> = store => next => (action: any) => {
    if (!RestoreFlag.get() && action && SNAPSHOT_ACTIONS.has(action.type) && lastSnapshot) {
        UndoStack.push(lastSnapshot);
    }
    const result = next(action);
    if (action && LABEL_STATE_ACTIONS.has(action.type)) {
        const now = performance.now();
        if (now - lastSnapshotTime >= SNAPSHOT_MIN_INTERVAL_MS) {
            lastSnapshot = takeSnapshot(store.getState());
            lastSnapshotTime = now;
        }
    } else if (lastSnapshot === null && action) {
        // First dispatch after boot — seed the snapshot so the first mutation is undoable
        lastSnapshot = takeSnapshot(store.getState());
    }
    return result;
};
