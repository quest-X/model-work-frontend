import {LabelName, LabelRect} from '../../../store/labels/types';
import {LabelUtil} from '../../../utils/LabelUtil';
import {AnnotationsParsingError, LabelNamesNotUniqueError} from './YOLOErrors';
import {ISize} from '../../../interfaces/ISize';
import {uniq} from 'lodash';

export class YOLOUtils {
    public static parseLabelsNamesFromString(content: string): LabelName[] {
        const labelNames: string[] = content
            .split(/[\r\n]/)
            .filter(Boolean)
            .map((name: string) => name.trim())

        if (uniq(labelNames).length !== labelNames.length) {
            throw new LabelNamesNotUniqueError()
        }

        return labelNames
            .map((name: string) => LabelUtil.createLabelName(name))
    }

    /**
     * Ultralytics 导出的 data.yaml/dataset.yaml 里 names 字段有两种写法：
     *   names: [person, car]          — 内联数组
     *   names:                        — 逐行，key 可选（"0: person" 或纯 "- person"）
     *     0: person
     *     1: car
     * 不引入 yaml 依赖，只解析这两种常见写法。
     */
    public static parseLabelsNamesFromYamlString(content: string): LabelName[] {
        const namesLineMatch = content.match(/^\s*names\s*:\s*(.*)$/m);
        if (!namesLineMatch) throw new LabelNamesNotUniqueError();

        const inline = namesLineMatch[1].trim();
        let labelNames: string[];
        if (inline.startsWith('[')) {
            labelNames = inline.replace(/^\[|\]$/g, '').split(',')
                .map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
        } else {
            const startIdx = content.indexOf(namesLineMatch[0]) + namesLineMatch[0].length;
            const rest = content.slice(startIdx).split(/\r?\n/);
            labelNames = [];
            for (const rawLine of rest) {
                if (!rawLine.trim()) continue;
                const indented = /^\s+/.test(rawLine) || /^\s*-/.test(rawLine);
                if (!indented) break;
                const entry = rawLine.replace(/^\s*-\s*/, '').trim();
                const kvMatch = entry.match(/^\d+\s*:\s*(.*)$/);
                const name = (kvMatch ? kvMatch[1] : entry).trim().replace(/^['"]|['"]$/g, '');
                if (name) labelNames.push(name);
            }
        }

        if (uniq(labelNames).length !== labelNames.length) {
            throw new LabelNamesNotUniqueError();
        }
        return labelNames.map((name: string) => LabelUtil.createLabelName(name));
    }

    public static loadLabelsList(
        fileData: File,
        onSuccess: (labels: LabelName[]) => void,
        onFailure: (error: Error) => void
    ) {
        const reader = new FileReader();
        reader.onloadend = (evt: ProgressEvent<FileReader>) => {
            try {
                const content: string = evt.target.result as string;
                const labelNames = YOLOUtils.parseLabelsNamesFromString(content);
                onSuccess(labelNames);
            } catch (error) {
                onFailure(error as Error)
            }
        };
        reader.readAsText(fileData);
    }

    public static parseYOLOAnnotationsFromString(
        rawAnnotations: string,
        labelNames: LabelName[],
        imageSize: ISize,
        imageName: string
    ): LabelRect[] {
        return rawAnnotations
            .split(/[\r\n]/)
            .filter(Boolean)
            .map((rawAnnotation: string) => YOLOUtils.parseYOLOAnnotationFromString(
                rawAnnotation, labelNames, imageSize, imageName
            ));
    }

    public static parseYOLOAnnotationFromString(
        rawAnnotation: string,
        labelNames: LabelName[],
        imageSize: ISize,
        imageName: string
    ): LabelRect {
        const components = rawAnnotation.split(' ');
        if (!YOLOUtils.validateYOLOAnnotationComponents(components, labelNames.length)) {
            throw new AnnotationsParsingError(imageName);
        }
        const labelIndex: number = parseInt(components[0]);
        const labelId: string = labelNames[labelIndex].id;
        const rectX: number = parseFloat(components[1]);
        const rectY: number = parseFloat(components[2]);
        const rectWidth: number = parseFloat(components[3]);
        const rectHeight: number = parseFloat(components[4]);
        const rect = {
            x: (rectX - rectWidth /2) * imageSize.width,
            y: (rectY - rectHeight /2) * imageSize.height,
            width: rectWidth * imageSize.width,
            height: rectHeight * imageSize.height
        }
        return LabelUtil.createLabelRect(labelId, rect);
    }

    public static validateYOLOAnnotationComponents(components: string[], labelNamesCount: number): boolean {
        const validateCoordinateValue = (rawValue: string): boolean => {
            const floatValue: number = Number(rawValue);
            return !isNaN(floatValue) && 0.0 <= floatValue && floatValue <= 1.0;
        }
        const validateLabelIdx = (rawValue: string): boolean => {
            const intValue: number = parseInt(rawValue);
            return !isNaN(intValue) && 0 <= intValue && intValue < labelNamesCount;
        }

        return [
            components.length === 5,
            validateLabelIdx(components[0]),
            validateCoordinateValue(components[1]),
            validateCoordinateValue(components[2]),
            validateCoordinateValue(components[3]),
            validateCoordinateValue(components[4])
        ].every(Boolean)
    }
}
