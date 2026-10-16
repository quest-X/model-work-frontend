import JSZip from 'jszip';
import {statisticsDataExport} from '../statisticsDataExport';

const signal = () => new AbortController().signal;
const readBlob = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(blob);
});

it('exports one table as a BOM CSV with escaped text, formulas, nulls and numbers', async () => {
    const {blob, extension} = await statisticsDataExport({Daily: [
        ['机器', '记录', '值'], ['=unsafe,"node"', '+bad\nerror', 1.5], ['0001', null, 0],
    ]}, signal());
    expect(extension).toBe('csv');
    expect(blob.type).toBe('text/csv;charset=utf-8');
    // FileReader removes the UTF-8 BOM when decoding; the byte count still includes it.
    const text = await readBlob(blob);
    expect(text).toBe('"机器","记录","值"\r\n"\'=unsafe,""node""","\'+bad\nerror","1.5"\r\n"0001","","0"\r\n');
    expect(blob.size).toBe(Buffer.byteLength(text, 'utf8') + 3);
});

it('exports multiple tables as linked Excel sheets with numeric, blank and literal text cells', async () => {
    const {blob, extension} = await statisticsDataExport({
        '每日汇总': [['机器', '数量', '空值'], ['=A1 & <"一">', 257, null]],
        'Heats': [['ID', 'Duration', ...Array(26).fill('列')], ['001', 0.5, ...Array(26).fill('值')]],
    }, signal());
    expect(extension).toBe('xlsx');
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const zip = await JSZip.loadAsync(blob);
    const parse = async (path: string) => new DOMParser().parseFromString(await zip.file(path).async('string'), 'text/xml');
    for (const name of Object.keys(zip.files).filter(path => path.endsWith('.xml') || path.endsWith('.rels'))) {
        expect((await parse(name)).querySelector('parsererror')).toBeNull();
    }
    const workbook = await parse('xl/workbook.xml');
    expect(Array.from(workbook.querySelectorAll('sheet')).map(s => s.getAttribute('name'))).toEqual(['每日汇总', 'Heats']);
    const relationships = await parse('xl/_rels/workbook.xml.rels');
    const targets = Array.from(relationships.querySelectorAll('Relationship')).map(r => `xl/${r.getAttribute('Target')}`);
    expect(targets.every(path => zip.file(path))).toBe(true);
    const first = await parse('xl/worksheets/sheet1.xml');
    expect(first.querySelector('c[r="A2"]').getAttribute('t')).toBe('inlineStr');
    expect(first.querySelector('c[r="A2"] t').textContent).toBe('=A1 & <"一">');
    expect(first.querySelector('c[r="B2"] v').textContent).toBe('257');
    expect(first.querySelector('c[r="C2"]').children).toHaveLength(0);
    expect(first.querySelector('f')).toBeNull();
    expect(first.querySelector('pane').getAttribute('state')).toBe('frozen');
    expect(first.querySelector('autoFilter').getAttribute('ref')).toBe('A1:C2');
    const second = await parse('xl/worksheets/sheet2.xml');
    expect(second.querySelector('c[r="A2"] t').textContent).toBe('001');
    expect(second.querySelector('c[r="B2"] v').textContent).toBe('0.5');
    expect(second.querySelector('c[r="AB2"] t').textContent).toBe('值');
});

it('does not generate a download after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(statisticsDataExport({One: [['a']], Two: [['b']]}, controller.signal)).rejects.toHaveProperty('name', 'AbortError');
});
