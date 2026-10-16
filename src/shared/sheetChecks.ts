import { a1Of, colToLetters, getCell, lettersToCol, usedRange, type SheetArtifactContent, type SheetCell, type SheetGrid } from './sheetContent';

/**
 * Deterministic workbook audit. Findings carry exact sheet, cell and (where there is one obvious fix) the
 * replacement, so the agent can turn them into reviewable edits instead of guessing where problems are.
 */

export type SheetCheckKind =
  | 'error-value'
  | 'inconsistent-formula'
  | 'constant-in-formulas'
  | 'range-gap'
  | 'number-as-text'
  | 'stray-space'
  | 'magic-number'
  | 'whole-column-ref';

export type SheetCheckSeverity = 'error' | 'warning' | 'info';

export interface SheetCheckFinding {
  kind: SheetCheckKind;
  severity: SheetCheckSeverity;
  sheet: string;
  sheetId: string;
  /** A1 address, or A1:B2 for a grouped finding. */
  range: string;
  /** What the cell holds now: its formula, or its value. */
  text: string;
  message: string;
  /** The obvious fix for the first cell of `range`, when there is exactly one. */
  fix?: { formula: string } | { value: string | number };
}

export interface SheetCheckResult {
  total: number;
  counts: Partial<Record<SheetCheckKind, number>>;
  findings: SheetCheckFinding[];
  scanned: { sheets: number; cells: number; formulas: number };
}

export const SHEET_CHECK_LABELS: Record<SheetCheckKind, string> = {
  'error-value': '错误值',
  'inconsistent-formula': '公式与同列不一致',
  'constant-in-formulas': '公式列里混入了手写数值',
  'range-gap': '汇总范围漏掉了相邻数据',
  'number-as-text': '文本型数字',
  'stray-space': '多余空格',
  'magic-number': '公式里写死的数值',
  'whole-column-ref': '整列引用',
};

const SEVERITY: Record<SheetCheckKind, SheetCheckSeverity> = {
  'error-value': 'error',
  'inconsistent-formula': 'warning',
  'constant-in-formulas': 'warning',
  'range-gap': 'warning',
  'number-as-text': 'warning',
  'stray-space': 'info',
  'magic-number': 'info',
  'whole-column-ref': 'info',
};

const ERROR_VALUE = /^#(REF!|DIV\/0!|N\/A|NAME\?|VALUE!|NUM!|NULL!|SPILL!|CALC!|GETTING_DATA)/;
const NUMERIC_TEXT = /^\s*[-+]?\d{1,3}(,\d{3})*(\.\d+)?\s*$|^\s*[-+]?\d+(\.\d+)?\s*$/;
/** A run of this many formulas in a column has a "normal" shape worth comparing against. */
const MIN_RUN = 3;
const MAJORITY = 0.6;
/** Constants that are plain arithmetic, not a business assumption hidden in a formula. */
const NEUTRAL_CONSTANTS = new Set([0, 1, 2, 3, 4, 5, 10, 12, 24, 60, 100, 1000]);

type Replacer = (absCol: string, letters: string, absRow: string, digits: string) => string | null;
// A1 reference that is not part of a longer word or a function name such as LOG10(.
const REF = /(?<![A-Za-z0-9_.$])(\$?)([A-Z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(])/g;
const PROTECTED = /("(?:[^"]|"")*"|'(?:[^']|'')*')/;

/** Applies `replace` to every cell reference outside string literals and quoted sheet names. */
function mapRefs(formula: string, replace: Replacer): string {
  return formula.split(PROTECTED).map((part, index) => (index % 2 ? part : part.replace(REF, (whole, ac: string, letters: string, ar: string, digits: string) => replace(ac, letters, ar, digits) ?? whole))).join('');
}

/** The formula with every reference expressed relative to its own cell, so equal shapes compare equal down a column. */
export function formulaShape(formula: string, row: number, col: number): string {
  return mapRefs(formula, (ac, letters, ar, digits) => {
    const c = lettersToCol(letters);
    if (c === null) return null;
    const r = Number(digits) - 1;
    return `{${ar ? `R$${r}` : `R${r - row}`}${ac ? `C$${c}` : `C${c - col}`}}`;
  });
}

