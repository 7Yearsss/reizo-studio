import { describe, expect, it } from 'vitest';
import { workbookFromCreateSheets, type SheetArtifactContent } from './sheetContent';
import { applySheetPivot } from './sheetPivot';
import { MAX_CHART_SERIES, applySheetChart, diffSheetCharts, removeChartsForPivot, removeSheetChart, sheetChartData, sheetCharts } from './sheetChart';
import { applySheetReviewOperations, diffSheetContent, formatSheetDiffCounts } from './sheetReview';

function book(): SheetArtifactContent {
  const result = workbookFromCreateSheets([{ name: '数据', values: [['地区', '1月', '2月'], ['华东', 10, 12], ['华北', 8, '9'], ['华南', null, 5]] }]);
  if ('error' in result) throw new Error(result.error);
  return result.content;
}

/** Stands in for Univer: fills formula results so pivot-bound charts have numbers. */
function computed(content: SheetArtifactContent, values: Record<string, unknown>): SheetArtifactContent {
  const sheets = content.sheets.map((sheet) => ({ ...sheet, cells: Object.fromEntries(Object.entries(sheet.cells).map(([r, row]) => [r, Object.fromEntries(Object.entries(row).map(([c, cell]) => [c, `${sheet.name}:${r}:${c}` in values ? { ...cell, v: values[`${sheet.name}:${r}:${c}`] as number } : cell]))])) }));
  return { ...content, sheets };
}

describe('sheetChartData', () => {
  it('reads a range with series in columns and categories in the first column', () => {
    const { content, chart } = applySheetChart(book(), { source: { sheet: '数据', range: 'A1:C4' } });
    expect(chart).toMatchObject({ id: 'chart-1', type: 'column', anchor: { cell: 'E1' } });
    expect(sheetChartData(content, chart)).toEqual({ categories: ['华东', '华北', '华南'], series: [{ name: '1月', values: [10, 8, null] }, { name: '2月', values: [12, 9, 5] }] });
  });

  it('follows a pivot without its totals and folds extra pie slices into 其他', () => {
    const pivoted = applySheetPivot(book(), { source: { range: 'A1:C4' }, rows: ['地区'], values: [{ field: '1月', agg: 'sum' }], target: { newSheet: 'P' } });
    const content = computed(pivoted.content, { 'P:1:1': 8, 'P:2:1': 10, 'P:3:1': 0, 'P:4:1': 18 });
    const { chart } = applySheetChart(content, { pivotId: pivoted.pivot.id, type: 'pie' });
    expect(chart.name).toBe('透视表 · 饼图');
    expect(sheetChartData(content, chart)).toEqual({ categories: ['华东', '华北'], series: [{ name: '求和：1月', values: [10, 8] }] });
    const wide = workbookFromCreateSheets([{ name: 'W', values: [['k', ...Array.from({ length: 10 }, (_, i) => `s${i}`)], ['a', ...Array.from({ length: 10 }, () => 1)]] }]);
    if ('error' in wide) throw new Error(wide.error);
    const data = sheetChartData(wide.content, { type: 'column', source: { sheetId: wide.content.sheets[0]!.id, range: 'A1:K2' } });
    expect(data.series).toHaveLength(MAX_CHART_SERIES);
    expect(data.series.at(-1)).toEqual({ name: '其他', values: [3] });
  });
});

it('updates, removes, and drops charts with their pivot', () => {
  const pivoted = applySheetPivot(book(), { source: { range: 'A1:C4' }, rows: ['地区'], values: [{ field: '2月', agg: 'sum' }], target: { newSheet: 'P' } });
  const first = applySheetChart(pivoted.content, { pivotId: pivoted.pivot.id });
  const second = applySheetChart(first.content, { source: { sheet: '数据', range: 'A1:C4' }, type: 'line' });
  const changed = applySheetChart(second.content, { id: first.chart.id, type: 'bar' });
  expect(diffSheetCharts(second.content, changed.content)).toEqual([{ id: first.chart.id, name: first.chart.name, status: 'changed' }]);
  expect(sheetCharts(removeChartsForPivot(changed.content, pivoted.pivot.id)).map((c) => c.id)).toEqual([second.chart.id]);
  expect(sheetCharts(removeSheetChart(changed.content, second.chart.id))).toHaveLength(1);
  expect(() => applySheetChart(book(), { pivotId: 'missing' })).toThrow('没有找到透视表');
});

it('counts chart-only review operations as changes', () => {
  const base = book();
  const next = applySheetReviewOperations(base, [{ op: 'upsertChart', chart: { source: { sheet: '数据', range: 'A1:C4' }, type: 'line' } }]);
  const diff = diffSheetContent(base, next);
  expect(diff.sheets).toEqual([]);
  expect(formatSheetDiffCounts(diff)).toBe('新增图表「折线图」');
});
