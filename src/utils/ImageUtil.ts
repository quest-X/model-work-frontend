import {ISize} from "../interfaces/ISize";
import {FrameSource, getFrameWidth, getFrameHeight} from "./FrameSourceUtil";

export class ImageUtil {
    // v2.6.0: 接受 HTMLImageElement | VideoFrame, 用 FrameSourceUtil 抽象 width/height 访问
    public static getSize(image: FrameSource | null): ISize {
        if (!image) return null;
        return {
            width: getFrameWidth(image),
            height: getFrameHeight(image)
        }
    }
}