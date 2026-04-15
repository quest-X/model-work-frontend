import {ImageData} from '../store/labels/types';

export type DatasetSplit = {
    train: ImageData[];
    val: ImageData[];
    test: ImageData[];
};

export class DatasetSplitUtil {
    public static split(
        images: ImageData[],
        ratio: [number, number, number] = [0.8, 0.1, 0.1]
    ): DatasetSplit {
        const shuffled = [...images];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const total = shuffled.length;
        const trainEnd = Math.round(total * ratio[0]);
        const valEnd = trainEnd + Math.round(total * ratio[1]);

        return {
            train: shuffled.slice(0, trainEnd),
            val: shuffled.slice(trainEnd, valEnd),
            test: shuffled.slice(valEnd),
        };
    }

    public static async addImagesToZip(
        zip: any,
        images: ImageData[],
        basePath: string
    ): Promise<void> {
        for (const imageData of images) {
            if (imageData.fileData) {
                zip.file(`${basePath}/${imageData.fileData.name}`, imageData.fileData);
            }
        }
    }
}
