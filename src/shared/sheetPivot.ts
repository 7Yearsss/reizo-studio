import {
  MAX_COLS,
  MAX_OPERATIONS,
  MAX_OPERATION_ROWS,
  MAX_ROWS,
  a1Of,
  applySheetOperations,
  getCell,
  parseA1,
  parseA1Range,
  resolveSheet,
  type SheetArtifactContent,
  type SheetCellValue,
  type SheetGrid,
  type SheetOperation,
} from './sheetContent';

export type PivotAggregate = 'sum' | 'count' | 'average' | 'min' | 'max';
export interface SheetPivotValue { field: string; agg: PivotAggregate }
export interface SheetPivotFilter { field: string; values: SheetCellValue[] }

/** Stored pivot definition. Sheets are referenced by stable id; output is the A1 range last written. */
export interface SheetPivot {
  id: string;
  name: string;
  source: { sheetId: string; range: string };
  rows: string[];
  columns: string[];
  values: SheetPivotValue[];
  filters: SheetPivotFilter[];
  target: { sheetId: string; start: string };
  totals: boolean;
  output?: string;
}

/** What the agent (or the field panel) supplies. Sheets may be names or ids; `id` updates an existing pivot. */
export interface SheetPivotInput {
  id?: string;
  name?: string;
  source?: { sheet?: string; range: string };
  rows?: string[];
  columns?: string[];
  values?: SheetPivotValue[];
  filters?: SheetPivotFilter[];
  target?: { sheet?: string; newSheet?: string; start?: string };
  totals?: boolean;
}

export const PIVOT_AGG_LABELS: Record<PivotAggregate, string> = { sum: '求和', count: '计数', average: '平均值', min: '最小值', max: '最大值' };
export const MAX_PIVOT_ROW_FIELDS = 3;
export const MAX_PIVOT_VALUES = 4;
export const MAX_PIVOT_ROW_KEYS = 500;
export const MAX_PIVOT_COLUMN_KEYS = 30;
const MAX_FILTER_TERMS = 20;
const BLANK_LABEL = '(空白)';

export function sheetPivots(content: SheetArtifactContent): SheetPivot[] {
  return (content.pivots ?? []).filter((item): item is SheetPivot => {
    const p = item as Partial<SheetPivot> | null;
    return Boolean(p && typeof p.id === 'string' && p.source?.sheetId && p.target?.sheetId && Array.isArray(p.rows) && Array.isArray(p.columns) && Array.isArray(p.values));
  });
}

export function describePivot(pivot: Pick<SheetPivot, 'rows' | 'columns' | 'values' | 'filters'>): string {
  return [
    pivot.rows.length ? `行：${pivot.rows.join('、')}` : '',
    pivot.columns.length ? `列：${pivot.columns.join('、')}` : '',
    `值：${pivot.values.map((v) => `${PIVOT_AGG_LABELS[v.agg]}(${v.field})`).join('、')}`,
    pivot.filters.length ? `筛选：${pivot.filters.map((f) => `${f.field}∈{${f.values.map(label).join(',')}}`).join('、')}` : '',
  ].filter(Boolean).join(' · ');
}

type Key = string | number | boolean;
function keyOf(value: SheetCellValue | undefined): Key {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value.trim() : value;
}
function label(value: SheetCellValue | Key): string {
  return value === '' || value === null ? BLANK_LABEL : String(value);
}
function compareKeys(a: Key, b: Key): number {
  if (a === '' || b === '') return a === b ? 0 : a === '' ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'zh-CN', { numeric: true });
}
function sameKey(a: Key, b: Key): boolean {
  return a === b || (typeof a !== typeof b && String(a) === String(b));
}

/** Exact-match SUMIFS criterion; wildcards and quotes in text are escaped. */
function criterion(key: Key): string {
  if (key === '') return '""';
  if (typeof key === 'number') return String(key);
  if (typeof key === 'boolean') return key ? 'TRUE' : 'FALSE';
  return `"=${key.replace(/[~*?]/g, '~$&').replaceAll('"', '""')}"`;
}
function quoteSheet(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}
/** Label cells that look like formulas would be evaluated; a leading apostrophe keeps them text. */
function safeLabel(value: Key): SheetCellValue {
  if (value === '') return BLANK_LABEL;
  return typeof value === 'string' && value.startsWith('=') ? `'${value}` : value;
}

