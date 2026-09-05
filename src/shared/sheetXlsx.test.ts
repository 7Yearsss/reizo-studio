import { describe, expect, it } from 'vitest';
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
});
