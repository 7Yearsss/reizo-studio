import { describe, expect, it } from 'vitest';
import { sheetFromTableRows, tableCellValue } from './tableToSheet';

describe('tableToSheet', () => {
  it('types plain numbers, keeps ids and text', () => {
    expect(tableCellValue(' 12.5 ')).toBe(12.5);
    expect(tableCellValue('-3')).toBe(-3);
    expect(tableCellValue('007')).toBe('007');
    expect(tableCellValue('1234567890123456789')).toBe('1234567890123456789');
    expect(tableCellValue('¥12')).toBe('¥12');
    expect(tableCellValue('')).toBeNull();
  });
  it('builds a one-sheet workbook with the header row first', () => {
    const r = sheetFromTableRows('预算', [['项目', '金额'], ['广告', '1200'], ['物流']]);
    expect('content' in r).toBe(true);
    if ('content' in r) {
      const cells = r.content.sheets[0].cells;
      expect(cells['0']['0'].v).toBe('项目');
      expect(cells['1']['1'].v).toBe(1200);
      expect(r.content.sheets[0].name).toBe('预算');
    }
  });
  it('rejects empty and oversized tables', () => {
    expect('error' in sheetFromTableRows('x', [])).toBe(true);
    expect('error' in sheetFromTableRows('x', [Array(60).fill('a')])).toBe(true);
  });
});