interface Layout { values: SheetCellValue[][]; rows: number; cols: number }

function computeLayout(content: SheetArtifactContent, pivot: SheetPivot): Layout {
  const source = content.sheets.find((sheet) => sheet.id === pivot.source.sheetId);
  if (!source) throw new Error('透视表的数据源工作表不存在');
  const range = parseA1Range(pivot.source.range);
  if (!range || range.end.row <= range.start.row) throw new Error(`数据源范围无效：${pivot.source.range}，需包含表头行和至少一行数据`);
  const headers = new Map<string, number>();
  for (let col = range.start.col; col <= range.end.col; col += 1) {
    const text = String(keyOf(getCell(source, range.start.row, col)?.v));
    if (text && !headers.has(text)) headers.set(text, col);
  }
  const column = (field: string) => {
    const col = headers.get(field.trim());
    if (col === undefined) throw new Error(`数据源表头中没有字段「${field}」；可用字段：${[...headers.keys()].join('、') || '（无）'}`);
    return col;
  };
  const rowCols = pivot.rows.map(column);
  const colCol = pivot.columns[0] === undefined ? undefined : column(pivot.columns[0]);
  const valueCols = pivot.values.map((v) => column(v.field));
  const filterCols = pivot.filters.map((f) => ({ col: column(f.field), keys: f.values.map(keyOf) }));

  const firstRow = range.start.row + 1;
  const rowKeys = new Map<string, Key[]>();
  const colKeys: Key[] = [];
  for (let row = firstRow; row <= range.end.row; row += 1) {
    const read = (col: number) => keyOf(getCell(source, row, col)?.v);
    if ([...rowCols, ...(colCol === undefined ? [] : [colCol]), ...valueCols].every((col) => read(col) === '')) continue;
    if (!filterCols.every((f) => f.keys.some((k) => sameKey(k, read(f.col))))) continue;
    const tuple = rowCols.map(read);
    rowKeys.set(JSON.stringify(tuple), tuple);
    if (colCol !== undefined) { const key = read(colCol); if (!colKeys.some((k) => sameKey(k, key))) colKeys.push(key); }
  }
  if (rowKeys.size > MAX_PIVOT_ROW_KEYS) throw new Error(`行分组超过 ${MAX_PIVOT_ROW_KEYS} 个，请减少行字段或添加筛选`);
  if (colKeys.length > MAX_PIVOT_COLUMN_KEYS) throw new Error(`列分组超过 ${MAX_PIVOT_COLUMN_KEYS} 个，请换一个列字段或添加筛选`);
  const tuples = [...rowKeys.values()].sort((a, b) => { for (let i = 0; i < a.length; i += 1) { const c = compareKeys(a[i]!, b[i]!); if (c) return c; } return 0; });
  colKeys.sort(compareKeys);

  const ref = (col: number) => { const letters = a1Of(0, col).replace(/\d+$/, ''); return `${quoteSheet(source.name)}!$${letters}$${firstRow + 1}:$${letters}$${range.end.row + 1}`; };
  let filterSets: string[][] = [[]];
  for (const f of filterCols) {
    filterSets = filterSets.flatMap((set) => f.keys.map((key) => [...set, ref(f.col), criterion(key)]));
    if (filterSets.length > MAX_FILTER_TERMS) throw new Error('筛选组合过多，请减少多选筛选值');
  }
  const formula = (value: SheetPivotValue, valueCol: number, criteria: string[]) => {
    const val = ref(valueCol);
    const sets = filterSets.map((set) => [...criteria, ...set]);
    const ifs = (fn: string, pairs: string[]) => `${fn}(${val},${(pairs.length ? pairs : [val, '"<>"']).join(',')})`;
    const counts = sets.map((pairs) => `COUNTIFS(${[val, '"<>"', ...pairs].join(',')})`).join('+');
    switch (value.agg) {
      case 'sum': return `=${sets.map((pairs) => ifs('SUMIFS', pairs)).join('+')}`;
      case 'count': return `=${counts}`;
      case 'average': return sets.length === 1 ? `=IFERROR(${ifs('AVERAGEIFS', sets[0]!)},"")` : `=IFERROR((${sets.map((pairs) => ifs('SUMIFS', pairs)).join('+')})/(${counts}),"")`;
      case 'min':
      case 'max':
        if (sets.length > 1) throw new Error('最小值/最大值暂只支持单值筛选');
        return `=IF(${counts}=0,"",${ifs(value.agg === 'min' ? 'MINIFS' : 'MAXIFS', sets[0]!)})`;
    }
  };
  const valueLabel = (value: SheetPivotValue) => `${PIVOT_AGG_LABELS[value.agg]}：${value.field}`;
  const multi = pivot.values.length > 1;
  const columnGroups: Array<{ title: string; criteria: string[] }> = colCol === undefined
    ? [{ title: '', criteria: [] }]
    : [...colKeys.map((key) => ({ title: label(key), criteria: [ref(colCol), criterion(key)] })), ...(pivot.totals ? [{ title: '总计', criteria: [] }] : [])];
  const header: SheetCellValue[] = [...(pivot.rows.length ? pivot.rows : ['']), ...columnGroups.flatMap((group) => pivot.values.map((value) => colCol === undefined ? valueLabel(value) : multi ? `${group.title} · ${valueLabel(value)}` : group.title))];
  if (colCol !== undefined && !multi && pivot.rows.length === 0) header[0] = valueLabel(pivot.values[0]!);
  const bodyRow = (labels: SheetCellValue[], criteria: string[]) => [...labels, ...columnGroups.flatMap((group) => pivot.values.map((value, i) => formula(value, valueCols[i]!, [...criteria, ...group.criteria])))];
  const body = pivot.rows.length
    ? tuples.map((tuple) => bodyRow(tuple.map(safeLabel), tuple.flatMap((key, i) => [ref(rowCols[i]!), criterion(key)])))
    : [bodyRow(['总计'], [])];
  if (pivot.rows.length && pivot.totals) body.push(bodyRow(['总计', ...pivot.rows.slice(1).map(() => '')], []));
  const values = [header, ...body];
  const cols = header.length;
  if (cols > MAX_COLS) throw new Error(`透视结果超过 ${MAX_COLS} 列，请减少列分组或值字段`);
  return { values, rows: values.length, cols };
}