/** Inverse of formulaShape for another cell; null when a reference would leave the sheet. */
export function formulaFromShape(shape: string, row: number, col: number): string | null {
  let ok = true;
  const out = shape.replace(/\{R(\$?)(-?\d+)C(\$?)(-?\d+)\}/g, (_whole, ar: string, r: string, ac: string, c: string) => {
    const targetRow = ar ? Number(r) : row + Number(r);
    const targetCol = ac ? Number(c) : col + Number(c);
    if (targetRow < 0 || targetCol < 0) { ok = false; return ''; }
    return `${ac}${colToLetters(targetCol)}${ar}${targetRow + 1}`;
  });
  return ok ? out : null;
}

const isNumber = (cell?: SheetCell): boolean => typeof cell?.v === 'number' && !cell.f;
const isFormula = (cell?: SheetCell): boolean => Boolean(cell?.f);
const isBlank = (cell?: SheetCell): boolean => !cell || (!cell.f && (cell.v === undefined || cell.v === null || cell.v === ''));

/** Same-shape formulas are the column's rule; a cell that breaks it is more likely a slip than a decision. */
function dominantShape(shapes: string[]): { shape: string; share: number } | null {
  const counts = new Map<string, number>();
  for (const shape of shapes) counts.set(shape, (counts.get(shape) ?? 0) + 1);
  let best: [string, number] | null = null;
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
  return best && best[1] >= MIN_RUN && best[1] / shapes.length >= MAJORITY ? { shape: best[0], share: best[1] / shapes.length } : null;
}

function constantsIn(formula: string): number[] {
  const bare = formula.split(PROTECTED).filter((_part, index) => index % 2 === 0).join(' ');
  // Digits glued to a reference or a name (B2, LOG10) are not constants.
  const stripped = bare.replace(REF, ' ').replace(/[A-Za-z_][A-Za-z0-9_.]*/g, ' ');
  return [...stripped.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)(?![\d.])/g)].map((m) => Number(m[1]));
}

interface Context { sheet: SheetGrid; findings: SheetCheckFinding[] }
const add = (ctx: Context, finding: Omit<SheetCheckFinding, 'sheet' | 'sheetId' | 'severity'>): void => {
  ctx.findings.push({ ...finding, severity: SEVERITY[finding.kind], sheet: ctx.sheet.name, sheetId: ctx.sheet.id });
};
const shown = (cell?: SheetCell): string => (cell?.f ?? String(cell?.v ?? ''));

function checkErrors(ctx: Context, rows: number, cols: number): void {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = getCell(ctx.sheet, r, c);
    if (typeof cell?.v === 'string' && ERROR_VALUE.test(cell.v)) add(ctx, { kind: 'error-value', range: a1Of(r, c), text: shown(cell), message: `${a1Of(r, c)} 的结果是 ${cell.v.split(/\s/)[0]}${cell.f ? `（公式 ${cell.f}）` : ''}` });
  }
}

