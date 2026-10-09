import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { workbookFromCreateSheets, type SheetArtifactContent } from './sheetContent';
import { applySheetPivot } from './sheetPivot';
import { applySheetChart } from './sheetChart';
import { sheetContentToXlsxBuffer } from './sheetXlsx';

function workbook(): { content: SheetArtifactContent; pivotId: string } {
  const made = workbookFromCreateSheets([{ name: "销售's", values: [['地区', '产品', '1月', '2月'], ['华东', 'A', 10, 12], ['华北', 'B', 8, 9], ['华南', 'A', 6, 7]] }]);
  if ('error' in made) throw new Error(made.error);
  const pivot = applySheetPivot(made.content, { name: '按地区', source: { range: 'A1:D4' }, rows: ['地区'], values: [{ field: '1月', agg: 'sum' }], target: { newSheet: '汇总' } });
  const content = pivot.content;
  // Stand-in for the Univer calculation the renderer captures before export.
  for (const sheet of content.sheets) for (const row of Object.values(sheet.cells)) for (const cell of Object.values(row)) if (cell.f) cell.v = 5;
  return { content, pivotId: pivot.pivot.id };
}

it('writes native charts that reference the exported cells', async () => {
  const { content: base, pivotId } = workbook();
  let content = applySheetChart(base, { pivotId, type: 'pie', anchor: { sheet: '汇总', cell: 'D2' } }).content;
  content = applySheetChart(content, { source: { sheet: "销售's", range: 'A1:D4' }, type: 'stackedColumn' }).content;
  const bytes = await sheetContentToXlsxBuffer(content);
  const zip = await JSZip.loadAsync(bytes);
  const sheet1 = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  expect(sheet1.match(/xmlns:r=/g)).toHaveLength(1);
  expect(sheet1).toMatch(/<drawing r:id="rId\d+"\/><\/worksheet>|<drawing r:id="rId\d+"\/>/);
  const types = await zip.file('[Content_Types].xml')!.async('string');
  expect(types).toContain('/xl/charts/chart1.xml');
  expect(types).toContain('/xl/drawings/drawing2.xml');
  const charts = await Promise.all(['xl/charts/chart1.xml', 'xl/charts/chart2.xml'].map((p) => zip.file(p)!.async('string')));
  const stacked = charts.find((xml) => xml.includes('<c:barChart>'))!;
  expect(stacked).toContain('<c:grouping val="stacked"/>');
  expect(stacked).toContain("<c:f>&apos;销售&apos;&apos;s&apos;!$C$2:$C$4</c:f>");
  expect(stacked).toContain('<c:pt idx="0"><c:v>10</c:v></c:pt>');
  const pie = charts.find((xml) => xml.includes('<c:pieChart>'))!;
  // The pivot's 总计 row stays out of the chart.
  expect(pie).toContain('<c:f>&apos;汇总&apos;!$A$2:$A$4</c:f>');
  expect(pie).toContain('<c:f>&apos;汇总&apos;!$B$2:$B$4</c:f>');
  const drawing = await zip.file('xl/drawings/drawing2.xml')!.async('string');
  expect(drawing).toContain('<xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row>');

  const reread = new ExcelJS.Workbook();
  await reread.xlsx.load(bytes as unknown as ArrayBuffer);
  expect(reread.worksheets.map((ws) => ws.name)).toEqual(["销售's", '汇总']);
});

it('skips charts whose data no longer resolves and leaves chartless workbooks untouched', async () => {
  const { content: base, pivotId } = workbook();
  const content = applySheetChart(base, { pivotId }).content;
  const broken = { ...content, pivots: [] as unknown[] };
  const zip = await JSZip.loadAsync(await sheetContentToXlsxBuffer(broken));
  expect(Object.keys(zip.files).some((p) => p.startsWith('xl/charts/'))).toBe(false);
});
