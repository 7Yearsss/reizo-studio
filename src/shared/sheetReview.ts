import {
  MAX_OPERATIONS,
  a1Of,
  applySheetOperations,
  compactToUniverSnapshot,
  parseA1,
  parseA1Range,
  resolveSheet,
  type SheetArtifactContent,
  type SheetCell,
  type SheetCellValue,
  type SheetGrid,
  type SheetOperation,
} from './sheetContent';
import { applySheetChart, diffSheetCharts, removeChartsForPivot, removeSheetChart, sheetCharts, SHEET_CHART_TYPE_LABELS, type SheetChartChange, type SheetChartInput } from './sheetChart';
import { applySheetPivot, describePivot, removeSheetPivot, sheetPivots, type SheetPivotInput } from './sheetPivot';

/**
 * One reviewable sheet edit. Each one must apply on its own to the base workbook, so the
 * user can accept or reject it independently; a new sheet carries its own initial data.
 */
export type SheetReviewOperation =
  | Exclude<SheetOperation, { op: 'addSheet' }>
  | { op: 'addSheet'; name: string; values?: SheetCellValue[][]; formulas?: Array<{ cell: string; formula: string }> }
  | { op: 'upsertPivot'; pivot: SheetPivotInput }
  | { op: 'deletePivot'; id: string }
  | { op: 'upsertChart'; chart: SheetChartInput }
  | { op: 'deleteChart'; id: string };
type CellOperation = Exclude<SheetReviewOperation, { op: 'upsertPivot' | 'deletePivot' | 'upsertChart' | 'deleteChart' }>;

export type SheetCellChangeKind = 'added' | 'modified' | 'formula' | 'cleared';
export interface SheetCellChange { row: number; col: number; a1: string; kind: SheetCellChangeKind; before?: SheetCell; after?: SheetCell }
export interface SheetDiffSheet { sheetId: string; name: string; previousName?: string; status: 'added' | 'removed' | 'changed'; cells: SheetCellChange[] }
export interface SheetDiff { sheets: SheetDiffSheet[]; counts: Record<SheetCellChangeKind, number>; charts: SheetChartChange[] }

export const SHEET_CHANGE_LABELS: Record<SheetCellChangeKind, string> = { added: '新增', modified: '修改', formula: '公式', cleared: '清空' };
export const SHEET_CHANGE_COLORS: Record<SheetCellChangeKind, string> = { added: '#d9f5e1', modified: '#fdf0c4', formula: '#e9e2fd', cleared: '#fde0e0' };
const TAB_COLORS = { added: '#2f9e5b', changed: '#d39b16', removed: '#d64545' } as const;

function expand(operation: CellOperation): SheetOperation[] {
  if (operation.op !== 'addSheet') return [operation];
  const name = operation.name.trim();
  return [
    { op: 'addSheet', name },
    ...(operation.values?.length ? [{ op: 'setValues' as const, sheet: name, start: 'A1', values: operation.values }] : []),
    ...(operation.formulas ?? []).map((item) => ({ op: 'setFormulas' as const, sheet: name, start: item.cell, formulas: [[item.formula]] })),
  ];
}

/** Applies review operations in order; throws with the provider-facing message on failure. */
export function applySheetReviewOperations(content: SheetArtifactContent, operations: SheetReviewOperation[]): SheetArtifactContent {
  let next = content;
  let pending: SheetOperation[] = [];
  const flush = () => {
    for (let i = 0; i < pending.length; i += MAX_OPERATIONS) {
      const result = applySheetOperations(next, pending.slice(i, i + MAX_OPERATIONS));
      if ('error' in result) throw new Error(result.error);
      next = result.content;
    }
    pending = [];
  };
  for (const operation of operations) {
    if (operation.op === 'upsertPivot') { flush(); next = applySheetPivot(next, operation.pivot).content; }
    else if (operation.op === 'deletePivot') { flush(); next = removeChartsForPivot(removeSheetPivot(next, operation.id), operation.id); }
    else if (operation.op === 'upsertChart') { flush(); next = applySheetChart(next, operation.chart).content; }
    else if (operation.op === 'deleteChart') { flush(); next = removeSheetChart(next, operation.id); }
    else pending.push(...expand(operation));
  }
  flush();
  return next;
}

function filled(cell?: SheetCell): boolean {
  return Boolean(cell && (cell.f || (cell.v !== undefined && cell.v !== null && cell.v !== '')));
}

