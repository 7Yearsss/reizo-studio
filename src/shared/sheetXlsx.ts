import ExcelJS from "exceljs";
import { addNativeCharts } from "./sheetXlsxCharts";
import { evaluateWorkbookFormulas } from "./sheetFormulaEval";
import {
  MAX_COLS,
  MAX_GRID_CELLS,
  MAX_ROWS,
  MAX_SHEETS,
  a1Of,
  emptyGrid,
  parseA1Range,
  putSheetCell,
  sanitizeFormula,
  type SheetArtifactContent,
  type SheetCell,
  type SheetCellValue,
  type SheetGrid,
  type SheetImportMeta,
} from "./sheetContent";

export {
  MAX_SHEET_UPLOAD_BYTES,
  isLegacyXlsFile,
  isSpreadsheetFile,
  workbookTitleFromFileName,
} from "./sheetFile";

export async function parseXlsxToSheetContent(
  bytes: Uint8Array,
  sourceName: string,
): Promise<{ content: SheetArtifactContent } | { error: string }> {
  const workbook = new ExcelJS.Workbook();
  try {
    const load = workbook.xlsx.load.bind(workbook.xlsx) as unknown as (
      data: Uint8Array,
    ) => Promise<ExcelJS.Workbook>;
    await load(bytes);
  } catch {
    return { error: "无法解析该 Excel 文件。请确认它是未加密的 .xlsx" };
  }

  const worksheets = workbook.worksheets.filter((sheet) => sheet && sheet.state !== "veryHidden");
  if (!worksheets.length) return { error: "工作簿里没有可导入的工作表" };

  const grids: SheetGrid[] = [];
  const univerSheets: Record<string, unknown> = {};
  const styles: Record<string, UniverStyle> = {};
  const styleIdByKey = new Map<string, string>();
  let styleSeq = 0;
  const styleIdFor = (style: UniverStyle | null): string | undefined => {
    if (!style) return undefined;
    const key = JSON.stringify(style);
    let id = styleIdByKey.get(key);
    if (!id) {
      id = `s${++styleSeq}`;
      styleIdByKey.set(key, id);
      styles[id] = style;
    }
    return id;
  };

  const truncatedSheets = worksheets.length > MAX_SHEETS;
  let truncatedRows = false;
  let truncatedCols = false;
  let sourceRows = 0;
  let sourceCols = 0;
  let cellCount = 0;
  let hitCellCap = false;
  let snapshotCellBudget = MAX_GRID_CELLS;

  for (const worksheet of worksheets.slice(0, MAX_SHEETS)) {
    const name = (worksheet.name || `Sheet${grids.length + 1}`).trim().slice(0, 80);
    const grid = emptyGrid(`sheet-${grids.length + 1}`, name || `Sheet${grids.length + 1}`);
    const dim = worksheet.dimensions;
    const maxRow = dim?.bottom ?? worksheet.rowCount ?? 0;
    const maxCol = dim?.right ?? worksheet.columnCount ?? 0;
    sourceRows = Math.max(sourceRows, maxRow);
    sourceCols = Math.max(sourceCols, maxCol);
    if (maxRow > MAX_ROWS) truncatedRows = true;
    if (maxCol > MAX_COLS) truncatedCols = true;

    const cellData: Record<string, Record<string, UniverSnapshotCell>> = {};

    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (rowNumber > MAX_ROWS) return;
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber > MAX_COLS) return;

        let mapped: SheetCell | null = null;
        if (!hitCellCap) {
          const candidate = cell.isMerged && cell.master.address !== cell.address ? null : mapExcelCell(cell);
          if (candidate) {
            if (cellCount >= MAX_GRID_CELLS) {
              hitCellCap = true;
              truncatedRows = true;
            } else {
              putSheetCell(grid, rowNumber - 1, colNumber - 1, candidate);
              cellCount += 1;
              mapped = candidate;
            }
          }
        }

        if (snapshotCellBudget <= 0) return;
        const styleId = styleIdFor(cellStyleFromExcel(cell));
        const snapshotCell = buildUniverCell(mapped, styleId);
        if (!snapshotCell) return;
        snapshotCellBudget -= 1;
        const rowKey = String(rowNumber - 1);
        const colKey = String(colNumber - 1);
        cellData[rowKey] ??= {};
        cellData[rowKey]![colKey] = snapshotCell;
      });
    });

    grids.push(grid);

    const mergeData: Array<{
      startRow: number;
      endRow: number;
      startColumn: number;
      endColumn: number;
    }> = [];
    for (const range of worksheet.model?.merges ?? []) {
      const parsed = parseA1Range(range);
      if (!parsed) continue;
      if (parsed.start.row >= MAX_ROWS || parsed.start.col >= MAX_COLS) continue;
      mergeData.push({
        startRow: parsed.start.row,
        endRow: Math.min(parsed.end.row, MAX_ROWS - 1),
        startColumn: parsed.start.col,
        endColumn: Math.min(parsed.end.col, MAX_COLS - 1),
      });
    }

    const columnData: Record<string, { w: number }> = {};
    worksheet.columns?.forEach((column, colIndex) => {
      if (colIndex >= MAX_COLS) return;
      const width = column?.width;
      if (typeof width === "number" && width > 0) {
        // Excel stores column width in characters; Univer wants pixels.
        columnData[String(colIndex)] = { w: Math.round(width * 7 + 5) };
      }
    });

    const rowData: Record<string, { h: number }> = {};
    const rowLimit = Math.min(maxRow, MAX_ROWS);
    for (let r = 1; r <= rowLimit; r += 1) {
      const height = worksheet.getRow(r).height;
      if (typeof height === "number" && height > 0) {
        // Excel stores row height in points; Univer wants pixels (96/72 dpi).
        rowData[String(r - 1)] = { h: Math.round((height * 4) / 3) };
      }
    }

    univerSheets[grid.id] = {
      id: grid.id,
      name: grid.name,
      rowCount: Math.max(grid.rowCount, 40),
      columnCount: Math.max(grid.columnCount, 12),
      cellData,
      ...(mergeData.length ? { mergeData } : {}),
      ...(Object.keys(columnData).length ? { columnData } : {}),
      ...(Object.keys(rowData).length ? { rowData } : {}),
    };
  }

  if (!grids.length) return { error: "工作簿没有可读取的单元格" };

  const importMeta: SheetImportMeta = {
    sourceName: sourceName.trim().slice(0, 200) || "workbook.xlsx",
    sourceRows,
    sourceCols,
    ...(truncatedRows ? { truncatedRows: true } : {}),
    ...(truncatedCols ? { truncatedCols: true } : {}),
    ...(truncatedSheets ? { truncatedSheets: true } : {}),
  };

  const univerSnapshot = {
    id: "workbook",
    name: importMeta.sourceName.replace(/\.xlsx$/i, "").slice(0, 80) || "workbook",
    sheetOrder: grids.map((sheet) => sheet.id),
    sheets: univerSheets,
    styles,
  };

  return {
    content: {
      revision: 1,
      activeSheetId: grids[0]!.id,
      sheets: grids,
      univerSnapshot,
      importMeta,
    },
  };
}

