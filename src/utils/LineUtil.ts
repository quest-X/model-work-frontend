import {ILine} from "../interfaces/ILine";
import {IPoint} from "../interfaces/IPoint";

export class LineUtil {
    public static getDistanceFromLine(l: ILine, p: IPoint): number {
        if (l.start.x !== l.end.x || l.start.y !== l.end.y) {
            const nom: number = Math.abs((l.end.y - l.start.y) * p.x - (l.end.x - l.start.x) * p.y + l.end.x * l.start.y - l.end.y * l.start.x);
            const denom: number = Math.sqrt(Math.pow(l.end.y - l.start.y, 2) + Math.pow(l.end.x - l.start.x, 2));
            return nom / denom;
        }
        return null;
    }

    public static getCenter(l: ILine): IPoint {
        return {
            x: (l.start.x + l.end.x) / 2,
            y: (l.start.y + l.end.y) / 2
        }
    }

    public static getPoints(l: ILine): IPoint[] {
        return [l.start, l.end]
    }

    /**
     * 计算线条的像素长度
     * @param line 线条对象
     * @returns 线条的像素长度（保留2位小数）
     */
    public static getPixelLength(line: ILine): number {
        const deltaX = line.end.x - line.start.x;
        const deltaY = line.end.y - line.start.y;
        return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    }

    /**
     * 格式化长度显示文本
     * @param length 像素长度
     * @returns 格式化的长度字符串
     */
    public static formatLengthText(length: number): string {
        return `${length.toFixed(1)}px`;
    }

    /**
     * 计算长度标签的显示位置（线条中点偏上方）
     * @param line 线条对象
     * @param offset 偏移距离（像素）
     * @returns 标签显示位置
     */
    public static getLengthLabelPosition(line: ILine, offset: number = 15): IPoint {
        const center = this.getCenter(line);
        
        // 计算线条的法向量（垂直方向）
        const deltaX = line.end.x - line.start.x;
        const deltaY = line.end.y - line.start.y;
        const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        if (length === 0) {
            return center;
        }
        
        // 归一化法向量（向上偏移）
        const normalX = -deltaY / length;
        const normalY = deltaX / length;
        
        return {
            x: center.x + normalX * offset,
            y: center.y + normalY * offset
        };
    }

    // =================================================================================================================
    // 磁性吸附功能
    // =================================================================================================================

    /**
     * 吸附角度阈值（度）
     */
    private static readonly SNAP_ANGLE_THRESHOLD = 1;

    /**
     * 计算线条的角度（以度为单位）
     * @param line 线条对象
     * @returns 角度值（-180到180度）
     */
    public static calculateLineAngle(line: ILine): number {
        const deltaX = line.end.x - line.start.x;
        const deltaY = line.end.y - line.start.y;
        return Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    }

    /**
     * 检查是否应该吸附到水平方向
     * @param angle 线条角度
     * @returns 是否应该吸附到水平
     */
    public static shouldSnapToHorizontal(angle: number): boolean {
        return Math.abs(angle) <= this.SNAP_ANGLE_THRESHOLD || 
               Math.abs(Math.abs(angle) - 180) <= this.SNAP_ANGLE_THRESHOLD;
    }

    /**
     * 检查是否应该吸附到垂直方向
     * @param angle 线条角度
     * @returns 是否应该吸附到垂直
     */
    public static shouldSnapToVertical(angle: number): boolean {
        return Math.abs(Math.abs(angle) - 90) <= this.SNAP_ANGLE_THRESHOLD;
    }

    /**
     * 将线条吸附到最近的轴（水平或垂直）
     * @param line 原始线条
     * @returns 吸附后的线条和吸附状态
     */
    public static snapLineToAxis(line: ILine): { snappedLine: ILine; isSnapped: boolean; snapType: 'horizontal' | 'vertical' | 'none' } {
        const angle = this.calculateLineAngle(line);
        
        if (this.shouldSnapToHorizontal(angle)) {
            // 水平吸附：终点Y坐标与起点相同
            return {
                snappedLine: {
                    start: line.start,
                    end: { x: line.end.x, y: line.start.y }
                },
                isSnapped: true,
                snapType: 'horizontal'
            };
        }
        
        if (this.shouldSnapToVertical(angle)) {
            // 垂直吸附：终点X坐标与起点相同
            return {
                snappedLine: {
                    start: line.start,
                    end: { x: line.start.x, y: line.end.y }
                },
                isSnapped: true,
                snapType: 'vertical'
            };
        }
        
        // 不需要吸附
        return {
            snappedLine: line,
            isSnapped: false,
            snapType: 'none'
        };
    }

    /**
     * 检查线条是否已经完全水平
     * @param line 线条对象
     * @returns 是否水平
     */
    public static isHorizontal(line: ILine): boolean {
        return Math.abs(line.end.y - line.start.y) < 1;
    }

    /**
     * 检查线条是否已经完全垂直
     * @param line 线条对象
     * @returns 是否垂直
     */
    public static isVertical(line: ILine): boolean {
        return Math.abs(line.end.x - line.start.x) < 1;
    }
}