import {
  a1Of,
  getCell,
  parseA1,
  parseA1Range,
  resolveSheet,
  type SheetArtifactContent,
  type SheetCellValue,
  type SheetGrid,
} from './sheetContent';

/**
 * Lightweight, cycle-safe spreadsheet formula evaluator used when exporting `.xlsx`
 * (or inspecting sheets headlessly) so formula cells carry cached `result` values.
 * Without cached values, `data_only` readers (openpyxl, pandas, previewers) see
 * formula cells as empty until Excel opens and re-saves the file.
 */

export function evaluateWorkbookFormulas(
  content: SheetArtifactContent,
): Map<string, SheetCellValue> {
  const results = new Map<string, SheetCellValue>();
  const visiting = new Set<string>();

  const evalCell = (sheet: SheetGrid, row: number, col: number): SheetCellValue => {
    const key = `${sheet.id}!${a1Of(row, col)}`;
    if (results.has(key)) return results.get(key)!;
    const cell = getCell(sheet, row, col);
    if (!cell) return null;
    if (!cell.f) {
      const val = cell.v ?? null;
      results.set(key, val);
      return val;
    }
    if (cell.v !== undefined && cell.v !== null) {
      results.set(key, cell.v);
      return cell.v;
    }
    if (visiting.has(key)) {
      return '#CYCLE!';
    }
    visiting.add(key);
    try {
      const computed = evaluateFormulaExpression(
        cell.f.replace(/^=/, '').trim(),
        content,
        sheet,
        evalCell,
      );
      if (computed !== undefined && computed !== null) {
        results.set(key, computed);
      }
      return computed ?? null;
    } finally {
      visiting.delete(key);
    }
  };

  for (const sheet of content.sheets) {
    for (const [rKey, row] of Object.entries(sheet.cells)) {
      const r = Number(rKey);
      if (!Number.isInteger(r)) continue;
      for (const [cKey, cell] of Object.entries(row)) {
        const c = Number(cKey);
        if (!Number.isInteger(c) || !cell.f) continue;
        evalCell(sheet, r, c);
      }
    }
  }

  return results;
}

type CellGetter = (sheet: SheetGrid, row: number, col: number) => SheetCellValue;

function stripDollar(ref: string): string {
  return ref.replace(/\$/g, '');
}

function splitSheetPrefix(
  raw: string,
  content: SheetArtifactContent,
  currentSheet: SheetGrid,
): { sheet: SheetGrid; ref: string } | null {
  const bang = raw.lastIndexOf('!');
  if (bang < 0) return { sheet: currentSheet, ref: stripDollar(raw) };
  let sheetPart = raw.slice(0, bang).trim();
  if (sheetPart.startsWith("'") && sheetPart.endsWith("'")) {
    sheetPart = sheetPart.slice(1, -1).replace(/''/g, "'");
  }
  const target = resolveSheet(content, sheetPart);
  if (!target) return null;
  return { sheet: target, ref: stripDollar(raw.slice(bang + 1).trim()) };
}

function resolveRangeValues(
  raw: string,
  content: SheetArtifactContent,
  currentSheet: SheetGrid,
  getVal: CellGetter,
): SheetCellValue[] | null {
  const resolved = splitSheetPrefix(raw, content, currentSheet);
  if (!resolved) return null;
  const range = parseA1Range(resolved.ref);
  if (!range) return null;
  const out: SheetCellValue[] = [];
  for (let r = range.start.row; r <= range.end.row; r += 1) {
    for (let c = range.start.col; c <= range.end.col; c += 1) {
      out.push(getVal(resolved.sheet, r, c));
    }
  }
  return out;
}

function resolveSingleRef(
  raw: string,
  content: SheetArtifactContent,
  currentSheet: SheetGrid,
  getVal: CellGetter,
): SheetCellValue | undefined {
  const resolved = splitSheetPrefix(raw, content, currentSheet);
  if (!resolved) return undefined;
  const addr = parseA1(resolved.ref);
  if (!addr) return undefined;
  return getVal(resolved.sheet, addr.row, addr.col);
}

