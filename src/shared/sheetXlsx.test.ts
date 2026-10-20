import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { workbookFromCreateSheets } from './sheetContent';
import { sheetContentToXlsxBuffer } from './sheetXlsx';

describe('sheetXlsx', () => {
  it('generates a valid .xlsx buffer from SheetArtifactContent', async () => {
    const res = workbookFromCreateSheets([
      {
        name: 'Report',
        values: [
          ['Month', 'Revenue'],
          ['Jan', 1000],
          ['Feb', 1500],
        ],
        formulas: [{ cell: 'B4', formula: '=SUM(B2:B3)' }],
      },
    ]);
    if (!('content' in res)) throw new Error('creation failed');

    const buffer = await sheetContentToXlsxBuffer(res.content);
    expect(buffer).toBeDefined();
    expect(buffer.byteLength).toBeGreaterThan(100);

    // Check PK zip header signature of .xlsx (50 4B 03 04)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it('populates cached result values on formula cells when exporting .xlsx (A4)', async () => {
    const res = workbookFromCreateSheets([
      {
        name: 'Report',
        values: [
          ['Month', 'Revenue'],
          ['Jan', 1000],
          ['Feb', 1500],
        ],
        formulas: [
          { cell: 'B4', formula: '=SUM(B2:B3)' },
          { cell: 'B5', formula: '=B4*1.1' },
        ],
      },
    ]);
    if (!('content' in res)) throw new Error('creation failed');

    const buffer = await sheetContentToXlsxBuffer(res.content);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(buffer).buffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('B4').value).toEqual({ formula: 'SUM(B2:B3)', result: 2500 });
    expect(ws.getCell('B5').value).toEqual({ formula: 'B4*1.1', result: 2750 });
  });
});
