import {GeneralSelector} from '../store/selectors/GeneralSelector';
import {saveAs} from 'file-saver';

export class ExporterUtil {
    public static getExportFileName(formatPrefix?: string): string {
        const projectName: string = GeneralSelector.getProjectName();
        const now = new Date();
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
        const prefix = formatPrefix ? `${formatPrefix}_` : '';
        return `${prefix}labels_${projectName}_${date}`
    }

    public static saveAs(content: string, fileName: string): void {
        const blob = new Blob([content], {type: 'text/plain;charset=utf-8'});
        try {
            saveAs(blob, fileName);
        } catch (error) {
            // TODO: Implement file save error handling
            throw new Error(error as string);
        }
    }
}
