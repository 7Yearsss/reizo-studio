import { describe, expect, it } from 'vitest';
import {
  applySheetOperations,
  compactToUniverSnapshot,
  emptyWorkbook,
  parseSheetContent,
  serializeSheetContent,
  sheetToCsv,
  univerSnapshotToCompact,
  workbookFromCreateSheets,
} from './sheetContent';

describe('sheetContent', () => {
  it('creates an empty workbook', () => {
    const wb = emptyWorkbook('Budget');
    expect(wb.sheets).toHaveLength(1);
    expect(wb.sheets[0]?.name).toBe('Budget');
  });

  it('creates workbook from create sheets array', () => {
    const res = workbookFromCreateSheets([
      {
        name: 'Sales',
        values: [
          ['Item', 'Price', 'Qty'],
          ['Apple', 10, 5],
          ['Banana', 5, 20],
        ],
        formulas: [{ cell: 'D2', formula: '=B2*C2' }],
      },
    ]);
    expect('content' in res).toBe(true);
    if ('content' in res) {
      expect(res.content.sheets[0]?.cells['0']?.['0']?.v).toBe('Item');
      expect(res.content.sheets[0]?.cells['1']?.['1']?.v).toBe(10);
      expect(res.content.sheets[0]?.cells['1']?.['3']?.f).toBe('=B2*C2');
    }
  });

  it('applies sheet operations (setValues, setFormulas, clearRange)', () => {
    const initial = emptyWorkbook('Sheet1');
    const res = applySheetOperations(initial, [
      {
        op: 'setValues',
        start: 'A1',
        values: [
          ['Name', 'Score'],
          ['Alice', 95],
        ],
      },
      {
        op: 'setFormulas',
        start: 'B3',
        formulas: [['=AVERAGE(B2)']],
      },
    ]);
    expect('content' in res).toBe(true);
    if ('content' in res) {
      expect(res.content.sheets[0]?.cells['0']?.['0']?.v).toBe('Name');
      expect(res.content.sheets[0]?.cells['1']?.['1']?.v).toBe(95);
      expect(res.content.sheets[0]?.cells['2']?.['1']?.f).toBe('=AVERAGE(B2)');
      expect(res.content.revision).toBe(initial.revision + 1);

      // Clear range
      const cleared = applySheetOperations(res.content, [
        {
          op: 'clearRange',
          range: 'A1:B1',
        },
      ]);
      if ('content' in cleared) {
        expect(cleared.content.sheets[0]?.cells['0']).toBeUndefined();
        expect(cleared.content.sheets[0]?.cells['1']?.['1']?.v).toBe(95);
      }
    }
  });

  it('converts to Univer snapshot and back without data loss', () => {
    const res = workbookFromCreateSheets([
      {
        name: 'Test',
        values: [
          ['Col1', 'Col2'],
          ['Val1', 123],
        ],
      },
    ]);
    if (!('content' in res)) throw new Error('creation failed');

    const snapshot = compactToUniverSnapshot(res.content, 'TestBook');
    expect(snapshot).toBeDefined();

    const roundtrip = univerSnapshotToCompact(snapshot, res.content);
    expect(roundtrip.sheets[0]?.cells['1']?.['1']?.v).toBe(123);
    expect(roundtrip.sheets[0]?.cells['0']?.['0']?.v).toBe('Col1');
  });

  it('exports sheet to csv', () => {
    const res = workbookFromCreateSheets([
      {
        name: 'CSVTest',
        values: [
          ['A', 'B'],
          ['1', '2'],
        ],
      },
    ]);
    if (!('content' in res)) throw new Error('creation failed');
    const csv = sheetToCsv(res.content.sheets[0]!);
    expect(csv).toBe('A,B\n1,2');
  });

  it('serializes and parses sheet content', () => {
    const wb = emptyWorkbook('ParseTest');
    const json = serializeSheetContent(wb);
    expect(typeof json).toBe('string');
    const parsed = parseSheetContent(json);
    expect(parsed?.sheets[0]?.name).toBe('ParseTest');
  });
});
