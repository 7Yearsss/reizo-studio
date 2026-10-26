import { MAX_COLS, MAX_ROWS, workbookFromCreateSheets, type SheetArtifactContent, type SheetCellValue } from './sheetContent';

const NUMBER = /^-?\d+(?:\.\d+)?$/;

/** Cell text from a rendered table → a typed value: plain numbers become numbers, everything else stays text. */
export function tableCellValue(text: string): SheetCellValue {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  // Keep leading-zero ids ("007") and very long digit strings as text.
  if (NUMBER.test(trimmed) && !/^-?0\d/.test(trimmed) && trimmed.length <= 15) return Number(trimmed);
  return trimmed;
}

export function sheetFromTableRows(
  name: string,
  rows: string[][],
): { content: SheetArtifactContent } | { error: string } {
  if (rows.length === 0 || rows.every((row) => row.length === 0)) return { error: '表格为空' };
  if (rows.length > MAX_ROWS) return { error: `表格超过 ${MAX_ROWS} 行上限` };
  const width = Math.max(...rows.map((row) => row.length));
  if (width > MAX_COLS) return { error: `表格超过 ${MAX_COLS} 列上限` };
  const values = rows.map((row) => Array.from({ length: width }, (_, i) => tableCellValue(row[i] ?? '')));
  return workbookFromCreateSheets([{ name: name.trim().slice(0, 80) || 'Sheet1', values }]);
}