/** Formula results are recomputed after every server edit, so formula cells compare by formula only. */
function classify(before?: SheetCell, after?: SheetCell): SheetCellChangeKind | null {
  const had = filled(before);
  const has = filled(after);
  if (!had && !has) return null;
  if (!had) return 'added';
  if (!has) return 'cleared';
  if (before!.f || after!.f) return before!.f === after!.f ? null : 'formula';
  return before!.v === after!.v ? null : 'modified';
}

function cellKeys(sheet?: SheetGrid): Set<string> {
  const keys = new Set<string>();
  for (const [row, cols] of Object.entries(sheet?.cells ?? {})) for (const col of Object.keys(cols)) keys.add(`${row}:${col}`);
  return keys;
}

export function diffSheetContent(before: SheetArtifactContent, after: SheetArtifactContent): SheetDiff {
  const counts: SheetDiff['counts'] = { added: 0, modified: 0, formula: 0, cleared: 0 };
  const sheets: SheetDiffSheet[] = [];
  const beforeById = new Map(before.sheets.map((sheet) => [sheet.id, sheet]));
  const afterById = new Map(after.sheets.map((sheet) => [sheet.id, sheet]));
  const order = [...after.sheets.map((sheet) => sheet.id), ...before.sheets.filter((sheet) => !afterById.has(sheet.id)).map((sheet) => sheet.id)];
  for (const id of order) {
    const a = beforeById.get(id);
    const b = afterById.get(id);
    const keys = new Set([...cellKeys(a), ...cellKeys(b)]);
    const cells: SheetCellChange[] = [];
    for (const key of keys) {
      const [row, col] = key.split(':').map(Number) as [number, number];
      const old = a?.cells[String(row)]?.[String(col)];
      const next = b?.cells[String(row)]?.[String(col)];
      const kind = classify(old, next);
      if (!kind) continue;
      counts[kind] += 1;
      cells.push({ row, col, a1: a1Of(row, col), kind, ...(old ? { before: old } : {}), ...(next ? { after: next } : {}) });
    }
    cells.sort((x, y) => x.row - y.row || x.col - y.col);
    const status = !a ? 'added' : !b ? 'removed' : 'changed';
    const renamed = a && b && a.name !== b.name;
    if (status !== 'changed' || renamed || cells.length) sheets.push({ sheetId: id, name: (b ?? a)!.name, ...(renamed ? { previousName: a.name } : {}), status, cells });
  }
  return { sheets, counts, charts: diffSheetCharts(before, after) };
}

export function isEmptySheetDiff(diff: SheetDiff): boolean {
  return diff.sheets.length === 0 && diff.charts.length === 0;
}

export function formatSheetDiffCounts(diff: SheetDiff): string {
  const parts = (Object.keys(SHEET_CHANGE_LABELS) as SheetCellChangeKind[]).filter((kind) => diff.counts[kind]).map((kind) => `${SHEET_CHANGE_LABELS[kind]} ${diff.counts[kind]}`);
  const sheets = diff.sheets.filter((sheet) => sheet.status !== 'changed' || sheet.previousName).map((sheet) => sheet.status === 'added' ? `新增工作表「${sheet.name}」` : sheet.status === 'removed' ? `删除工作表「${sheet.name}」` : `重命名「${sheet.previousName}」→「${sheet.name}」`);
  const charts = diff.charts.map((c) => `${c.status === 'added' ? '新增' : c.status === 'removed' ? '删除' : '修改'}图表「${c.name}」`);
  return [...sheets, ...charts, ...parts].join(' · ') || '无变化';
}

export function formatSheetCell(cell?: SheetCell): string {
  if (!filled(cell)) return '';
  if (cell!.f) return cell!.f;
  return String(cell!.v);
}

/** Destructive edits remove data or replace formulas with constants; they are never bulk-accepted. */
export function isDestructiveSheetChange(operation: SheetReviewOperation, diff: SheetDiff): boolean {
  if (operation.op === 'deleteSheet' || operation.op === 'clearRange' || operation.op === 'deletePivot' || operation.op === 'deleteChart') return true;
  if (operation.op === 'upsertChart') return false;
  if (operation.op === 'upsertPivot') return false;
  return diff.sheets.some((sheet) => sheet.cells.some((cell) => cell.kind === 'cleared' || (cell.before?.f && !cell.after?.f)));
}

type Rect = { r1: number; c1: number; r2: number; c2: number };
export interface SheetReviewTarget { sheet: string; rect?: Rect; whole: boolean; label: string }

