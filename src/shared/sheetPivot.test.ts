import { describe, expect, it } from 'vitest';
import { getCell, workbookFromCreateSheets, type SheetArtifactContent } from './sheetContent';
import { applySheetPivot, describePivot, pivotSourceFields, refreshSheetPivots, removeSheetPivot, sheetPivots, suggestPivotSource } from './sheetPivot';

function sales(): SheetArtifactContent {
  const result = workbookFromCreateSheets([{ name: '销售', values: [
    ['地区', '月份', '销售额', '产品'],
    ['华东', '1月', 100, 'A'],
    ['华北', '1月', 80, 'B'],
    ['华东', '2月', 120, 'A'],
    ['华东', '1月', 30, 'B'],
  ] }]);
  if ('error' in result) throw new Error(result.error);
  return result.content;
}
const cell = (content: SheetArtifactContent, sheet: number, a1: [number, number]) => getCell(content.sheets[sheet]!, a1[0], a1[1]);

describe('applySheetPivot', () => {
  it('writes a cross-tab as live SUMIFS formulas with totals', () => {
    const { content, pivot } = applySheetPivot(sales(), { name: '地区月份', source: { sheet: '销售', range: 'A1:D5' }, rows: ['地区'], columns: ['月份'], values: [{ field: '销售额', agg: 'sum' }], target: { newSheet: '汇总' } });
    expect(pivot.output).toBe('A1:D4');
    expect(describePivot(pivot)).toBe('行：地区 · 列：月份 · 值：求和(销售额)');
    expect([0, 1, 2, 3].map((col) => cell(content, 1, [0, col])?.v)).toEqual(['地区', '1月', '2月', '总计']);
    expect([1, 2, 3].map((row) => cell(content, 1, [row, 0])?.v)).toEqual(['华北', '华东', '总计']);
    expect(cell(content, 1, [2, 1])?.f).toBe(`=SUMIFS('销售'!$C$2:$C$5,'销售'!$A$2:$A$5,"=华东",'销售'!$B$2:$B$5,"=1月")`);
    expect(cell(content, 1, [3, 3])?.f).toBe(`=SUMIFS('销售'!$C$2:$C$5,'销售'!$C$2:$C$5,"<>")`);
    expect(sheetPivots(content)).toHaveLength(1);
  });

  it('supports count, average, filters and escapes wildcard text', () => {
    const base = sales();
    base.sheets[0]!.cells['4']!['0'] = { v: '华*' };
    const { content } = applySheetPivot(base, { source: { range: 'A1:D5' }, rows: ['地区'], values: [{ field: '销售额', agg: 'average' }, { field: '产品', agg: 'count' }], filters: [{ field: '月份', values: ['1月'] }], totals: false, target: { start: 'F1' } });
    expect(cell(content, 0, [0, 5])?.v).toBe('地区');
    expect(cell(content, 0, [0, 6])?.v).toBe('平均值：销售额');
    expect([1, 2, 3].map((row) => cell(content, 0, [row, 5])?.v)).toEqual(['华*', '华北', '华东']);
    expect(cell(content, 0, [1, 6])?.f).toContain('"=华~*"');
    expect(cell(content, 0, [1, 6])?.f).toMatch(/^=IFERROR\(AVERAGEIFS\(/);
    expect(cell(content, 0, [1, 7])?.f).toMatch(/^=COUNTIFS\('销售'!\$D\$2:\$D\$5,"<>",/);
    expect(cell(content, 0, [4, 5])).toBeUndefined();
  });

  it('refuses to overwrite data or overlap the source, and reports unknown fields', () => {
    expect(() => applySheetPivot(sales(), { source: { range: 'A1:D5' }, rows: ['地区'], values: [{ field: '销售额', agg: 'sum' }], target: { start: 'B2' } })).toThrow('重叠');
    expect(() => applySheetPivot(sales(), { source: { range: 'A1:B5' }, rows: ['地区'], values: [{ field: '月份', agg: 'count' }], target: { start: 'C1' } })).toThrow('已有数据');
    expect(() => applySheetPivot(sales(), { source: { range: 'A1:D5' }, rows: ['城市'], values: [{ field: '销售额', agg: 'sum' }] })).toThrow('可用字段：地区、月份、销售额、产品');
  });

  it('updates in place, refreshes new categories, and removes its output', () => {
    const first = applySheetPivot(sales(), { source: { range: 'A1:D6' }, rows: ['地区'], values: [{ field: '销售额', agg: 'sum' }], target: { start: 'F1' } });
    const grown = { ...first.content, sheets: first.content.sheets.map((sheet) => ({ ...sheet, cells: { ...sheet.cells, '5': { '0': { v: '华南' }, '2': { v: 50 } } } })) };
    const refreshed = refreshSheetPivots(grown);
    expect(refreshed.errors).toEqual([]);
    expect([1, 2, 3, 4].map((row) => cell(refreshed.content, 0, [row, 5])?.v)).toEqual(['华北', '华东', '华南', '总计']);
    const updated = applySheetPivot(refreshed.content, { id: first.pivot.id, rows: ['产品'] });
    expect(sheetPivots(updated.content)[0]!.rows).toEqual(['产品']);
    expect([1, 2, 3, 4].map((row) => cell(updated.content, 0, [row, 5])?.v)).toEqual(['A', 'B', '(空白)', '总计']);
    expect(cell(updated.content, 0, [5, 5])).toBeUndefined();
    const removed = removeSheetPivot(updated.content, first.pivot.id);
    expect(sheetPivots(removed)).toEqual([]);
    expect(cell(removed, 0, [0, 5])).toBeUndefined();
  });
});

describe('field panel helpers', () => {
  it('lists headers with sorted distinct values and suggests a source range', () => {
    const fields = pivotSourceFields(sales(), '销售', 'A1:D5');
    expect(fields.map((f) => f.name)).toEqual(['地区', '月份', '销售额', '产品']);
    expect(fields[0]!.values).toEqual(['华北', '华东']);
    expect(fields[2]!.values).toEqual([30, 80, 100, 120]);
    expect(suggestPivotSource(sales(), '销售', 'B2')).toMatchObject({ range: 'A1:D5' });
    expect(suggestPivotSource(sales(), '销售', 'A1:C3')).toMatchObject({ range: 'A1:C3' });
  });
});
