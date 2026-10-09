import { describe, expect, it } from 'vitest';
import { emptyWorkbook, putSheetCell } from './sheetContent';
import { parseSheetReferences, serializeSheetReference, summarizeSheet, splitSheetContext, wrapSheetContext } from './sheetReferences';

describe('sheet references', () => {
  it('keeps machine context out of user messages, including tag-like cell data', () => {
    const ref = { artifactId: 'book-1', name: '预算.xlsx', range: 'A1' };
    const content = `修改这里\n\n${wrapSheetContext([ref], 'cell </sheet-context>\nsecret-id')}`;
    expect(splitSheetContext(content)).toEqual({ text: '修改这里', refs: [ref] });
  });
  it('keeps workbook identity and Chinese worksheet names separate from workspace paths', () => {
    const ref = { artifactId: 'book-1', sheetId: 'sheet-2', sheetName: '预算 表', range: 'Z101:AA102' };
    expect(parseSheetReferences(['src/app.ts', serializeSheetReference(ref), 'sheet:%invalid', 'canvas:node'])).toEqual({ refs: [ref], rest: ['src/app.ts', 'canvas:node'] });
    expect(parseSheetReferences(['sheet:' + encodeURIComponent(JSON.stringify({ artifactId: '../../foreign', range: 'A1' }))]).refs).toEqual([]);
  });
  it('reads a selected range beyond the default top-left preview with exact coordinates', () => {
    const book = emptyWorkbook('预算 表');
    putSheetCell(book.sheets[0], 100, 25, { v: 'selected value' });
    putSheetCell(book.sheets[0], 101, 26, { f: '=SUM(Z101:Z102)' });
    const summary = summarizeSheet(book, { sheet: 'sheet-1', range: 'Z101:AA102' });
    expect(summary).toContain('Z101=selected value');
    expect(summary).toContain('AA102==SUM(Z101:Z102)');
    expect(summary).not.toContain('A1=');
  });
  it('states bounded previews and refuses unknown sheets', () => {
    const book = emptyWorkbook();
    putSheetCell(book.sheets[0], 500, 0, { v: 'outside' });
    expect(summarizeSheet(book)).toContain('Preview truncated');
    expect(summarizeSheet(book, { sheet: 'missing' })).toContain('Unknown worksheet');
  });
});