/** Split top-level comma-separated function arguments, respecting quotes and nested parens. */
function splitArgs(inner: string): string[] {
  const args: string[] = [];
  let cur = '';
  let depth = 0;
  let inQuotes = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;
    if (ch === '"') {
      if (inQuotes && inner[i + 1] === '"') {
        cur += '""';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (!inQuotes) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) {
        args.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim() || args.length > 0) args.push(cur.trim());
  return args;
}

function asNumber(val: SheetCellValue | undefined): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'string' && val.trim() !== '') {
    const n = Number(val.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function matchesCriterion(cellVal: SheetCellValue, criterionRaw: SheetCellValue): boolean {
  if (criterionRaw === null || criterionRaw === undefined) {
    return cellVal === null || cellVal === undefined || cellVal === '';
  }
  if (typeof criterionRaw === 'number' || typeof criterionRaw === 'boolean') {
    return cellVal === criterionRaw || String(cellVal) === String(criterionRaw);
  }
  const crit = String(criterionRaw);
  if (crit === '<>') {
    return cellVal !== null && cellVal !== undefined && cellVal !== '';
  }
  if (crit === '') {
    return cellVal === null || cellVal === undefined || cellVal === '';
  }
  const opMatch = crit.match(/^(<=|>=|<>|<|>|=)(.*)$/);
  if (opMatch) {
    const op = opMatch[1]!;
    const rhs = opMatch[2]!;
    if (op === '=') {
      const unescaped = rhs.replace(/~([~*?])/g, '$1');
      if (rhs === '') return cellVal === null || cellVal === undefined || cellVal === '';
      const nL = asNumber(cellVal);
      const nR = Number(unescaped);
      if (nL !== null && unescaped.trim() !== '' && Number.isFinite(nR)) return nL === nR;
      return String(cellVal ?? '').trim().toLowerCase() === unescaped.trim().toLowerCase();
    }
    if (op === '<>') {
      if (rhs === '') return cellVal !== null && cellVal !== undefined && cellVal !== '';
      return String(cellVal ?? '').trim().toLowerCase() !== rhs.trim().toLowerCase();
    }
    const nL = asNumber(cellVal);
    const nR = Number(rhs);
    if (nL === null || !Number.isFinite(nR)) return false;
    if (op === '<') return nL < nR;
    if (op === '<=') return nL <= nR;
    if (op === '>') return nL > nR;
    if (op === '>=') return nL >= nR;
  }
  const nL = asNumber(cellVal);
  const nR = Number(crit);
  if (nL !== null && crit.trim() !== '' && Number.isFinite(nR)) return nL === nR;
  return String(cellVal ?? '').trim().toLowerCase() === crit.trim().toLowerCase();
}

function evalFunction(
  fnName: string,
  rawArgs: string[],
  content: SheetArtifactContent,
  currentSheet: SheetGrid,
  getVal: CellGetter,
): SheetCellValue {
  const name = fnName.toUpperCase();

  const collectNumbers = (): number[] => {
    const nums: number[] = [];
    for (const arg of rawArgs) {
      const rangeVals = resolveRangeValues(arg, content, currentSheet, getVal);
      if (rangeVals) {
        for (const v of rangeVals) {
          if (typeof v === 'number' && Number.isFinite(v)) nums.push(v);
        }
      } else {
        const val = evaluateFormulaExpression(arg, content, currentSheet, getVal);
        const n = asNumber(val);
        if (n !== null) nums.push(n);
      }
    }
    return nums;
  };

  switch (name) {
    case 'SUM': {
      return collectNumbers().reduce((a, b) => a + b, 0);
    }
    case 'AVERAGE': {
      const nums = collectNumbers();
      return nums.length === 0 ? '#DIV/0!' : nums.reduce((a, b) => a + b, 0) / nums.length;
    }
    case 'MIN': {
      const nums = collectNumbers();
      return nums.length === 0 ? 0 : Math.min(...nums);
    }
    case 'MAX': {
      const nums = collectNumbers();
      return nums.length === 0 ? 0 : Math.max(...nums);
    }
    case 'COUNT': {
      return collectNumbers().length;
    }
    case 'COUNTA': {
      let count = 0;
      for (const arg of rawArgs) {
        const rangeVals = resolveRangeValues(arg, content, currentSheet, getVal);
        if (rangeVals) {
          for (const v of rangeVals) {
            if (v !== null && v !== undefined && v !== '') count += 1;
          }
        } else {
          const val = evaluateFormulaExpression(arg, content, currentSheet, getVal);
          if (val !== null && val !== undefined && val !== '') count += 1;
        }
      }
      return count;
    }
    case 'ABS': {
      const n = asNumber(evaluateFormulaExpression(rawArgs[0] ?? '0', content, currentSheet, getVal));
      return n === null ? '#VALUE!' : Math.abs(n);
    }
    case 'ROUND': {
      const n = asNumber(evaluateFormulaExpression(rawArgs[0] ?? '0', content, currentSheet, getVal));
      const digits = asNumber(evaluateFormulaExpression(rawArgs[1] ?? '0', content, currentSheet, getVal)) ?? 0;
      if (n === null) return '#VALUE!';
      const factor = 10 ** Math.round(digits);
      return Math.round(n * factor) / factor;
    }
    case 'IF': {
      const cond = evaluateFormulaExpression(rawArgs[0] ?? '', content, currentSheet, getVal);
      const truthy = Boolean(cond && cond !== 0 && cond !== 'FALSE');
      const branch = truthy ? (rawArgs[1] ?? 'TRUE') : (rawArgs[2] ?? 'FALSE');
      return evaluateFormulaExpression(branch, content, currentSheet, getVal);
    }
    case 'IFERROR': {
      const primary = evaluateFormulaExpression(rawArgs[0] ?? '', content, currentSheet, getVal);
      if (typeof primary === 'string' && primary.startsWith('#')) {
        return evaluateFormulaExpression(rawArgs[1] ?? '""', content, currentSheet, getVal);
      }
      return primary;
    }
    case 'COUNTIF':
    case 'COUNTIFS': {
      if (rawArgs.length < 2 || rawArgs.length % 2 !== 0) return '#VALUE!';
      const pairs: Array<{ vals: SheetCellValue[]; crit: SheetCellValue }> = [];
      for (let i = 0; i < rawArgs.length; i += 2) {
        const vals = resolveRangeValues(rawArgs[i]!, content, currentSheet, getVal);
        if (!vals) return '#VALUE!';
        const crit = evaluateFormulaExpression(rawArgs[i + 1]!, content, currentSheet, getVal);
        pairs.push({ vals, crit });
      }
      const len = pairs[0]!.vals.length;
      let count = 0;
      for (let idx = 0; idx < len; idx += 1) {
        if (pairs.every((p) => matchesCriterion(p.vals[idx] ?? null, p.crit))) count += 1;
      }
      return count;
    }
    case 'SUMIF': {
      const rangeVals = resolveRangeValues(rawArgs[0] ?? '', content, currentSheet, getVal);
      if (!rangeVals) return '#VALUE!';
      const crit = evaluateFormulaExpression(rawArgs[1] ?? '', content, currentSheet, getVal);
      const sumVals = rawArgs[2]
        ? resolveRangeValues(rawArgs[2], content, currentSheet, getVal)
        : rangeVals;
      if (!sumVals) return '#VALUE!';
      let total = 0;
      for (let i = 0; i < rangeVals.length; i += 1) {
        if (matchesCriterion(rangeVals[i] ?? null, crit)) {
          const v = sumVals[i];
          if (typeof v === 'number' && Number.isFinite(v)) total += v;
        }
      }
      return total;
    }
    case 'SUMIFS':
    case 'AVERAGEIFS':
    case 'MINIFS':
    case 'MAXIFS': {
      if (rawArgs.length < 3 || rawArgs.length % 2 === 0) return '#VALUE!';
      const targetVals = resolveRangeValues(rawArgs[0]!, content, currentSheet, getVal);
      if (!targetVals) return '#VALUE!';
      const pairs: Array<{ vals: SheetCellValue[]; crit: SheetCellValue }> = [];
      for (let i = 1; i < rawArgs.length; i += 2) {
        const vals = resolveRangeValues(rawArgs[i]!, content, currentSheet, getVal);
        if (!vals) return '#VALUE!';
        const crit = evaluateFormulaExpression(rawArgs[i + 1]!, content, currentSheet, getVal);
        pairs.push({ vals, crit });
      }
      const matched: number[] = [];
      for (let idx = 0; idx < targetVals.length; idx += 1) {
        if (pairs.every((p) => matchesCriterion(p.vals[idx] ?? null, p.crit))) {
          const v = targetVals[idx];
          if (typeof v === 'number' && Number.isFinite(v)) matched.push(v);
        }
      }
      if (name === 'SUMIFS') return matched.reduce((a, b) => a + b, 0);
      if (name === 'AVERAGEIFS') {
        return matched.length === 0 ? '#DIV/0!' : matched.reduce((a, b) => a + b, 0) / matched.length;
      }
      if (name === 'MINIFS') return matched.length === 0 ? 0 : Math.min(...matched);
      return matched.length === 0 ? 0 : Math.max(...matched);
    }
    default:
      return null;
  }
}

export function evaluateFormulaExpression(
  expr: string,
  content: SheetArtifactContent,
  currentSheet: SheetGrid,
  getVal: CellGetter,
): SheetCellValue {
  const trimmed = expr.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && !trimmed.slice(1, -1).includes('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  if (/^[-+]?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);

  // Top-level comparison (=, <>, <=, >=, <, >) outside quotes/parens.
  const cmp = findTopLevelOperator(trimmed, ['<>', '<=', '>=', '=', '<', '>']);
  if (cmp) {
    const left = evaluateFormulaExpression(trimmed.slice(0, cmp.index), content, currentSheet, getVal);
    const right = evaluateFormulaExpression(
      trimmed.slice(cmp.index + cmp.op.length),
      content,
      currentSheet,
      getVal,
    );
    const nL = asNumber(left);
    const nR = asNumber(right);
    if (cmp.op === '=') return nL !== null && nR !== null ? nL === nR : String(left ?? '') === String(right ?? '');
    if (cmp.op === '<>') return nL !== null && nR !== null ? nL !== nR : String(left ?? '') !== String(right ?? '');
    if (nL === null || nR === null) return false;
    if (cmp.op === '<') return nL < nR;
    if (cmp.op === '<=') return nL <= nR;
    if (cmp.op === '>') return nL > nR;
    if (cmp.op === '>=') return nL >= nR;
  }

  // Addition / subtraction at top level (right-to-left scan for left associativity).
  const addSub = findTopLevelAddSub(trimmed);
  if (addSub) {
    const left =
      addSub.index === 0
        ? 0
        : asNumber(evaluateFormulaExpression(trimmed.slice(0, addSub.index), content, currentSheet, getVal));
    const right = asNumber(
      evaluateFormulaExpression(trimmed.slice(addSub.index + 1), content, currentSheet, getVal),
    );
    if (left === null || right === null) return '#VALUE!';
    return addSub.op === '+' ? left + right : left - right;
  }

  // Multiplication / division at top level.
  const mulDiv = findTopLevelMulDiv(trimmed);
  if (mulDiv) {
    const left = asNumber(
      evaluateFormulaExpression(trimmed.slice(0, mulDiv.index), content, currentSheet, getVal),
    );
    const right = asNumber(
      evaluateFormulaExpression(trimmed.slice(mulDiv.index + 1), content, currentSheet, getVal),
    );
    if (left === null || right === null) return '#VALUE!';
    if (mulDiv.op === '/') return right === 0 ? '#DIV/0!' : left / right;
    return left * right;
  }

  // Outer parentheses.
  if (trimmed.startsWith('(') && trimmed.endsWith(')') && isWrappedInSingleParens(trimmed)) {
    return evaluateFormulaExpression(trimmed.slice(1, -1), content, currentSheet, getVal);
  }

  // Function call: NAME(...)
  const fnMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_.]*)\(([\s\S]*)\)$/);
  if (fnMatch && isWrappedInSingleParens(trimmed.slice(fnMatch[1]!.length))) {
    const args = splitArgs(fnMatch[2]!);
    return evalFunction(fnMatch[1]!, args, content, currentSheet, getVal);
  }

  // Single cell reference (with optional sheet prefix).
  const refVal = resolveSingleRef(trimmed, content, currentSheet, getVal);
  if (refVal !== undefined) return refVal ?? 0;

  return null;
}