function mapExcelCell(cell: ExcelJS.Cell): SheetCell | null {
  const formula = extractFormula(cell);
  const value = extractValue(cell);
  if (!formula && value === undefined) return null;
  const mapped: SheetCell = {};
  if (formula) mapped.f = formula;
  if (value !== undefined) mapped.v = value;
  return mapped;
}

function extractFormula(cell: ExcelJS.Cell): string | null {
  const raw = cell.formula || (typeof cell.value === "object" && cell.value && "formula" in cell.value
    ? String((cell.value as { formula?: unknown }).formula ?? "")
    : "");
  if (!raw) return null;
  return sanitizeFormula(raw);
}

function extractValue(cell: ExcelJS.Cell): SheetCellValue | undefined {
  const value = cell.value;
  if (value === null || value === undefined) {
    if (cell.result !== undefined && cell.result !== null && typeof cell.result !== "object") {
      return asCellValue(cell.result);
    }
    return undefined;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return asCellValue(value);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    const formulaValue = value as {
      formula?: unknown;
      result?: unknown;
      text?: unknown;
      richText?: Array<{ text?: string }>;
      hyperlink?: unknown;
      error?: unknown;
    };
    if (formulaValue.result !== undefined && formulaValue.result !== null) {
      return asCellValue(formulaValue.result);
    }
    if (typeof formulaValue.text === "string") return asCellValue(formulaValue.text);
    if (Array.isArray(formulaValue.richText)) {
      return asCellValue(formulaValue.richText.map((part) => part.text ?? "").join(""));
    }
    if (typeof formulaValue.error === "string") return formulaValue.error;
  }
  return undefined;
}

