/**
 * Compact workbook model for sheet artifacts.
 * AI-facing truth is sparse cells + formulas; Univer may also persist a snapshot
 * so user formatting survives a later patch.
 */

export const SHEET_MIME = 'application/vnd.reizo.sheet+json; charset=utf-8';

export const MAX_SHEETS = 8;
export const MAX_ROWS = 2_000;
export const MAX_COLS = 50;
export const MAX_OPERATIONS = 40;
export const MAX_CELL_CHARS = 2_000;
export const MAX_GRID_CELLS = 40_000;
export const MAX_OPERATION_ROWS = 200;
export const MAX_OPERATION_COLS = 40;

export type SheetCellValue = string | number | boolean | null;

export type SheetCell = {
  v?: SheetCellValue;
  f?: string;
};

export type SheetGrid = {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  cells: Record<string, Record<string, SheetCell>>;
};

export type SheetImportMeta = {
  sourceName: string;
  sourceRows?: number;
  sourceCols?: number;
  truncatedRows?: boolean;
  truncatedCols?: boolean;
  truncatedSheets?: boolean;
};

export type SheetArtifactContent = {
  revision: number;
  activeSheetId: string;
  sheets: SheetGrid[];
  /** Last Univer workbook.save() payload; optional visual restore. */
  univerSnapshot?: unknown;
  importMeta?: SheetImportMeta;
};

export type SheetCreateSheet = {
  name: string;
  values?: SheetCellValue[][];
  formulas?: Array<{ cell: string; formula: string }>;
};

export type SheetOperation =
  | {
      op: 'setValues';
      sheet?: string;
      start: string;
      values: SheetCellValue[][];
    }
  | {
      op: 'setFormulas';
      sheet?: string;
      start: string;
      formulas: string[][];
    }
  | { op: 'clearRange'; sheet?: string; range: string }
  | { op: 'addSheet'; name: string }
  | { op: 'renameSheet'; sheet: string; name: string }
  | { op: 'deleteSheet'; sheet: string };

export type A1Address = { row: number; col: number };

export function serializeSheetContent(content: SheetArtifactContent): string {
  return JSON.stringify(content);
}

export function parseSheetContent(raw: string): SheetArtifactContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return normalizeSheetContent(parsed);
}

export function normalizeSheetContent(value: unknown): SheetArtifactContent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<SheetArtifactContent>;
  if (!Array.isArray(raw.sheets) || raw.sheets.length === 0) return null;

  const sheets: SheetGrid[] = [];
  for (const sheet of raw.sheets) {
    const normalized = normalizeGrid(sheet);
    if (!normalized) return null;
    sheets.push(normalized);
  }
  if (sheets.length > MAX_SHEETS) return null;

  const ids = new Set(sheets.map((sheet) => sheet.id));
  if (ids.size !== sheets.length) return null;

  const activeSheetId =
    typeof raw.activeSheetId === 'string' && ids.has(raw.activeSheetId)
      ? raw.activeSheetId
      : sheets[0]!.id;
  const revision =
    typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision > 0
      ? raw.revision
      : 1;

  return {
    revision,
    activeSheetId,
    sheets,
    ...(raw.univerSnapshot === undefined ? {} : { univerSnapshot: raw.univerSnapshot }),
    ...(raw.importMeta ? { importMeta: raw.importMeta } : {}),
  };
}

