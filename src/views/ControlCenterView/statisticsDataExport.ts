import JSZip from 'jszip';
import {StatisticsExportTables} from './statisticsExport';

const spreadsheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
// eslint-disable-next-line no-control-regex -- XML 1.0 cannot contain these control characters.
const xml = (text: string) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const column = (index: number): string => {
    let name = '';
    for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
        name = String.fromCharCode(65 + (value - 1) % 26) + name;
    }
    return name;
};

export const statisticsCsv = (rows: StatisticsExportTables[string]): string => '\uFEFF' + rows.map(row => row.map(value => {
    let text = value === null ? '' : String(value);
    // CSV has no cell types; protect strings that spreadsheet apps might execute as formulas.
    if (typeof value === 'string' && /^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}).join(',')).join('\r\n') + '\r\n';

const worksheet = (rows: StatisticsExportTables[string]): string => {
    const columns = rows[0].length;
    if (rows.length > 1048576 || columns > 16384) throw new Error('数据超过 Excel 工作表容量，请缩短日期范围。');
    const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="36" customHeight="1"' : ''}>`
        + row.map((value, col) => {
            const ref = `${column(col)}${rowIndex + 1}`;
            const style = rowIndex === 0 ? 1 : 0;
            if (value === null) return `<c r="${ref}" s="${style}"/>`;
            if (typeof value === 'number') return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
            // Inline strings keep identifiers and formula-looking names as literal text.
            return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
        }).join('') + '</row>').join('');
    const range = `A1:${column(columns - 1)}${rows.length}`;
    return `<worksheet xmlns="${spreadsheetNs}"><dimension ref="${range}"/>`
        + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews>'
        + `<cols><col min="1" max="${columns}" width="26" customWidth="1"/></cols>`
        + `<sheetData>${body}</sheetData><autoFilter ref="${range}"/></worksheet>`;
};

const styles = `<styleSheet xmlns="${spreadsheetNs}">`
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

export const statisticsDataExport = async (tables: StatisticsExportTables, signal: AbortSignal): Promise<{blob: Blob; extension: 'csv' | 'xlsx'}> => {
    const entries = Object.entries(tables);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (entries.length === 1) return {blob: new Blob([statisticsCsv(entries[0][1])], {type: 'text/csv;charset=utf-8'}), extension: 'csv'};
    const zip = new JSZip();
    zip.file('_rels/.rels', `<Relationships xmlns="${packageNs}"><Relationship Id="workbook" Type="${relationshipNs}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    zip.file('xl/workbook.xml', `<workbook xmlns="${spreadsheetNs}" xmlns:r="${relationshipNs}"><sheets>`
        + entries.map(([name], index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="sheet${index + 1}"/>`).join('') + '</sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${packageNs}">`
        + entries.map((_, index) => `<Relationship Id="sheet${index + 1}" Type="${relationshipNs}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')
        + `<Relationship Id="styles" Type="${relationshipNs}/styles" Target="styles.xml"/></Relationships>`);
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + entries.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>');
    zip.file('xl/styles.xml', styles);
    entries.forEach(([, rows], index) => zip.file(`xl/worksheets/sheet${index + 1}.xml`, worksheet(rows)));
    const blob = await zip.generateAsync({type: 'blob', compression: 'DEFLATE',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}, () => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    });
    return {blob, extension: 'xlsx'};
};