function asCellValue(value: unknown): SheetCellValue | undefined {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.length > 2000 ? value.slice(0, 2000) : value;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  }
  return undefined;
}

// --- Style mapping: ExcelJS cell formatting -> Univer IStyleData (see
// @univerjs/core i-style-data.d.ts). Only the common subset a normal
// business worksheet uses (font/fill/border/numFmt/alignment) is mapped;
// gradients, theme colors and conditional formatting are intentionally
// out of scope.

type UniverColor = { rgb?: string };
type UniverBorderSide = { s: number; cl: UniverColor };
type UniverStyle = {
  ff?: string;
  fs?: number;
  it?: 0 | 1;
  bl?: 0 | 1;
  ul?: { s: 0 | 1 };
  st?: { s: 0 | 1 };
  cl?: UniverColor;
  bg?: UniverColor;
  bd?: {
    t?: UniverBorderSide;
    b?: UniverBorderSide;
    l?: UniverBorderSide;
    r?: UniverBorderSide;
  };
  n?: { pattern: string };
  ht?: number;
  vt?: number;
  tb?: number;
};

type UniverSnapshotCell = { v?: SheetCellValue; t?: number; f?: string; s?: string };

// Mirrors @univerjs/core's BorderStyleTypes enum values.
const BORDER_STYLE_MAP: Record<string, number> = {
  thin: 1,
  hair: 2,
  dotted: 3,
  dashed: 4,
  dashDot: 5,
  dashDotDot: 6,
  double: 7,
  medium: 8,
  mediumDashed: 9,
  mediumDashDot: 10,
  mediumDashDotDot: 11,
  slantDashDot: 12,
  thick: 13,
};

// Mirrors @univerjs/core's HorizontalAlign / VerticalAlign enum values.
const H_ALIGN_MAP: Record<string, number> = {
  left: 1,
  center: 2,
  right: 3,
  justify: 4,
  distributed: 6,
};
const V_ALIGN_MAP: Record<string, number> = { top: 1, middle: 2, bottom: 3 };

function argbToRgb(color: Partial<{ argb: string; theme: number }> | undefined): string | undefined {
  const argb = color?.argb;
  if (typeof argb !== "string" || argb.length < 6) return undefined;
  const hex = argb.length >= 8 ? argb.slice(-6) : argb;
  return `#${hex.toUpperCase()}`;
}

function mapFont(font: Partial<ExcelJS.Font> | undefined, style: UniverStyle): void {
  if (!font) return;
  if (font.bold) style.bl = 1;
  if (font.italic) style.it = 1;
  if (font.underline && font.underline !== "none") style.ul = { s: 1 };
  if (font.strike) style.st = { s: 1 };
  if (typeof font.name === "string" && font.name.trim()) style.ff = font.name;
  if (typeof font.size === "number" && font.size > 0) style.fs = font.size;
  const rgb = argbToRgb(font.color);
  if (rgb) style.cl = { rgb };
}

