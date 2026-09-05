import ExcelJS from 'exceljs';
import {
  type SheetArtifactContent,
  type SheetCell,
} from './sheetContent';

function safeWorksheetName(rawName: string, used: Set<string>): string {
  const base = rawName.replace(/[:\\/?*[\]]/g, ' ').trim() || 'Sheet';
  let candidate = base.slice(0, 31);
  let suffix = 1;
  while (used.has(candidate.toLowerCase())) {
    const tag = ` (${suffix})`;
    candidate = `${base.slice(0, 31 - tag.length)}${tag}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function writeCompactCell(
  worksheet: ExcelJS.Worksheet,
  rowIndex: number,
  colIndex: number,
  cell: SheetCell,
): void {
  const excelCell = worksheet.getCell(rowIndex + 1, colIndex + 1);
  if (cell.f) {
    excelCell.value = {
      formula: cell.f.startsWith('=') ? cell.f.slice(1) : cell.f,
      result: cell.v ?? undefined,
    };
  } else if (cell.v !== undefined && cell.v !== null) {
    excelCell.value = cell.v as ExcelJS.CellValue;
  }
}

export async function sheetContentToXlsxBuffer(content: SheetArtifactContent): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();

  for (const grid of content.sheets) {
    const worksheet = workbook.addWorksheet(safeWorksheetName(grid.name, usedNames));
    for (const [rowKey, row] of Object.entries(grid.cells)) {
      const rowIndex = Number(rowKey);
      if (!Number.isInteger(rowIndex)) continue;
      for (const [colKey, cell] of Object.entries(row)) {
        const colIndex = Number(colKey);
        if (!Number.isInteger(colIndex)) continue;
        writeCompactCell(worksheet, rowIndex, colIndex, cell);
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
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
  a.click();
  URL.revokeObjectURL(url);
}