function rectOf(start: string, rows: number, cols: number): string {
  const at = parseA1(start);
  if (!at) throw new Error(`目标单元格无效：${start}`);
  if (at.row + rows > MAX_ROWS || at.col + cols > MAX_COLS) throw new Error(`透视结果放在 ${start} 会超出表格容量（${MAX_ROWS} 行 × ${MAX_COLS} 列）`);
  return `${a1Of(at.row, at.col)}:${a1Of(at.row + rows - 1, at.col + cols - 1)}`;
}
function inRange(row: number, col: number, range?: string): boolean {
  const r = range ? parseA1Range(range) : null;
  return Boolean(r && row >= r.start.row && row <= r.end.row && col >= r.start.col && col <= r.end.col);
}
function rangesOverlap(a: string, b: string): boolean {
  const x = parseA1Range(a); const y = parseA1Range(b);
  return Boolean(x && y && x.start.row <= y.end.row && y.start.row <= x.end.row && x.start.col <= y.end.col && y.start.col <= x.end.col);
}
function run(content: SheetArtifactContent, operations: SheetOperation[]): SheetArtifactContent {
  let next = content;
  for (let i = 0; i < operations.length; i += MAX_OPERATIONS) {
    const result = applySheetOperations(next, operations.slice(i, i + MAX_OPERATIONS));
    if ('error' in result) throw new Error(result.error);
    next = result.content;
  }
  return next;
}
function sheetOf(content: SheetArtifactContent, ref: string | undefined, what: string): SheetGrid {
  const sheet = resolveSheet(content, ref);
  if (!sheet) throw new Error(`${what}工作表不存在：${ref ?? '(当前)'}`);
  return sheet;
}

/**
 * Creates or updates a pivot and writes its output as live SUMIFS-family formulas. The output never
 * overwrites existing data outside the pivot's previous output.
 */