function mapFill(fill: ExcelJS.Fill | undefined, style: UniverStyle): void {
  if (!fill || fill.type !== "pattern" || fill.pattern !== "solid") return;
  const rgb = argbToRgb(fill.fgColor);
  if (rgb) style.bg = { rgb };
}

function mapBorderSide(border: Partial<ExcelJS.Border> | undefined): UniverBorderSide | undefined {
  if (!border?.style) return undefined;
  const s = BORDER_STYLE_MAP[border.style];
  if (s === undefined) return undefined;
  const rgb = argbToRgb(border.color) ?? "#000000";
  return { s, cl: { rgb } };
}

function mapBorders(borders: Partial<ExcelJS.Borders> | undefined, style: UniverStyle): void {
  if (!borders) return;
  const t = mapBorderSide(borders.top);
  const b = mapBorderSide(borders.bottom);
  const l = mapBorderSide(borders.left);
  const r = mapBorderSide(borders.right);
  if (t || b || l || r) {
    style.bd = {
      ...(t ? { t } : {}),
      ...(b ? { b } : {}),
      ...(l ? { l } : {}),
      ...(r ? { r } : {}),
    };
  }
}

function mapAlignment(alignment: Partial<ExcelJS.Alignment> | undefined, style: UniverStyle): void {
  if (!alignment) return;
  const h = alignment.horizontal ? H_ALIGN_MAP[alignment.horizontal] : undefined;
  if (h !== undefined) style.ht = h;
  const v = alignment.vertical ? V_ALIGN_MAP[alignment.vertical] : undefined;
  if (v !== undefined) style.vt = v;
  if (alignment.wrapText) style.tb = 3; // WrapStrategy.WRAP
}

function mapNumFmt(numFmt: string | undefined, style: UniverStyle): void {
  if (typeof numFmt === "string" && numFmt.trim() && numFmt !== "General") {
    style.n = { pattern: numFmt };
  }
}

function cellStyleFromExcel(cell: ExcelJS.Cell): UniverStyle | null {
  const style: UniverStyle = {};
  mapFont(cell.font, style);
  mapFill(cell.fill, style);
  mapBorders(cell.border, style);
  mapAlignment(cell.alignment, style);
  mapNumFmt(cell.numFmt, style);
  return Object.keys(style).length ? style : null;
}

function buildUniverCell(mapped: SheetCell | null, styleId: string | undefined): UniverSnapshotCell | null {
  const out: UniverSnapshotCell = {};
  if (mapped?.f) out.f = mapped.f;
  if (mapped?.v !== undefined && mapped.v !== null) {
    out.v = mapped.v;
    out.t = typeof mapped.v === "number" ? 2 : typeof mapped.v === "boolean" ? 3 : 1;
  }
  if (styleId) out.s = styleId;
  return Object.keys(out).length ? out : null;
}

// --- Export: SheetArtifactContent -> .xlsx bytes. Prefers the raw Univer
// snapshot (import styles + whatever the user/agent has since edited) so
// round-tripping a workbook doesn't flatten it back to plain values; falls
// back to the compact grid (values/formulas only) for workbooks that never
// picked up a snapshot, e.g. ones the agent created from scratch.

type ExportUniverWorksheet = {
  cellData?: Record<string, Record<string, UniverSnapshotCell>>;
  mergeData?: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }>;
  columnData?: Record<string, { w?: number }>;
  rowData?: Record<string, { h?: number }>;
};
type ExportUniverWorkbook = {
  sheets?: Record<string, ExportUniverWorksheet>;
  styles?: Record<string, UniverStyle>;
};

function asExportableSnapshot(snapshot: unknown): ExportUniverWorkbook | undefined {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return undefined;
  return snapshot as ExportUniverWorkbook;
}

