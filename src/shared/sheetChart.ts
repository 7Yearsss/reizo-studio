import { a1Of, getCell, parseA1, parseA1Range, resolveSheet, type SheetArtifactContent } from './sheetContent';
import { sheetPivots } from './sheetPivot';

export type SheetChartType = 'column' | 'bar' | 'line' | 'pie' | 'stackedColumn';
export const SHEET_CHART_TYPE_LABELS: Record<SheetChartType, string> = { column: '柱形图', bar: '条形图', line: '折线图', pie: '饼图', stackedColumn: '堆积柱形图' };

/**
 * A chart bound to a pivot (follows its output, without total rows/columns) or to a plain range whose
 * first row is series names and first column is categories. `anchor` is where the image lands on export.
 */
export interface SheetChart {
  id: string;
  name: string;
  type: SheetChartType;
  source: { pivotId: string } | { sheetId: string; range: string };
  anchor: { sheetId: string; cell: string };
}
export interface SheetChartInput {
  id?: string;
  name?: string;
  type?: SheetChartType;
  pivotId?: string;
  source?: { sheet?: string; range: string };
  anchor?: { sheet?: string; cell: string };
}
export interface SheetChartData { categories: string[]; series: Array<{ name: string; values: Array<number | null> }> }

/** Categorical slots beyond this fold into 其他; a ninth generated hue is never used. */
export const MAX_CHART_SERIES = 8;
export const MAX_CHART_CATEGORIES = 60;
export const CHART_PALETTE = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
} as const;
const OTHER = '其他';

export function sheetCharts(content: SheetArtifactContent): SheetChart[] {
  return (content.charts ?? []).filter((item): item is SheetChart => {
    const c = item as Partial<SheetChart> | null;
    return Boolean(c && typeof c.id === 'string' && typeof c.type === 'string' && c.type in SHEET_CHART_TYPE_LABELS && c.source && c.anchor?.sheetId);
  });
}

function numberOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export interface SheetChartRegion { sheetId: string; r1: number; c1: number; r2: number; c2: number; labelCols: number }

/** The cell block a chart reads: header row r1, label columns from c1, values to c2 (totals excluded). */
export function sheetChartRegion(content: SheetArtifactContent, chart: Pick<SheetChart, 'source'>): SheetChartRegion {
  if ('pivotId' in chart.source) {
    const pivotId = chart.source.pivotId;
    const pivot = sheetPivots(content).find((p) => p.id === pivotId);
    if (!pivot) throw new Error('图表绑定的透视表已删除');
    const out = pivot.output ? parseA1Range(pivot.output) : null;
    if (!out) throw new Error('透视表还没有生成结果');
    const labelCols = Math.max(1, pivot.rows.length);
    const totalCols = pivot.columns.length && pivot.totals ? pivot.values.length : 0;
    const totalRow = pivot.rows.length && pivot.totals ? 1 : 0;
    return { sheetId: pivot.target.sheetId, r1: out.start.row, c1: out.start.col, r2: out.end.row - totalRow, c2: out.end.col - totalCols, labelCols };
  }
  const range = parseA1Range(chart.source.range);
  if (!range || range.end.row <= range.start.row || range.end.col <= range.start.col) throw new Error('图表数据区域需包含表头行、分类列和至少一列数值');
  return { sheetId: chart.source.sheetId, r1: range.start.row, c1: range.start.col, r2: range.end.row, c2: range.end.col, labelCols: 1 };
}

function fold(data: SheetChartData, pie: boolean): SheetChartData {
  let { categories, series } = data;
  if (pie) {
    // A pie shows one measure across categories; small slices beyond the palette merge into 其他.
    const first = series[0] ?? { name: '', values: [] };
    const pairs = categories.map((c, i) => ({ c, v: first.values[i] ?? null })).filter((p) => (p.v ?? 0) > 0).sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
    if (pairs.length > MAX_CHART_SERIES) {
      const rest = pairs.slice(MAX_CHART_SERIES - 1).reduce((sum, p) => sum + (p.v ?? 0), 0);
      pairs.splice(MAX_CHART_SERIES - 1, Infinity, { c: OTHER, v: rest });
    }
    return { categories: pairs.map((p) => p.c), series: [{ name: first.name, values: pairs.map((p) => p.v) }] };
  }
  if (series.length > MAX_CHART_SERIES) {
    const rest = series.slice(MAX_CHART_SERIES - 1);
    series = [...series.slice(0, MAX_CHART_SERIES - 1), { name: OTHER, values: categories.map((_, i) => rest.reduce<number | null>((sum, s) => s.values[i] === null ? sum : (sum ?? 0) + (s.values[i] ?? 0), null)) }];
  }
  if (categories.length > MAX_CHART_CATEGORIES) {
    categories = categories.slice(0, MAX_CHART_CATEGORIES);
    series = series.map((s) => ({ ...s, values: s.values.slice(0, MAX_CHART_CATEGORIES) }));
  }
  return { categories, series };
}

/**
 * Reads chart data from cell values. Formula results come from the last Univer calculation, so callers
 * should pass content captured from the live workbook when available.
 */
