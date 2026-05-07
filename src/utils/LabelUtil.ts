import {Annotation, LabelName, LabelPoint, LabelPolygon, LabelRect, LabelLine} from '../store/labels/types';
import { v4 as uuidv4 } from 'uuid';
import {find} from 'lodash';
import {IRect} from '../interfaces/IRect';
import {LabelStatus} from '../data/enums/LabelStatus';
import {IPoint} from '../interfaces/IPoint';
import {ILine} from '../interfaces/ILine';
import { sample } from 'lodash';
import {Settings} from '../settings/Settings';

export class LabelUtil {
    public static createLabelName(name: string): LabelName {
        return {
            id: uuidv4(),
            name,
            color: sample(Settings.LABEL_COLORS_PALETTE)
        }
    }

    public static createLabelRect(labelId: string, rect: IRect): LabelRect {
        return {
            id: uuidv4(),
            labelId,
            rect,
            isVisible: true,
            isCreatedByAI: false,
            status: LabelStatus.ACCEPTED,
            suggestedLabel: null
        }
    }

    public static createLabelPolygon(labelId: string, vertices: IPoint[]): LabelPolygon {
        return {
            id: uuidv4(),
            labelId,
            vertices,
            isVisible: true,
            isCreatedByAI: false,
            status: LabelStatus.ACCEPTED,
            suggestedLabel: null
        }
    }

    public static createLabelPoint(labelId: string, point: IPoint): LabelPoint {
        return {
            id: uuidv4(),
            labelId,
            point,
            isVisible: true,
            isCreatedByAI: false,
            status: LabelStatus.ACCEPTED,
            suggestedLabel: null
        }
    }

    public static createLabelLine(labelId: string, line: ILine): LabelLine {
        return {
            id: uuidv4(),
            labelId,
            line,
            isVisible: true,
            isCreatedByAI: false,
            status: LabelStatus.ACCEPTED,
            suggestedLabel: null
        }
    }

    public static toggleAnnotationVisibility<AnnotationType extends Annotation>(annotation: AnnotationType): AnnotationType {
        return {
            ...annotation,
            isVisible: !annotation.isVisible
        }
    }

    public static labelNamesIdsDiff(oldLabelNames: LabelName[], newLabelNames: LabelName[]): string[] {
        return oldLabelNames.reduce((missingIds: string[], labelName: LabelName) => {
            if (!find(newLabelNames, { 'id': labelName.id })) {
                missingIds.push(labelName.id);
            }
            return missingIds
        }, [])
    }

    /**
     * Merge incoming LabelNames into existing ones by case-sensitive `name`.
     *
     * - For each incoming label, if `existing` already has a label with the same `name`,
     *   reuse that existing label (id + color preserved) and record a remap from the
     *   incoming label's id to the existing label's id.
     * - If `name` is not in `existing`, create a new LabelName via {@link createLabelName}
     *   (fresh UUID + palette color), append it to the merged list, and remap incoming id
     *   to the new label's id.
     * - `existing` element references are kept stable; nothing in either input is mutated.
     * - The returned `idRemap` always contains an entry for every incoming label so callers
     *   can uniformly translate incoming label ids into final ids.
     */
    public static mergeLabelsByName(
        existing: LabelName[],
        incoming: LabelName[]
    ): { merged: LabelName[]; idRemap: Map<string, string> } {
        const merged: LabelName[] = [...existing];
        const idRemap: Map<string, string> = new Map<string, string>();

        for (const incomingLabel of incoming) {
            const match = merged.find((l: LabelName) => l.name === incomingLabel.name);
            if (match) {
                idRemap.set(incomingLabel.id, match.id);
            } else {
                const newLabel: LabelName = LabelUtil.createLabelName(incomingLabel.name);
                merged.push(newLabel);
                idRemap.set(incomingLabel.id, newLabel.id);
            }
        }

        return { merged, idRemap };
    }
}