const BORDER_STYLE_REVERSE: Record<number, ExcelJS.BorderStyle> = Object.fromEntries(
  Object.entries(BORDER_STYLE_MAP).map(([name, code]) => [code, name as ExcelJS.BorderStyle]),
);
const H_ALIGN_REVERSE: Record<number, Exclude<ExcelJS.Alignment["horizontal"], undefined>> = {
  1: "left",
  2: "center",
  3: "right",
  4: "justify",
  6: "distributed",
};
const V_ALIGN_REVERSE: Record<number, Exclude<ExcelJS.Alignment["vertical"], undefined>> = {
  1: "top",
  2: "middle",
  3: "bottom",
};

function rgbToArgb(rgb: string | undefined): string | undefined {
  const hex = rgb?.replace("#", "");
  if (!hex || hex.length !== 6 || /[^0-9a-fA-F]/.test(hex)) return undefined;
  return `FF${hex.toUpperCase()}`;
}

function applyUniverStyleToCell(cell: ExcelJS.Cell, style: UniverStyle | undefined): void {
  if (!style) return;

  const font: Partial<ExcelJS.Font> = {};
  if (style.bl === 1) font.bold = true;
  if (style.it === 1) font.italic = true;
  if (style.ul?.s === 1) font.underline = true;
  if (style.st?.s === 1) font.strike = true;
  if (style.ff) font.name = style.ff;
  if (typeof style.fs === "number") font.size = style.fs;
  const fontArgb = rgbToArgb(style.cl?.rgb);
  if (fontArgb) font.color = { argb: fontArgb };
  if (Object.keys(font).length) cell.font = font;

  const fillArgb = rgbToArgb(style.bg?.rgb);
  if (fillArgb) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };

  if (style.bd) {
    const borders: Partial<ExcelJS.Borders> = {};
    const sides: Array<[keyof NonNullable<UniverStyle["bd"]>, keyof ExcelJS.Borders]> = [
      ["t", "top"],
      ["b", "bottom"],
      ["l", "left"],
      ["r", "right"],
    ];
    for (const [key, target] of sides) {
      const side = style.bd[key];
      const styleName = side ? BORDER_STYLE_REVERSE[side.s] : undefined;
      if (!styleName) continue;
      borders[target] = { style: styleName, color: { argb: rgbToArgb(side!.cl?.rgb) ?? "FF000000" } };
    }
    if (Object.keys(borders).length) cell.border = borders;
  }

  if (style.n?.pattern) cell.numFmt = style.n.pattern;

  const alignment: Partial<ExcelJS.Alignment> = {};
  if (typeof style.ht === "number" && H_ALIGN_REVERSE[style.ht]) {
    alignment.horizontal = H_ALIGN_REVERSE[style.ht];
  }
  if (typeof style.vt === "number" && V_ALIGN_REVERSE[style.vt]) {
    alignment.vertical = V_ALIGN_REVERSE[style.vt];
  }
  if (style.tb === 3) alignment.wrapText = true;
  if (Object.keys(alignment).length) cell.alignment = alignment;
}

function writeCompactCell(
  worksheet: ExcelJS.Worksheet,
  row: number,
  col: number,
  cell: SheetCell,
  evaluatedResult?: SheetCellValue,
): void {
  const target = worksheet.getCell(row + 1, col + 1);
  // A merged slave aliases its master in ExcelJS; stale slave data must never overwrite it.
  if (target.isMerged && target.master.address !== target.address) return;
  if (cell.f) {
    const formula = cell.f.replace(/^=/, "");
    const result = cell.v !== undefined && cell.v !== null ? cell.v : evaluatedResult;
    target.value = result !== undefined && result !== null ? { formula, result } : { formula };
  } else if (cell.v !== undefined) {
    target.value = cell.v;
  }
}