/** Where an operation lands in the base workbook: sheet id (or the new sheet name) and cell rectangle. */
export function sheetReviewTarget(content: SheetArtifactContent, operation: SheetReviewOperation): SheetReviewTarget {
  if (operation.op === 'upsertPivot' || operation.op === 'deletePivot') return pivotTarget(content, operation);
  if (operation.op === 'deleteChart') {
    const chart = sheetCharts(content).find((c) => c.id === operation.id);
    if (!chart) throw new Error(`没有找到图表 ${operation.id}`);
    return { sheet: `chart:${operation.id}`, whole: true, label: `图表「${chart.name}」` };
  }
  if (operation.op === 'upsertChart') {
    const { chart } = applySheetChart(content, operation.chart);
    return { sheet: `chart:${operation.chart.id ?? `new:${chart.name}`}`, whole: true, label: `图表「${chart.name}」 · ${SHEET_CHART_TYPE_LABELS[chart.type]}` };
  }
  if (operation.op === 'addSheet') return { sheet: `new:${operation.name.trim().toLowerCase()}`, whole: true, label: operation.name.trim() };
  const sheet = resolveSheet(content, operation.sheet);
  if (!sheet) throw new Error(`Unknown sheet: ${operation.sheet ?? '(active)'}`);
  if (operation.op === 'renameSheet' || operation.op === 'deleteSheet') return { sheet: sheet.id, whole: true, label: sheet.name };
  if (operation.op === 'clearRange') {
    const range = parseA1Range(operation.range);
    if (!range) throw new Error(`Invalid range: ${operation.range}`);
    return { sheet: sheet.id, whole: false, rect: { r1: range.start.row, c1: range.start.col, r2: range.end.row, c2: range.end.col }, label: `${sheet.name}!${a1Of(range.start.row, range.start.col)}:${a1Of(range.end.row, range.end.col)}` };
  }
  const start = parseA1(operation.start);
  if (!start) throw new Error(`Invalid start: ${operation.start}`);
  const grid: unknown[][] = operation.op === 'setValues' ? operation.values : operation.formulas;
  const rows = Math.max(1, grid.length);
  const cols = Math.max(1, ...grid.map((row) => row.length));
  const rect = { r1: start.row, c1: start.col, r2: start.row + rows - 1, c2: start.col + cols - 1 };
  const end = a1Of(rect.r2, rect.c2);
  const begin = a1Of(rect.r1, rect.c1);
  return { sheet: sheet.id, whole: false, rect, label: `${sheet.name}!${begin === end ? begin : `${begin}:${end}`}` };
}

/** The A1 range to jump to for a target, when it has one. */
export function sheetTargetRange(target: SheetReviewTarget): string | undefined {
  return target.rect ? rectLabel(target.rect) : undefined;
}

export function sheetTargetsOverlap(a: SheetReviewTarget, b: SheetReviewTarget): boolean {
  if (a.sheet !== b.sheet) return false;
  if (a.whole || b.whole || !a.rect || !b.rect) return true;
  return a.rect.r1 <= b.rect.r2 && b.rect.r1 <= a.rect.r2 && a.rect.c1 <= b.rect.c2 && b.rect.c1 <= a.rect.c2;
}