export function applySheetPivot(content: SheetArtifactContent, input: SheetPivotInput): { content: SheetArtifactContent; pivot: SheetPivot; previous?: SheetPivot } {
  const pivots = sheetPivots(content);
  const previous = input.id ? pivots.find((p) => p.id === input.id) : undefined;
  if (input.id && !previous) throw new Error(`没有找到透视表 ${input.id}`);
  let next = content;
  const sourceSheet = input.source ? sheetOf(next, input.source.sheet, '数据源') : next.sheets.find((s) => s.id === previous?.source.sheetId);
  if (!sourceSheet) throw new Error('请提供数据源 source.range');
  const sourceRange = input.source?.range ?? previous!.source.range;
  const sourceRect = parseA1Range(sourceRange);
  if (!sourceRect) throw new Error(`数据源范围无效：${sourceRange}`);

  let targetSheet: SheetGrid | undefined;
  if (input.target?.newSheet) {
    if (resolveSheet(next, input.target.newSheet.trim())) throw new Error(`工作表「${input.target.newSheet.trim()}」已存在，请换一个名称`);
    next = run(next, [{ op: 'addSheet', name: input.target.newSheet }]);
    targetSheet = sheetOf(next, input.target.newSheet.trim(), '目标');
  } else if (input.target?.sheet) targetSheet = sheetOf(next, input.target.sheet, '目标');
  else targetSheet = next.sheets.find((s) => s.id === (previous?.target.sheetId ?? sourceSheet.id));
  if (!targetSheet) throw new Error('透视表的目标工作表不存在');
  const start = input.target?.start ?? (input.target?.newSheet ? 'A1' : previous && previous.target.sheetId === targetSheet.id ? previous.target.start : a1Of(sourceRect.start.row, Math.min(MAX_COLS - 1, sourceRect.end.col + 2)));

  const pivot: SheetPivot = {
    id: previous?.id ?? nextPivotId(pivots),
    name: (input.name ?? previous?.name ?? '透视表').trim().slice(0, 80) || '透视表',
    source: { sheetId: sourceSheet.id, range: sourceRange.toUpperCase() },
    rows: (input.rows ?? previous?.rows ?? []).map((f) => f.trim()).filter(Boolean),
    columns: (input.columns ?? previous?.columns ?? []).map((f) => f.trim()).filter(Boolean),
    values: input.values ?? previous?.values ?? [],
    filters: input.filters ?? previous?.filters ?? [],
    target: { sheetId: targetSheet.id, start: start.toUpperCase() },
    totals: input.totals ?? previous?.totals ?? true,
  };
  if (pivot.rows.length > MAX_PIVOT_ROW_FIELDS) throw new Error(`行字段最多 ${MAX_PIVOT_ROW_FIELDS} 个`);
  if (pivot.columns.length > 1) throw new Error('列字段暂只支持 1 个');
  if (!pivot.values.length || pivot.values.length > MAX_PIVOT_VALUES) throw new Error(`值字段需要 1 至 ${MAX_PIVOT_VALUES} 个`);
  if (pivot.filters.some((f) => !f.values.length)) throw new Error('筛选需至少包含一个值');

  const layout = computeLayout(next, pivot);
  const output = rectOf(pivot.target.start, layout.rows, layout.cols);
  if (targetSheet.id === sourceSheet.id && rangesOverlap(output, pivot.source.range)) throw new Error(`透视结果 ${output} 与数据源 ${pivot.source.range} 重叠，请换个位置或放到新工作表`);
  const ownOld = previous && previous.target.sheetId === targetSheet.id ? previous.output : undefined;
  const rect = parseA1Range(output)!;
  for (let row = rect.start.row; row <= rect.end.row; row += 1) for (let col = rect.start.col; col <= rect.end.col; col += 1) {
    if (getCell(targetSheet, row, col) && !inRange(row, col, ownOld)) throw new Error(`目标区域 ${output} 中 ${a1Of(row, col)} 已有数据，请换到空白区域或新工作表`);
  }
  for (const other of pivots) if (other.id !== pivot.id && other.target.sheetId === targetSheet.id && other.output && rangesOverlap(other.output, output)) throw new Error(`目标区域与透视表「${other.name}」重叠`);

  const ops: SheetOperation[] = [];
  if (previous?.output) ops.push({ op: 'clearRange', sheet: previous.target.sheetId, range: previous.output });
  for (let i = 0; i < layout.values.length; i += MAX_OPERATION_ROWS) {
    ops.push({ op: 'setValues', sheet: targetSheet.id, start: a1Of(rect.start.row + i, rect.start.col), values: layout.values.slice(i, i + MAX_OPERATION_ROWS) });
  }
  next = run(next, ops);
  const stored = { ...pivot, output };
  next = { ...next, pivots: [...pivots.filter((p) => p.id !== pivot.id), stored] };
  return { content: next, pivot: stored, ...(previous ? { previous } : {}) };
}

