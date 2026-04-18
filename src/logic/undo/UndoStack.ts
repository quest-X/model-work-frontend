import {ImageData, LabelName} from '../../store/labels/types';

export interface UndoSnapshot {
    imagesData: ImageData[];
    labels: LabelName[];
}

const MAX_STACK_SIZE = 100;
const stack: UndoSnapshot[] = [];

export const UndoStack = {
    push(snapshot: UndoSnapshot): void {
        stack.push(snapshot);
        if (stack.length > MAX_STACK_SIZE) stack.shift();
    },
    pop(): UndoSnapshot | null {
        return stack.pop() ?? null;
    },
    canUndo(): boolean {
        return stack.length > 0;
    },
    clear(): void {
        stack.length = 0;
    },
    size(): number {
        return stack.length;
    }
};

let restoring = false;
export const RestoreFlag = {
    get(): boolean { return restoring; },
    set(value: boolean): void { restoring = value; }
};