function isWrappedInSingleParens(s: string): boolean {
  if (!s.startsWith('(') || !s.endsWith(')')) return false;
  let depth = 0;
  let inQuotes = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (ch === '"') inQuotes = !inQuotes;
    if (inQuotes) continue;
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0 && i < s.length - 1) return false;
    }
  }
  return depth === 0;
}

function findTopLevelOperator(
  s: string,
  ops: string[],
): { index: number; op: string } | null {
  let depth = 0;
  let inQuotes = false;
  let inSingleQuotes = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (ch === '"' && !inSingleQuotes) inQuotes = !inQuotes;
    else if (ch === "'" && !inQuotes) inSingleQuotes = !inSingleQuotes;
    if (inQuotes || inSingleQuotes) continue;
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      for (const op of ops) {
        if (s.startsWith(op, i)) return { index: i, op };
      }
    }
  }
  return null;
}

function findTopLevelAddSub(s: string): { index: number; op: '+' | '-' } | null {
  let depth = 0;
  let inQuotes = false;
  let inSingleQuotes = false;
  let found: { index: number; op: '+' | '-' } | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (ch === '"' && !inSingleQuotes) inQuotes = !inQuotes;
    else if (ch === "'" && !inQuotes) inSingleQuotes = !inSingleQuotes;
    if (inQuotes || inSingleQuotes) continue;
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === '+' || ch === '-')) {
      const prev = s.slice(0, i).trimEnd().slice(-1);
      if (i > 0 && (prev === '*' || prev === '/' || prev === '(' || prev === ',' || prev === '=')) {
        continue;
      }
      found = { index: i, op: ch };
    }
  }
  return found;
}

function findTopLevelMulDiv(s: string): { index: number; op: '*' | '/' } | null {
  let depth = 0;
  let inQuotes = false;
  let inSingleQuotes = false;
  let found: { index: number; op: '*' | '/' } | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (ch === '"' && !inSingleQuotes) inQuotes = !inQuotes;
    else if (ch === "'" && !inQuotes) inSingleQuotes = !inSingleQuotes;
    if (inQuotes || inSingleQuotes) continue;
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === '*' || ch === '/')) {
      found = { index: i, op: ch };
    }
  }
  return found;
}
