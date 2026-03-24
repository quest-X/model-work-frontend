import {EditorData} from '../data/EditorData';
import {RectUtil} from './RectUtil';
import {store} from '../index';
import {CustomCursorStyle} from '../data/enums/CustomCursorStyle';
import {updateCustomCursorStyle} from '../store/general/actionCreators';
import {IPoint} from '../interfaces/IPoint';
import {PointUtil} from './PointUtil';
import {IRect} from '../interfaces/IRect';
import {ILine} from '../interfaces/ILine';
import {LineUtil} from './LineUtil';

export class RenderEngineUtil {
    public static calculateImageScale(data: EditorData): number {
        if (!data.realImageSize || !data.viewPortContentImageRect) {
            return 1; // 默认缩放比例
        }
        return data.realImageSize.width / data.viewPortContentImageRect.width;
    }

    public static isMouseOverImage(data: EditorData): boolean {
        if (!data.viewPortContentImageRect || !data.mousePositionOnViewPortContent) {
            return false;
        }
        return RectUtil.isPointInside(data.viewPortContentImageRect, data.mousePositionOnViewPortContent);
    }

    public static isMouseOverCanvas(data: EditorData): boolean {
        if (!data.viewPortContentSize || !data.mousePositionOnViewPortContent) {
            return false;
        }
        return RectUtil.isPointInside({x: 0, y: 0, ...data.viewPortContentSize}, data.mousePositionOnViewPortContent);
    }

    public static transferPointFromImageToViewPortContent(point: IPoint, data: EditorData): IPoint {
        if (!data.viewPortContentImageRect || !data.realImageSize) {
            return point; // 如果没有图像数据，返回原始point
        }
        const scale = RenderEngineUtil.calculateImageScale(data);
        return PointUtil.add(PointUtil.multiply(point, 1/scale), data.viewPortContentImageRect);
    }

    public static transferPolygonFromImageToViewPortContent(polygon: IPoint[], data: EditorData): IPoint[] {
        return polygon.map((point: IPoint) => RenderEngineUtil.transferPointFromImageToViewPortContent(point, data));
    }

    public static transferLineFromImageToViewPortContent(line: ILine, data: EditorData): ILine {
        return {
            start: RenderEngineUtil.transferPointFromImageToViewPortContent(line.start, data),
            end: RenderEngineUtil.transferPointFromImageToViewPortContent(line.end, data)
        }
    }

    public static transferPointFromViewPortContentToImage(point: IPoint, data: EditorData): IPoint {
        if (!data.viewPortContentImageRect || !data.realImageSize) {
            return point; // 如果没有图像数据，返回原始point
        }
        const scale = RenderEngineUtil.calculateImageScale(data);
        return PointUtil.multiply(PointUtil.subtract(point, data.viewPortContentImageRect), scale);
    }

    public static transferPolygonFromViewPortContentToImage(polygon: IPoint[], data: EditorData): IPoint[] {
        return polygon.map((point: IPoint) => RenderEngineUtil.transferPointFromViewPortContentToImage(point, data));
    }

    public static transferLineFromViewPortContentToImage(line: ILine, data: EditorData): ILine {
        return {
            start: RenderEngineUtil.transferPointFromViewPortContentToImage(line.start, data),
            end: RenderEngineUtil.transferPointFromViewPortContentToImage(line.end, data)
        }
    }

    public static transferRectFromViewPortContentToImage(rect: IRect, data: EditorData): IRect {
        if (!data.viewPortContentImageRect || !data.realImageSize) {
            return rect; // 如果没有图像数据，返回原始rect
        }
        const scale = RenderEngineUtil.calculateImageScale(data);
        return RectUtil.translate(RectUtil.scaleRect(rect, 1/scale), data.viewPortContentImageRect);
    }

    public static transferRectFromImageToViewPortContent(rect: IRect, data: EditorData): IRect {
        if (!data.viewPortContentImageRect || !data.realImageSize) {
            return rect; // 如果没有图像数据，返回原始rect
        }
        const scale = RenderEngineUtil.calculateImageScale(data);
        const translation: IPoint = {
            x: - data.viewPortContentImageRect.x,
            y: - data.viewPortContentImageRect.y
        };

        return RectUtil.scaleRect(RectUtil.translate(rect, translation), scale);
    }

    public static wrapDefaultCursorStyleInCancel(data: EditorData) {
        if (RectUtil.isPointInside(data.viewPortContentImageRect, data.mousePositionOnViewPortContent)) {
            store.dispatch(updateCustomCursorStyle(CustomCursorStyle.DEFAULT));
        } else {
            store.dispatch(updateCustomCursorStyle(CustomCursorStyle.CANCEL));
        }
    }

    public static setValueBetweenPixels(value: number): number {
        return Math.floor(value) + 0.5;
    }

    public static setPointBetweenPixels(point: IPoint): IPoint {
        return {
            x: RenderEngineUtil.setValueBetweenPixels(point.x),
            y: RenderEngineUtil.setValueBetweenPixels(point.y)
        }
    }

    public static setRectBetweenPixels(rect: IRect): IRect {
        const topLeft: IPoint = {
            x: rect.x,
            y: rect.y
        };
        const bottomRight: IPoint = {
            x: rect.x + rect.width,
            y: rect.y + rect.height
        };
        const topLeftBetweenPixels = RenderEngineUtil.setPointBetweenPixels(topLeft);
        const bottomRightBetweenPixels = RenderEngineUtil.setPointBetweenPixels(bottomRight);
        return {
            x: topLeftBetweenPixels.x,
            y: topLeftBetweenPixels.y,
            width: bottomRightBetweenPixels.x - topLeftBetweenPixels.x,
            height: bottomRightBetweenPixels.y - topLeftBetweenPixels.y
        }
    }

    public static isMouseOverLine(mouse: IPoint, line: ILine, radius: number): boolean {
        const minX: number = Math.min(line.start.x, line.end.x);
        const maxX: number = Math.max(line.start.x, line.end.x);
        const minY: number = Math.min(line.start.y, line.end.y);
        const maxY: number = Math.max(line.start.y, line.end.y);

        return (minX - radius <= mouse.x && maxX + radius >= mouse.x) &&
            (minY - radius <= mouse.y && maxY + radius >= mouse.y) &&
            LineUtil.getDistanceFromLine(line, mouse) < radius;
    }

    public static isMouseOverAnchor(mouse: IPoint, anchor: IPoint, radius: number): boolean {
        const anchorSize = { width: 2 * radius, height: 2 * radius}
        return RectUtil.isPointInside(RectUtil.getRectWithCenterAndSize(anchor, anchorSize), mouse);
    }

    public static isMouseOverPolygon(mouse: IPoint, vertices: IPoint[], radius: number): boolean {
        for (const vertex of vertices) {
            if (RenderEngineUtil.isMouseOverAnchor(mouse, vertex, radius)) return true;
        }
        for (let i = 0; i < vertices.length; i++) {
            const edge: ILine = { start: vertices[i], end: vertices[(i + 1) % vertices.length] };
            if (RenderEngineUtil.isMouseOverLine(mouse, edge, radius)) return true;
        }
        return false;
    }
}