function rectOfRange(range: string): Rect {
  const parsed = parseA1Range(range);
  if (!parsed) throw new Error(`Invalid range: ${range}`);
  return { r1: parsed.start.row, c1: parsed.start.col, r2: parsed.end.row, c2: parsed.end.col };
}
function union(a: Rect, b?: Rect): Rect {
  return b ? { r1: Math.min(a.r1, b.r1), c1: Math.min(a.c1, b.c1), r2: Math.max(a.r2, b.r2), c2: Math.max(a.c2, b.c2) } : a;
}
function rectLabel(rect: Rect): string {
  return `${a1Of(rect.r1, rect.c1)}:${a1Of(rect.r2, rect.c2)}`;
}
function pivotTarget(content: SheetArtifactContent, operation: Extract<SheetReviewOperation, { op: 'upsertPivot' | 'deletePivot' }>): SheetReviewTarget {
  if (operation.op === 'deletePivot') {
    const pivot = sheetPivots(content).find((p) => p.id === operation.id);
    if (!pivot) throw new Error(`没有找到透视表 ${operation.id}`);
    const sheet = content.sheets.find((s) => s.id === pivot.target.sheetId);
    return { sheet: pivot.target.sheetId, whole: !pivot.output, ...(pivot.output ? { rect: rectOfRange(pivot.output) } : {}), label: `透视表「${pivot.name}」${sheet && pivot.output ? ` · ${sheet.name}!${pivot.output}` : ''}` };
  }
  const { pivot, previous } = applySheetPivot(content, operation.pivot);
  const detail = describePivot(pivot);
  if (operation.pivot.target?.newSheet) return { sheet: `new:${operation.pivot.target.newSheet.trim().toLowerCase()}`, whole: true, label: `透视表「${pivot.name}」→ 新工作表「${operation.pivot.target.newSheet.trim()}」 · ${detail}` };
  const rect = union(rectOfRange(pivot.output!), previous?.output && previous.target.sheetId === pivot.target.sheetId ? rectOfRange(previous.output) : undefined);
  const sheet = content.sheets.find((s) => s.id === pivot.target.sheetId);
  return { sheet: pivot.target.sheetId, whole: Boolean(previous && previous.target.sheetId !== pivot.target.sheetId), rect, label: `透视表「${pivot.name}」→ ${sheet?.name ?? ''}!${rectLabel(rect)} · ${detail}` };
}

const OPERATION_VERBS: Record<SheetReviewOperation['op'], string> = { setValues: '写入数据', setFormulas: '写入公式', clearRange: '清空区域', addSheet: '新增工作表', renameSheet: '重命名工作表', deleteSheet: '删除工作表', upsertPivot: '生成透视表', deletePivot: '删除透视表', upsertChart: '生成图表', deleteChart: '删除图表' };
export function sheetOperationVerb(operation: SheetReviewOperation): string {
  return OPERATION_VERBS[operation.op];
}

type UniverStyle = Record<string, unknown>;
type UniverCell = { v?: unknown; t?: number; f?: string; s?: unknown };
type UniverSheet = { name?: string; tabColor?: string; rowCount?: number; columnCount?: number; cellData?: Record<string, Record<string, UniverCell>> };
type UniverBook = { sheetOrder?: string[]; sheets?: Record<string, UniverSheet>; styles?: Record<string, UniverStyle> };

/**
 * A throwaway Univer snapshot of the candidate workbook with every changed cell tinted, cleared cells
 * showing their old value struck through, deleted sheets restored for inspection, and sheet tabs colored.
 */
export function buildSheetDiffPreview(base: SheetArtifactContent, candidate: SheetArtifactContent, diff: SheetDiff, workbookName: string): Record<string, unknown> {
  const book = JSON.parse(JSON.stringify(candidate.univerSnapshot ?? compactToUniverSnapshot(candidate, workbookName))) as UniverBook;
  const baseBook = (base.univerSnapshot ?? compactToUniverSnapshot(base, workbookName)) as UniverBook;
  book.sheets ??= {};
  for (const sheet of diff.sheets) {
    if (sheet.status === 'removed') {
      const original = baseBook.sheets?.[sheet.sheetId];
      if (!original) continue;
      book.sheets[sheet.sheetId] = { ...JSON.parse(JSON.stringify(original)) as UniverSheet, name: `${sheet.name}（将删除）` };
      book.sheetOrder = [...(book.sheetOrder ?? []), sheet.sheetId];
      for (const style of Object.entries(baseBook.styles ?? {})) if (!book.styles?.[style[0]]) (book.styles ??= {})[style[0]] = style[1];
    }
    const target = book.sheets[sheet.sheetId];
    if (!target) continue;
    target.tabColor = TAB_COLORS[sheet.status];
    target.cellData ??= {};
    for (const change of sheet.cells) {
      const row = (target.cellData[String(change.row)] ??= {});
      const cell = (row[String(change.col)] ??= {});
      const own = typeof cell.s === 'string' ? book.styles?.[cell.s] : cell.s && typeof cell.s === 'object' ? cell.s as UniverStyle : undefined;
      const style: UniverStyle = { ...own, bg: { rgb: SHEET_CHANGE_COLORS[change.kind] } };
      if (change.kind === 'cleared' && sheet.status !== 'removed') {
        delete cell.f;
        cell.v = formatSheetCell(change.before);
        cell.t = 1;
        Object.assign(style, { st: { s: 1 }, cl: { rgb: '#a33a3a' } });
      }
      cell.s = style;
    }
  }
  return book as Record<string, unknown>;
}
