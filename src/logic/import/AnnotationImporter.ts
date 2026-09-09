import {ImageData, LabelName} from '../../store/labels/types';
import {LabelType} from '../../data/enums/LabelType';

export type ImportResult = {
    imagesData: ImageData[]
    labelNames: LabelName[]
}

export abstract class AnnotationImporter {
    public labelType: LabelType[]

    constructor(labelType: LabelType[]) {
        this.labelType = labelType;
    }

    public abstract import(
        filesData: File[],
        onSuccess: (imagesData: ImageData[], labelNames: LabelName[]) => void,
        onFailure: (error?:Error) => void,
        sourceImages?: ImageData[]
    ): void;
}