function normalizeGrid(value: unknown): SheetGrid | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<SheetGrid>;
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const rowCount = clampCount(raw.rowCount, 1, MAX_ROWS, 100);
  const columnCount = clampCount(raw.columnCount, 1, MAX_COLS, 20);
  const cells: SheetGrid['cells'] = {};
  if (raw.cells && typeof raw.cells === 'object' && !Array.isArray(raw.cells)) {
    for (const [rowKey, row] of Object.entries(raw.cells)) {
      if (!/^\d+$/.test(rowKey) || !row || typeof row !== 'object' || Array.isArray(row)) {
        continue;
      }
      const rowIndex = Number(rowKey);
      if (rowIndex < 0 || rowIndex >= MAX_ROWS) continue;
      const nextRow: Record<string, SheetCell> = {};
      for (const [colKey, cell] of Object.entries(row)) {
        if (!/^\d+$/.test(colKey)) continue;
        const colIndex = Number(colKey);
        if (colIndex < 0 || colIndex >= MAX_COLS) continue;
        const normalized = normalizeCell(cell);
        if (normalized) nextRow[colKey] = normalized;
      }
      if (Object.keys(nextRow).length) cells[rowKey] = nextRow;
    }
  }
  return {
    id: raw.id.trim(),
    name: raw.name.trim().slice(0, 80),
    rowCount,
    columnCount,
    cells,
  };
}

function normalizeCell(value: unknown): SheetCell | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as SheetCell;
  const cell: SheetCell = {};
  if (raw.f !== undefined) {
    if (typeof raw.f !== 'string') return null;
    const formula = sanitizeFormula(raw.f);
    if (!formula) return null;
    cell.f = formula;
  }
  if (raw.v !== undefined) {
    const cellValue = sanitizeCellValue(raw.v);
    if (cellValue === undefined) return null;
    cell.v = cellValue;
  }
  return cell.f || cell.v !== undefined ? cell : null;
}

function clampCount(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function sanitizeCellValue(value: unknown): SheetCellValue | undefined {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_CELL_CHARS) return value.slice(0, MAX_CELL_CHARS);
    return value;
  }
  return undefined;
}

export function sanitizeFormula(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const formula = trimmed.startsWith('=') ? trimmed : `=${trimmed}`;
  if (formula.length > MAX_CELL_CHARS) return null;
  return formula;
}

export function colToLetters(col: number): string {
  let n = col + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function lettersToCol(letters: string): number | null {
  const token = letters.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(token)) return null;
  let col = 0;
  for (const ch of token) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return col - 1;
}

export function parseA1(ref: string): A1Address | null {
  const match = ref.trim().toUpperCase().match(/^([A-Z]{1,3})([1-9]\d{0,4})$/);
  if (!match) return null;
  const col = lettersToCol(match[1] ?? '');
  const row = Number(match[2]) - 1;
  if (col === null || row < 0 || row >= MAX_ROWS || col >= MAX_COLS) return null;
  return { row, col };
}

export function parseA1Range(range: string): { start: A1Address; end: A1Address } | null {
  const trimmed = range.trim().toUpperCase();
  const parts = trimmed.split(':');
  if (parts.length === 1) {
    const start = parseA1(parts[0] ?? '');
    return start ? { start, end: start } : null;
  }
  if (parts.length !== 2) return null;
  const start = parseA1(parts[0] ?? '');
  const end = parseA1(parts[1] ?? '');
  if (!start || !end) return null;
  return {
    start: {
      row: Math.min(start.row, end.row),
      col: Math.min(start.col, end.col),
    },
    end: {
      row: Math.max(start.row, end.row),
      col: Math.max(start.col, end.col),
    },
  };
}

export function a1Of(row: number, col: number): string {
  return `${colToLetters(col)}${row + 1}`;
}

export function emptyWorkbook(name = 'Sheet1'): SheetArtifactContent {
  const id = 'sheet-1';
  return {
    revision: 1,
    activeSheetId: id,
    sheets: [
      {
        id,
        name,
        rowCount: 100,
        columnCount: 20,
        cells: {},
      },
    ],
  };
}