/** Compare every formula with its column's rule; also catches a typed number sitting in a column of formulas. */
function checkColumnRules(ctx: Context, rows: number, cols: number): void {
  for (let c = 0; c < cols; c++) {
    const formulas: Array<{ r: number; shape: string }> = [];
    for (let r = 0; r < rows; r++) {
      const cell = getCell(ctx.sheet, r, c);
      if (cell?.f) formulas.push({ r, shape: formulaShape(cell.f, r, c) });
    }
    if (formulas.length < MIN_RUN) continue;
    const rule = dominantShape(formulas.map((f) => f.shape));
    if (!rule) continue;
    const first = formulas.find((f) => f.shape === rule.shape)!.r;
    const last = [...formulas].reverse().find((f) => f.shape === rule.shape)!.r;
    for (const { r, shape } of formulas) {
      if (shape === rule.shape) continue;
      // A total row at the foot of a column is meant to differ.
      if (r > last) continue;
      const fixed = formulaFromShape(rule.shape, r, c);
      add(ctx, { kind: 'inconsistent-formula', range: a1Of(r, c), text: shown(getCell(ctx.sheet, r, c)), message: `${a1Of(r, c)} 的公式与本列其余 ${Math.round(rule.share * 100)}% 的写法不同，其余的是 ${formulaFromShape(rule.shape, first, c) ?? ''} 这种规律`, ...(fixed ? { fix: { formula: fixed } } : {}) });
    }
    for (let r = first; r <= last; r++) {
      const cell = getCell(ctx.sheet, r, c);
      if (!isNumber(cell) || formulas.some((f) => f.r === r)) continue;
      const above = isFormula(getCell(ctx.sheet, r - 1, c));
      const below = isFormula(getCell(ctx.sheet, r + 1, c));
      if (!above || !below) continue;
      const fixed = formulaFromShape(rule.shape, r, c);
      add(ctx, { kind: 'constant-in-formulas', range: a1Of(r, c), text: String(cell?.v), message: `${a1Of(r, c)} 是手写的 ${String(cell?.v)}，上下都是公式`, ...(fixed ? { fix: { formula: fixed } } : {}) });
    }
  }
}

/** =SUM(B2:B10) with a number sitting right under B10 usually means the range was never extended. */
function checkRangeGaps(ctx: Context, rows: number, cols: number): void {
  const aggregate = /^=\s*(SUM|AVERAGE|COUNT|MAX|MIN)\(\s*\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)\s*\)\s*$/i;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = getCell(ctx.sheet, r, c);
    const m = cell?.f ? aggregate.exec(cell.f) : null;
    if (!m || m[2]!.toUpperCase() !== m[4]!.toUpperCase()) continue;
    const col = lettersToCol(m[2]!);
    if (col === null) continue;
    const start = Number(m[3]) - 1; const end = Number(m[5]) - 1;
    if (end < start) continue;
    const next = getCell(ctx.sheet, end + 1, col);
    const sitsInside = col === c && r >= start - 1 && r <= end + 1;
    if (!isNumber(next) || sitsInside) continue;
    const extended = cell!.f!.replace(/\$?[A-Z]{1,3}\$?\d+\s*\)\s*$/, `${m[4]}${end + 2})`);
    add(ctx, { kind: 'range-gap', range: a1Of(r, c), text: cell!.f!, message: `${a1Of(r, c)} 的汇总范围到 ${m[4]!.toUpperCase()}${end + 1} 为止，但紧挨着的 ${a1Of(end + 1, col)} 也是数字`, fix: { formula: extended } });
  }
}

/** A numeric column with a few text numbers: they are skipped by SUM and sort wrongly. Text-only columns (IDs, codes) are left alone. */
function checkTextNumbers(ctx: Context, rows: number, cols: number): void {
  for (let c = 0; c < cols; c++) {
    let numbers = 0; const texts: number[] = [];
    for (let r = 0; r < rows; r++) {
      const cell = getCell(ctx.sheet, r, c);
      if (isNumber(cell)) numbers++;
      else if (!cell?.f && typeof cell?.v === 'string' && NUMERIC_TEXT.test(cell.v)) texts.push(r);
    }
    if (!texts.length || numbers < MIN_RUN || numbers / (numbers + texts.length) < 0.7) continue;
    for (const r of texts) {
      const raw = String(getCell(ctx.sheet, r, c)?.v);
      add(ctx, { kind: 'number-as-text', range: a1Of(r, c), text: raw, message: `${a1Of(r, c)} 的 “${raw.trim()}” 是文本，本列其余多为数字，求和和排序会漏掉它`, fix: { value: Number(raw.replace(/,/g, '').trim()) } });
    }
  }
}

function checkSpaces(ctx: Context, rows: number, cols: number): void {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = getCell(ctx.sheet, r, c);
    if (cell?.f || typeof cell?.v !== 'string') continue;
    const cleaned = cell.v.replace(/\xa0/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
    if (cleaned && cleaned !== cell.v && !ERROR_VALUE.test(cell.v)) add(ctx, { kind: 'stray-space', range: a1Of(r, c), text: cell.v, message: `${a1Of(r, c)} 的文字首尾或中间有多余空格，查找、匹配和去重时会被当成不同的值`, fix: { value: cleaned } });
  }
}

