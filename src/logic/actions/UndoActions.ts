import {store} from '../../index';
import {updateImageData, updateLabelNames, updateActiveLabelId} from '../../store/labels/actionCreators';
import {UndoStack, RestoreFlag} from '../undo/UndoStack';
import {EditorActions} from './EditorActions';

export class UndoActions {
    public static canUndo(): boolean {
        return UndoStack.canUndo();
    }

    public static undo(): void {
        const snapshot = UndoStack.pop();
        if (!snapshot) return;
        RestoreFlag.set(true);
        try {
            store.dispatch(updateImageData(snapshot.imagesData));
            store.dispatch(updateLabelNames(snapshot.labels));
            store.dispatch(updateActiveLabelId(null));
        } finally {
            RestoreFlag.set(false);
        }
        EditorActions.fullRender();
    }

    public static clear(): void {
        UndoStack.clear();
    }
}