export function workbookFromCreateSheets(
  sheets: SheetCreateSheet[],
): { content: SheetArtifactContent } | { error: string } {
  if (sheets.length === 0) return { error: 'At least one sheet is required' };
  if (sheets.length > MAX_SHEETS) return { error: `At most ${MAX_SHEETS} sheets` };

  const grids: SheetGrid[] = [];
  const usedNames = new Set<string>();
  for (const [index, sheet] of sheets.entries()) {
    const name = sheet.name.trim().slice(0, 80);
    if (!name) return { error: `sheets.${index}.name is required` };
    if (usedNames.has(name.toLowerCase())) {
      return { error: `Duplicate sheet name: ${name}` };
    }
    usedNames.add(name.toLowerCase());
    const grid: SheetGrid = {
      id: `sheet-${index + 1}`,
      name,
      rowCount: 100,
      columnCount: 20,
      cells: {},
    };
    if (sheet.values?.length) {
      const written = writeValues(grid, { row: 0, col: 0 }, sheet.values);
      if ('error' in written) return written;
    }
    if (sheet.formulas?.length) {
      for (const item of sheet.formulas) {
        const addr = parseA1(item.cell);
        if (!addr) return { error: `Invalid formula cell: ${item.cell}` };
        const formula = sanitizeFormula(item.formula);
        if (!formula) return { error: `Invalid formula at ${item.cell}` };
        writeCell(grid, addr.row, addr.col, { f: formula });
      }
    }
    grids.push(grid);
  }

  return {
    content: {
      revision: 1,
      activeSheetId: grids[0]!.id,
      sheets: grids,
    },
  };
}

export function applySheetOperations(
  content: SheetArtifactContent,
  operations: SheetOperation[],
): { content: SheetArtifactContent } | { error: string } {
  if (operations.length === 0) return { error: 'operations must not be empty' };
  if (operations.length > MAX_OPERATIONS) {
    return { error: `At most ${MAX_OPERATIONS} operations per call` };
  }

  let next: SheetArtifactContent = {
    ...content,
    sheets: content.sheets.map((sheet) => cloneGrid(sheet)),
    revision: content.revision + 1,
    ...(content.univerSnapshot !== undefined
      ? { univerSnapshot: cloneUniverSnapshot(content.univerSnapshot) }
      : {}),
  };

  for (const [index, operation] of operations.entries()) {
    const applied = applyOne(next, operation);
    if ('error' in applied) {
      return { error: `operations.${index}: ${applied.error}` };
    }
    next = applied.content;
  }

  return { content: next };
}