export function removeSheetPivot(content: SheetArtifactContent, id: string): SheetArtifactContent {
  const pivots = sheetPivots(content);
  const pivot = pivots.find((p) => p.id === id);
  if (!pivot) throw new Error(`没有找到透视表 ${id}`);
  const next = pivot.output && content.sheets.some((s) => s.id === pivot.target.sheetId) ? run(content, [{ op: 'clearRange', sheet: pivot.target.sheetId, range: pivot.output }]) : content;
  return { ...next, pivots: pivots.filter((p) => p.id !== id) };
}

/** Re-reads the source so new categories get their own rows/columns; formulas already track value changes. */
export function refreshSheetPivots(content: SheetArtifactContent): { content: SheetArtifactContent; errors: string[] } {
  let next = content;
  const errors: string[] = [];
  for (const pivot of sheetPivots(content)) {
    try { next = applySheetPivot(next, { id: pivot.id }).content; } catch (error) { errors.push(`「${pivot.name}」：${error instanceof Error ? error.message : '刷新失败'}`); }
  }
  return { content: next, errors };
}

function nextPivotId(pivots: SheetPivot[]): string {
  let n = pivots.length + 1;
  while (pivots.some((p) => p.id === `pivot-${n}`)) n += 1;
  return `pivot-${n}`;
}

export interface PivotSourceField { name: string; values: Key[]; truncated: boolean }
const MAX_FIELD_VALUES = 100;

/** Header names and distinct values of a source range, for the field panel. */
export function pivotSourceFields(content: SheetArtifactContent, sheet: string | undefined, range: string): PivotSourceField[] {
  const source = sheetOf(content, sheet, '数据源');
  const rect = parseA1Range(range);
  if (!rect || rect.end.row <= rect.start.row) throw new Error('数据源需包含表头行和至少一行数据');
  const fields: PivotSourceField[] = [];
  for (let col = rect.start.col; col <= rect.end.col; col += 1) {
    const name = String(keyOf(getCell(source, rect.start.row, col)?.v));
    if (!name || fields.some((f) => f.name === name)) continue;
    const values: Key[] = [];
    let truncated = false;
    for (let row = rect.start.row + 1; row <= rect.end.row; row += 1) {
      const key = keyOf(getCell(source, row, col)?.v);
      if (values.some((v) => sameKey(v, key))) continue;
      if (values.length >= MAX_FIELD_VALUES) { truncated = true; break; }
      values.push(key);
    }
    fields.push({ name, values: values.sort(compareKeys), truncated });
  }
  return fields;
}

/** A multi-row selection is used as-is; otherwise the sheet's used area starting at A1. */
export function suggestPivotSource(content: SheetArtifactContent, sheet: string | undefined, selection?: string): { sheetId: string; range: string } | null {
  const grid = resolveSheet(content, sheet);
  if (!grid) return null;
  const rect = selection ? parseA1Range(selection) : null;
  if (rect && rect.end.row > rect.start.row) return { sheetId: grid.id, range: `${a1Of(rect.start.row, rect.start.col)}:${a1Of(rect.end.row, rect.end.col)}` };
  let rows = 0; let cols = 0;
  for (const [r, row] of Object.entries(grid.cells)) for (const c of Object.keys(row)) { rows = Math.max(rows, Number(r) + 1); cols = Math.max(cols, Number(c) + 1); }
  return rows >= 2 ? { sheetId: grid.id, range: `A1:${a1Of(rows - 1, cols - 1)}` } : null;
}

export function pivotFieldLabel(value: Key): string {
  return label(value);
}