function writeSheetFromSnapshot(
  worksheet: ExcelJS.Worksheet,
  sheetId: string,
  sheet: ExportUniverWorksheet,
  styles: Record<string, UniverStyle>,
  evaluated: Map<string, SheetCellValue>,
): void {
  for (const [rowKey, row] of Object.entries(sheet.cellData ?? {})) {
    const rowIndex = Number(rowKey);
    if (!Number.isInteger(rowIndex)) continue;
    for (const [colKey, cell] of Object.entries(row)) {
      const colIndex = Number(colKey);
      if (!Number.isInteger(colIndex)) continue;
      const target = worksheet.getCell(rowIndex + 1, colIndex + 1);
      if (cell.f) {
        const formula = cell.f.replace(/^=/, "");
        const fallback = evaluated.get(`${sheetId}!${a1Of(rowIndex, colIndex)}`);
        const result = cell.v !== undefined && cell.v !== null ? cell.v : fallback;
        target.value = result !== undefined && result !== null ? { formula, result } : { formula };
      } else if (cell.v !== undefined && cell.v !== null) {
        target.value = cell.v;
      }
      if (cell.s) applyUniverStyleToCell(target, styles[cell.s]);
    }
  }

  for (const merge of sheet.mergeData ?? []) {
    try {
      worksheet.mergeCells(
        merge.startRow + 1,
        merge.startColumn + 1,
        merge.endRow + 1,
        merge.endColumn + 1,
      );
    } catch {
      // Skip malformed/overlapping merge ranges rather than fail the whole export.
    }
  }

  for (const [colKey, column] of Object.entries(sheet.columnData ?? {})) {
    const colIndex = Number(colKey);
    if (!Number.isInteger(colIndex) || typeof column.w !== "number") continue;
    worksheet.getColumn(colIndex + 1).width = Math.max(1, (column.w - 5) / 7);
  }

  for (const [rowKey, rowInfo] of Object.entries(sheet.rowData ?? {})) {
    const rowIndex = Number(rowKey);
    if (!Number.isInteger(rowIndex) || typeof rowInfo.h !== "number") continue;
    worksheet.getRow(rowIndex + 1).height = Math.max(1, (rowInfo.h * 3) / 4);
  }
}

function safeWorksheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[*?:\\/[\]]/g, " ").trim().slice(0, 31) || "Sheet";
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const tag = ` (${suffix})`;
    candidate = `${base.slice(0, 31 - tag.length)}${tag}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export async function sheetContentToXlsxBuffer(content: SheetArtifactContent): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;
  const snapshot = asExportableSnapshot(content.univerSnapshot);
  const evaluated = evaluateWorkbookFormulas(content);
  const usedNames = new Set<string>();
  const sheetNames = new Map<string, string>();

  for (const grid of content.sheets) {
    const worksheet = workbook.addWorksheet(safeWorksheetName(grid.name, usedNames));
    sheetNames.set(grid.id, worksheet.name);
    const univerSheet = snapshot?.sheets?.[grid.id];
    if (univerSheet) {
      writeSheetFromSnapshot(worksheet, grid.id, univerSheet, snapshot?.styles ?? {}, evaluated);
    }
    // Reconcile against the compact grid regardless: it's the source of truth
    // for values (agent edits always land there), and this fills in any cell
    // the snapshot pass didn't cover — including workbooks with no snapshot.
    for (const [rowKey, row] of Object.entries(grid.cells)) {
      const rowIndex = Number(rowKey);
      if (!Number.isInteger(rowIndex)) continue;
      for (const [colKey, cell] of Object.entries(row)) {
        const colIndex = Number(colKey);
        if (!Number.isInteger(colIndex)) continue;
        const evalVal = evaluated.get(`${grid.id}!${a1Of(rowIndex, colIndex)}`);
        writeCompactCell(worksheet, rowIndex, colIndex, cell, evalVal);
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return (await addNativeCharts(new Uint8Array(buffer), content, sheetNames)).bytes;
}

export async function downloadSheetAsXlsx(content: SheetArtifactContent, filename = 'spreadsheet.xlsx'): Promise<void> {
  const bytes = await sheetContentToXlsxBuffer(content);
  const blob = new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
