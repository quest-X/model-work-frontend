import {Direction} from "../data/enums/Direction";
import {IPoint} from "../interfaces/IPoint";

export class DirectionUtil {
    // NOTE: returns math-space vectors (y-up), NOT screen-space (y-down).
    // Direction.TOP → {y: 1}, Direction.BOTTOM → {y: -1}.
    // Callers that want screen-space behavior must pass the opposite Direction
    // (see EditorContext ArrowUp/ArrowDown bindings).
    public static convertDirectionToVector(direction: Direction): IPoint {
        switch (direction) {
            case Direction.RIGHT:
                return {x: 1, y: 0};
            case Direction.LEFT:
                return {x: -1, y: 0};
            case Direction.TOP:
                return {x: 0, y: 1};
            case Direction.BOTTOM:
                return {x: 0, y: -1};
            case Direction.TOP_RIGHT:
                return {x: 1, y: 1};
            case Direction.TOP_LEFT:
                return {x: -1, y: 1};
            case Direction.BOTTOM_RIGHT:
                return {x: 1, y: -1};
            case Direction.BOTTOM_LEFT:
                return {x: -1, y: -1};
            case Direction.CENTER:
                return {x: 0, y: 0};
            default:
                return null;
        }
    }
}