export function sheetChartData(content: SheetArtifactContent, chart: Pick<SheetChart, 'source' | 'type'>): SheetChartData {
  const region = sheetChartRegion(content, chart);
  const sheet = content.sheets.find((s) => s.id === region.sheetId);
  if (!sheet) throw new Error('图表数据所在的工作表不存在');
  const text = (row: number, col: number) => { const v = getCell(sheet, row, col)?.v; return v === null || v === undefined ? '' : String(v); };
  const categories: string[] = [];
  for (let row = region.r1 + 1; row <= region.r2; row += 1) {
    const parts = [];
    for (let col = region.c1; col < region.c1 + region.labelCols; col += 1) parts.push(text(row, col));
    categories.push(parts.filter(Boolean).join(' / ') || '(空白)');
  }
  const series: SheetChartData['series'] = [];
  for (let col = region.c1 + region.labelCols; col <= region.c2; col += 1) {
    const values = [];
    for (let row = region.r1 + 1; row <= region.r2; row += 1) values.push(numberOf(getCell(sheet, row, col)?.v));
    series.push({ name: text(region.r1, col) || a1Of(region.r1, col), values });
  }
  if (!series.length) throw new Error('图表数据区域没有数值列');
  return fold({ categories, series }, chart.type === 'pie');
}

function nextChartId(charts: SheetChart[]): string {
  let n = charts.length + 1;
  while (charts.some((c) => c.id === `chart-${n}`)) n += 1;
  return `chart-${n}`;
}

/** Creates or updates a chart definition. Cells are never modified. */
export function applySheetChart(content: SheetArtifactContent, input: SheetChartInput): { content: SheetArtifactContent; chart: SheetChart; previous?: SheetChart } {
  const charts = sheetCharts(content);
  const previous = input.id ? charts.find((c) => c.id === input.id) : undefined;
  if (input.id && !previous) throw new Error(`没有找到图表 ${input.id}`);
  let source: SheetChart['source'] | undefined = previous?.source;
  if (input.pivotId) {
    if (!sheetPivots(content).some((p) => p.id === input.pivotId)) throw new Error(`没有找到透视表 ${input.pivotId}`);
    source = { pivotId: input.pivotId };
  } else if (input.source) {
    const sheet = resolveSheet(content, input.source.sheet);
    if (!sheet) throw new Error(`工作表不存在：${input.source.sheet ?? '(当前)'}`);
    source = { sheetId: sheet.id, range: input.source.range.toUpperCase() };
  }
  if (!source) throw new Error('请提供 pivotId 或 source.range');
  const type = input.type ?? previous?.type ?? 'column';
  if (!(type in SHEET_CHART_TYPE_LABELS)) throw new Error(`不支持的图表类型：${type}`);
  sheetChartData(content, { source, type });

  let anchor = previous?.anchor;
  if (input.anchor) {
    const sheet = resolveSheet(content, input.anchor.sheet);
    if (!sheet || !parseA1(input.anchor.cell)) throw new Error(`图表位置无效：${input.anchor.sheet ?? ''}!${input.anchor.cell}`);
    anchor = { sheetId: sheet.id, cell: input.anchor.cell.toUpperCase() };
  }
  if (!anchor) {
    const region = sheetChartRegion(content, { source });
    anchor = { sheetId: region.sheetId, cell: a1Of(region.r1, Math.min(49, region.c2 + 2)) };
  }
  const pivotName = 'pivotId' in source ? sheetPivots(content).find((p) => p.id === (source as { pivotId: string }).pivotId)?.name : undefined;
  const chart: SheetChart = { id: previous?.id ?? nextChartId(charts), name: (input.name ?? previous?.name ?? (pivotName ? `${pivotName} · ${SHEET_CHART_TYPE_LABELS[type]}` : SHEET_CHART_TYPE_LABELS[type])).trim().slice(0, 80), type, source, anchor };
  return { content: { ...content, charts: [...charts.filter((c) => c.id !== chart.id), chart] }, chart, ...(previous ? { previous } : {}) };
}

export function removeSheetChart(content: SheetArtifactContent, id: string): SheetArtifactContent {
  const charts = sheetCharts(content);
  if (!charts.some((c) => c.id === id)) throw new Error(`没有找到图表 ${id}`);
  return { ...content, charts: charts.filter((c) => c.id !== id) };
}

export function describeChartSource(content: SheetArtifactContent, chart: SheetChart): string {
  if ('pivotId' in chart.source) { const id = chart.source.pivotId; return `透视表「${sheetPivots(content).find((p) => p.id === id)?.name ?? id}」`; }
  const sheetId = chart.source.sheetId;
  return `${content.sheets.find((s) => s.id === sheetId)?.name ?? sheetId}!${chart.source.range}`;
}

export interface SheetChartChange { id: string; name: string; status: 'added' | 'changed' | 'removed' }
export function diffSheetCharts(before: SheetArtifactContent, after: SheetArtifactContent): SheetChartChange[] {
  const a = new Map(sheetCharts(before).map((c) => [c.id, c]));
  const b = new Map(sheetCharts(after).map((c) => [c.id, c]));
  const out: SheetChartChange[] = [];
  for (const [id, chart] of b) { const old = a.get(id); if (!old) out.push({ id, name: chart.name, status: 'added' }); else if (JSON.stringify(old) !== JSON.stringify(chart)) out.push({ id, name: chart.name, status: 'changed' }); }
  for (const [id, chart] of a) if (!b.has(id)) out.push({ id, name: chart.name, status: 'removed' });
  return out;
}

/** Charts follow their pivot; deleting the pivot deletes them too. */
export function removeChartsForPivot(content: SheetArtifactContent, pivotId: string): SheetArtifactContent {
  const charts = sheetCharts(content);
  const kept = charts.filter((c) => !('pivotId' in c.source && c.source.pivotId === pivotId));
  return kept.length === charts.length ? content : { ...content, charts: kept };
}