function applyOne(
  content: SheetArtifactContent,
  operation: SheetOperation,
): { content: SheetArtifactContent } | { error: string } {
  switch (operation.op) {
    case 'setValues': {
      const sheet = resolveSheet(content, operation.sheet);
      if (!sheet) return { error: `Unknown sheet: ${operation.sheet ?? '(active)'}` };
      const start = parseA1(operation.start);
      if (!start) return { error: `Invalid start: ${operation.start}` };
      if (!operation.values.length) return { error: 'values must not be empty' };
      const written = writeValues(sheet, start, operation.values);
      if ('error' in written) return written;
      mirrorValuesToSnapshot(content, sheet, start, operation.values);
      return { content };
    }
    case 'setFormulas': {
      const sheet = resolveSheet(content, operation.sheet);
      if (!sheet) return { error: `Unknown sheet: ${operation.sheet ?? '(active)'}` };
      const start = parseA1(operation.start);
      if (!start) return { error: `Invalid start: ${operation.start}` };
      if (!operation.formulas.length) return { error: 'formulas must not be empty' };
      const written = writeFormulas(sheet, start, operation.formulas);
      if ('error' in written) return written;
      mirrorFormulasToSnapshot(content, sheet, start, operation.formulas);
      return { content };
    }
    case 'clearRange': {
      const sheet = resolveSheet(content, operation.sheet);
      if (!sheet) return { error: `Unknown sheet: ${operation.sheet ?? '(active)'}` };
      const range = parseA1Range(operation.range);
      if (!range) return { error: `Invalid range: ${operation.range}` };
      clearRange(sheet, range.start, range.end);
      mirrorClearToSnapshot(content, sheet, range.start, range.end);
      return { content };
    }
    case 'addSheet': {
      const name = operation.name.trim().slice(0, 80);
      if (!name) return { error: 'Sheet name is required' };
      if (content.sheets.length >= MAX_SHEETS) {
        return { error: `At most ${MAX_SHEETS} sheets` };
      }
      if (content.sheets.some((sheet) => sheet.name.toLowerCase() === name.toLowerCase())) {
        return { error: `Duplicate sheet name: ${name}` };
      }
      const id = nextSheetId(content.sheets);
      content.sheets.push({
        id,
        name,
        rowCount: 100,
        columnCount: 20,
        cells: {},
      });
      const workbook = asUniverWorkbook(content.univerSnapshot);
      if (workbook) {
        workbook.sheets ??= {};
        workbook.sheets[id] = { id, name, rowCount: 100, columnCount: 20, cellData: {} };
        workbook.sheetOrder = [...(workbook.sheetOrder ?? []), id];
      }
      return { content };
    }
    case 'renameSheet': {
      const sheet = resolveSheet(content, operation.sheet);
      if (!sheet) return { error: `Unknown sheet: ${operation.sheet}` };
      const name = operation.name.trim().slice(0, 80);
      if (!name) return { error: 'Sheet name is required' };
      if (
        content.sheets.some(
          (item) => item.id !== sheet.id && item.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        return { error: `Duplicate sheet name: ${name}` };
      }
      sheet.name = name;
      const worksheet = asUniverWorkbook(content.univerSnapshot)?.sheets?.[sheet.id];
      if (worksheet) worksheet.name = name;
      return { content };
    }
    case 'deleteSheet': {
      if (content.sheets.length <= 1) return { error: 'Cannot delete the last sheet' };
      const sheet = resolveSheet(content, operation.sheet);
      if (!sheet) return { error: `Unknown sheet: ${operation.sheet}` };
      content.sheets = content.sheets.filter((item) => item.id !== sheet.id);
      if (content.activeSheetId === sheet.id) {
        content.activeSheetId = content.sheets[0]!.id;
      }
      const workbook = asUniverWorkbook(content.univerSnapshot);
      if (workbook?.sheets) {
        delete workbook.sheets[sheet.id];
        workbook.sheetOrder = (workbook.sheetOrder ?? []).filter((id) => id !== sheet.id);
      }
      return { content };
    }
  }
}

export function resolveSheet(
  content: SheetArtifactContent,
  sheet?: string,
): SheetGrid | undefined {
  if (!sheet) {
    return content.sheets.find((item) => item.id === content.activeSheetId) ?? content.sheets[0];
  }
  const needle = sheet.trim();
  return (
    content.sheets.find((item) => item.id === needle) ??
    content.sheets.find((item) => item.name.toLowerCase() === needle.toLowerCase())
  );
}

function nextSheetId(sheets: SheetGrid[]): string {
  let n = sheets.length + 1;
  const used = new Set(sheets.map((sheet) => sheet.id));
  while (used.has(`sheet-${n}`)) n += 1;
  return `sheet-${n}`;
}

function cloneGrid(sheet: SheetGrid): SheetGrid {
  const cells: SheetGrid['cells'] = {};
  for (const [rowKey, row] of Object.entries(sheet.cells)) {
    cells[rowKey] = { ...row };
  }
  return { ...sheet, cells };
}

function writeValues(
  sheet: SheetGrid,
  start: A1Address,
  values: SheetCellValue[][],
): { ok: true } | { error: string } {
  if (
    values.length > MAX_OPERATION_ROWS ||
    values.some((row) => row.length > MAX_OPERATION_COLS)
  ) {
    return { error: `values exceed ${MAX_OPERATION_ROWS}×${MAX_OPERATION_COLS}` };
  }
  for (let r = 0; r < values.length; r += 1) {
    const row = values[r] ?? [];
    for (let c = 0; c < row.length; c += 1) {
      const rowIndex = start.row + r;
      const colIndex = start.col + c;
      if (rowIndex >= MAX_ROWS || colIndex >= MAX_COLS) {
        return { error: `values overflow the ${MAX_ROWS}×${MAX_COLS} limit at ${a1Of(rowIndex, colIndex)}` };
      }
      const raw = row[c];
      if (typeof raw === 'string' && raw.trim().startsWith('=')) {
        const formula = sanitizeFormula(raw);
        if (!formula) return { error: `Invalid formula at ${a1Of(rowIndex, colIndex)}` };
        writeCell(sheet, rowIndex, colIndex, { f: formula });
      } else {
        const cellValue = sanitizeCellValue(raw ?? null);
        if (cellValue === undefined) {
          return { error: `Unsupported value at ${a1Of(rowIndex, colIndex)}` };
        }
        writeCell(sheet, rowIndex, colIndex, { v: cellValue });
      }
    }
  }
  return { ok: true };
}

function writeFormulas(
  sheet: SheetGrid,
  start: A1Address,
  formulas: string[][],
): { ok: true } | { error: string } {
  for (let r = 0; r < formulas.length; r += 1) {
    const row = formulas[r] ?? [];
    for (let c = 0; c < row.length; c += 1) {
      const rowIndex = start.row + r;
      const colIndex = start.col + c;
      if (rowIndex >= MAX_ROWS || colIndex >= MAX_COLS) {
        return { error: `formulas overflow at ${a1Of(rowIndex, colIndex)}` };
      }
      const formula = sanitizeFormula(row[c] ?? '');
      if (!formula) return { error: `Invalid formula at ${a1Of(rowIndex, colIndex)}` };
      const existing = getCell(sheet, rowIndex, colIndex);
      writeCell(sheet, rowIndex, colIndex, { v: existing?.v, f: formula });
    }
  }
  return { ok: true };
}

function clearRange(sheet: SheetGrid, start: A1Address, end: A1Address): void {
  for (let row = start.row; row <= end.row; row += 1) {
    const rowKey = String(row);
    const current = sheet.cells[rowKey];
    if (!current) continue;
    for (let col = start.col; col <= end.col; col += 1) {
      delete current[String(col)];
    }
    if (Object.keys(current).length === 0) delete sheet.cells[rowKey];
  }
}

function writeCell(sheet: SheetGrid, row: number, col: number, cell: SheetCell): void {
  sheet.rowCount = Math.max(sheet.rowCount, row + 1, 1);
  sheet.columnCount = Math.max(sheet.columnCount, col + 1, 1);
  const rowKey = String(row);
  const colKey = String(col);
  if (cell.v === null && !cell.f) {
    const existing = sheet.cells[rowKey];
    if (existing) {
      delete existing[colKey];
      if (Object.keys(existing).length === 0) delete sheet.cells[rowKey];
    }
    return;
  }
  sheet.cells[rowKey] ??= {};
  sheet.cells[rowKey]![colKey] = cell.f ? { f: cell.f, ...(cell.v !== undefined ? { v: cell.v } : {}) } : { v: cell.v };
}

export function getCell(sheet: SheetGrid, row: number, col: number): SheetCell | undefined {
  return sheet.cells[String(row)]?.[String(col)];
}

export function usedRange(sheet: SheetGrid): { rows: number; cols: number } {
  let maxRow = -1;
  let maxCol = -1;
  for (const [rowKey, row] of Object.entries(sheet.cells)) {
    const rowIndex = Number(rowKey);
    for (const colKey of Object.keys(row)) {
      maxRow = Math.max(maxRow, rowIndex);
      maxCol = Math.max(maxCol, Number(colKey));
    }
  }
  return { rows: maxRow + 1, cols: maxCol + 1 };
}

export function sheetToCsv(sheet: SheetGrid): string {
  const { rows, cols } = usedRange(sheet);
  if (rows <= 0 || cols <= 0) return '';
  const lines: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    const cells: string[] = [];
    for (let c = 0; c < cols; c += 1) {
      const cell = getCell(sheet, r, c);
      cells.push(csvEscape(cellDisplay(cell)));
    }
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}

function cellDisplay(cell: SheetCell | undefined): string {
  if (!cell) return '';
  if (cell.f) return cell.f;
  if (cell.v === null || cell.v === undefined) return '';
  return String(cell.v);
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

type UniverCell = { v?: unknown; t?: number; f?: string; s?: unknown };
type UniverWorksheet = {
  id?: string;
  name?: string;
  rowCount?: number;
  columnCount?: number;
  cellData?: Record<string, Record<string, UniverCell>>;
};
type UniverWorkbook = {
  id?: string;
  name?: string;
  sheetOrder?: string[];
  sheets?: Record<string, UniverWorksheet>;
};

function cloneUniverSnapshot(snapshot: unknown): unknown {
  if (snapshot === undefined) return undefined;
  return JSON.parse(JSON.stringify(snapshot)) as unknown;
}

function asUniverWorkbook(snapshot: unknown): UniverWorkbook | undefined {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return undefined;
  return snapshot as UniverWorkbook;
}

function patchUniverCell(
  worksheet: UniverWorksheet,
  row: number,
  col: number,
  cell: SheetCell | undefined,
): void {
  worksheet.cellData ??= {};
  const rowKey = String(row);
  const colKey = String(col);
  const preservedStyle = worksheet.cellData[rowKey]?.[colKey]?.s;

  if (!cell) {
    if (preservedStyle === undefined) {
      const cellRow = worksheet.cellData[rowKey];
      if (cellRow) {
        delete cellRow[colKey];
        if (Object.keys(cellRow).length === 0) delete worksheet.cellData[rowKey];
      }
    } else {
      worksheet.cellData[rowKey] ??= {};
      worksheet.cellData[rowKey]![colKey] = { s: preservedStyle };
    }
    return;
  }

  const next: UniverCell = {};
  if (cell.f) next.f = cell.f;
  if (cell.v !== undefined) {
    next.v = cell.v;
    next.t = typeof cell.v === 'number' ? 2 : typeof cell.v === 'boolean' ? 3 : 1;
  }
  if (preservedStyle !== undefined) next.s = preservedStyle;
  worksheet.cellData[rowKey] ??= {};
  worksheet.cellData[rowKey]![colKey] = next;
}

function mirrorValuesToSnapshot(
  content: SheetArtifactContent,
  sheet: SheetGrid,
  start: A1Address,
  values: SheetCellValue[][],
): void {
  const worksheet = asUniverWorkbook(content.univerSnapshot)?.sheets?.[sheet.id];
  if (!worksheet) return;
  for (let r = 0; r < values.length; r += 1) {
    const row = values[r] ?? [];
    for (let c = 0; c < row.length; c += 1) {
      const rowIndex = start.row + r;
      const colIndex = start.col + c;
      patchUniverCell(worksheet, rowIndex, colIndex, getCell(sheet, rowIndex, colIndex));
    }
  }
}

function mirrorFormulasToSnapshot(
  content: SheetArtifactContent,
  sheet: SheetGrid,
  start: A1Address,
  formulas: string[][],
): void {
  const worksheet = asUniverWorkbook(content.univerSnapshot)?.sheets?.[sheet.id];
  if (!worksheet) return;
  for (let r = 0; r < formulas.length; r += 1) {
    const row = formulas[r] ?? [];
    for (let c = 0; c < row.length; c += 1) {
      const rowIndex = start.row + r;
      const colIndex = start.col + c;
      patchUniverCell(worksheet, rowIndex, colIndex, getCell(sheet, rowIndex, colIndex));
    }
  }
}

function mirrorClearToSnapshot(
  content: SheetArtifactContent,
  sheet: SheetGrid,
  start: A1Address,
  end: A1Address,
): void {
  const worksheet = asUniverWorkbook(content.univerSnapshot)?.sheets?.[sheet.id];
  if (!worksheet) return;
  for (let row = start.row; row <= end.row; row += 1) {
    for (let col = start.col; col <= end.col; col += 1) {
      patchUniverCell(worksheet, row, col, undefined);
    }
  }
}

export function compactToUniverSnapshot(
  content: SheetArtifactContent,
  workbookName: string,
): Record<string, unknown> {
  const sheets: Record<string, UniverWorksheet> = {};
  for (const sheet of content.sheets) {
    const cellData: Record<string, Record<string, UniverCell>> = {};
    for (const [rowKey, row] of Object.entries(sheet.cells)) {
      const nextRow: Record<string, UniverCell> = {};
      for (const [colKey, cell] of Object.entries(row)) {
        nextRow[colKey] = toUniverCell(cell);
      }
      cellData[rowKey] = nextRow;
    }
    sheets[sheet.id] = {
      id: sheet.id,
      name: sheet.name,
      rowCount: Math.max(sheet.rowCount, 40),
      columnCount: Math.max(sheet.columnCount, 12),
      cellData,
    };
  }
  return {
    id: 'workbook',
    name: workbookName,
    sheetOrder: content.sheets.map((sheet) => sheet.id),
    sheets,
  };
}

function toUniverCell(cell: SheetCell): UniverCell {
  const out: UniverCell = {};
  if (cell.f) out.f = cell.f;
  if (cell.v !== undefined && cell.v !== null) {
    out.v = cell.v;
    if (typeof cell.v === 'number') out.t = 2;
    else if (typeof cell.v === 'boolean') out.t = 3;
    else out.t = 1;
  }
  return out;
}

export function univerSnapshotToCompact(
  snapshot: unknown,
  fallback: SheetArtifactContent,
): SheetArtifactContent {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return fallback;
  }
  const workbook = snapshot as UniverWorkbook;
  const sheetsMap = workbook.sheets;
  if (!sheetsMap || typeof sheetsMap !== 'object') return fallback;

  const order =
    Array.isArray(workbook.sheetOrder) && workbook.sheetOrder.length
      ? workbook.sheetOrder.filter((id) => typeof id === 'string' && sheetsMap[id])
      : Object.keys(sheetsMap);
  if (!order.length) return fallback;

  const sheets: SheetGrid[] = [];
  for (const id of order) {
    const raw = sheetsMap[id];
    if (!raw) continue;
    const grid: SheetGrid = {
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id,
      rowCount: clampCount(raw.rowCount, 1, MAX_ROWS, 100),
      columnCount: clampCount(raw.columnCount, 1, MAX_COLS, 20),
      cells: {},
    };
    const cellData = raw.cellData;
    if (cellData && typeof cellData === 'object') {
      for (const [rowKey, row] of Object.entries(cellData)) {
        if (!row || typeof row !== 'object') continue;
        const rowIndex = Number(rowKey);
        if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= MAX_ROWS) continue;
        for (const [colKey, cell] of Object.entries(row)) {
          const colIndex = Number(colKey);
          if (!Number.isInteger(colIndex) || colIndex < 0 || colIndex >= MAX_COLS) continue;
          const mapped = fromUniverCell(cell);
          if (mapped) writeCell(grid, rowIndex, colIndex, mapped);
        }
      }
    }
    sheets.push(grid);
    if (sheets.length >= MAX_SHEETS) break;
  }
  if (!sheets.length) return fallback;

  const active =
    sheets.find((sheet) => sheet.id === fallback.activeSheetId)?.id ?? sheets[0]!.id;
  return {
    revision: fallback.revision,
    activeSheetId: active,
    sheets,
    univerSnapshot: snapshot,
    ...(fallback.importMeta ? { importMeta: fallback.importMeta } : {}),
  };
}

function fromUniverCell(cell: UniverCell | undefined): SheetCell | null {
  if (!cell || typeof cell !== 'object') return null;
  const next: SheetCell = {};
  if (typeof cell.f === 'string' && cell.f.trim()) {
    const formula = sanitizeFormula(cell.f);
    if (formula) next.f = formula;
  }
  if (cell.v !== undefined) {
    const value = sanitizeCellValue(cell.v);
    if (value !== undefined) next.v = value;
  }
  return next.f || next.v !== undefined ? next : null;
}

export function replaceUniverSnapshot(
  content: SheetArtifactContent,
  snapshot: unknown,
): SheetArtifactContent {
  const compact = univerSnapshotToCompact(snapshot, content);
  return {
    ...compact,
    revision: content.revision,
    univerSnapshot: snapshot,
  };
}