/** Reported once per column and shape, not per row: a rate typed into a whole column is one decision. */
function checkFormulaStyle(ctx: Context, rows: number, cols: number): void {
  for (let c = 0; c < cols; c++) {
    const magic = new Map<string, { first: number; last: number; text: string; numbers: number[] }>();
    const wholeCol = new Map<string, { first: number; last: number; text: string }>();
    for (let r = 0; r < rows; r++) {
      const cell = getCell(ctx.sheet, r, c);
      if (!cell?.f) continue;
      const shape = formulaShape(cell.f, r, c);
      const numbers = constantsIn(cell.f).filter((n) => !NEUTRAL_CONSTANTS.has(n));
      if (numbers.length) { const hit = magic.get(shape); if (hit) hit.last = r; else magic.set(shape, { first: r, last: r, text: cell.f, numbers }); }
      if (/(?<![A-Za-z0-9_.])\$?[A-Z]{1,3}:\$?[A-Z]{1,3}(?![A-Za-z0-9_(])/.test(cell.f.split(PROTECTED).filter((_p, i) => i % 2 === 0).join(' '))) {
        const hit = wholeCol.get(shape); if (hit) hit.last = r; else wholeCol.set(shape, { first: r, last: r, text: cell.f });
      }
    }
    const span = (item: { first: number; last: number }) => (item.first === item.last ? a1Of(item.first, c) : `${a1Of(item.first, c)}:${a1Of(item.last, c)}`);
    for (const item of magic.values()) add(ctx, { kind: 'magic-number', range: span(item), text: item.text, message: `${span(item)} 的公式里直接写了 ${item.numbers.join('、')}，改动时容易漏；可以放进单独的单元格再引用` });
    for (const item of wholeCol.values()) add(ctx, { kind: 'whole-column-ref', range: span(item), text: item.text, message: `${span(item)} 的公式引用了整列，数据变多后会变慢，也容易把表头或汇总行算进去` });
  }
}

export function checkSheet(content: SheetArtifactContent, options: { sheet?: string; max?: number } = {}): SheetCheckResult {
  const max = options.max ?? 100;
  const sheets = options.sheet ? content.sheets.filter((s) => s.id === options.sheet || s.name === options.sheet) : content.sheets;
  const findings: SheetCheckFinding[] = [];
  let cells = 0; let formulas = 0;
  for (const sheet of sheets) {
    const { rows, cols } = usedRange(sheet);
    for (const row of Object.values(sheet.cells)) for (const cell of Object.values(row)) { if (!isBlank(cell)) cells++; if (cell.f) formulas++; }
    const ctx: Context = { sheet, findings };
    checkErrors(ctx, rows, cols);
    checkColumnRules(ctx, rows, cols);
    checkRangeGaps(ctx, rows, cols);
    checkTextNumbers(ctx, rows, cols);
    checkSpaces(ctx, rows, cols);
    checkFormulaStyle(ctx, rows, cols);
  }
  const rank = { error: 0, warning: 1, info: 2 } as const;
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const counts: SheetCheckResult['counts'] = {};
  for (const finding of findings) counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
  return { total: findings.length, counts, findings: findings.slice(0, max), scanned: { sheets: sheets.length, cells, formulas } };
}

/** What an edit newly breaks: findings the candidate has that the base did not (same kind, sheet and cell). */
export function newSheetFindings(base: SheetArtifactContent, candidate: SheetArtifactContent): SheetCheckFinding[] {
  const key = (f: SheetCheckFinding) => `${f.kind}|${f.sheetId}|${f.range}`;
  const before = new Set(checkSheet(base, { max: 10_000 }).findings.map(key));
  return checkSheet(candidate, { max: 10_000 }).findings.filter((f) => !before.has(key(f)) && f.severity !== 'info');
}
