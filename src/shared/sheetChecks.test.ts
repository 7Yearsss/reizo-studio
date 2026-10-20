import { describe, expect, it } from 'vitest';
import { checkSheet, formulaFromShape, formulaShape, newSheetFindings } from './sheetChecks';
import { workbookFromCreateSheets, type SheetArtifactContent, type SheetCellValue } from './sheetContent';

function book(values: SheetCellValue[][], formulas: Array<{ cell: string; formula: string }> = []): SheetArtifactContent {
  const made = workbookFromCreateSheets([{ name: 'Data', values, formulas }]);
  if ('error' in made) throw new Error(made.error);
  return made.content;
}
const kinds = (content: SheetArtifactContent) => checkSheet(content).findings.map((f) => `${f.kind}@${f.range}`);

describe('formula shapes', () => {
  it('compares formulas by relative position, so a filled-down column has one shape', () => {
    expect(formulaShape('=B2*C2', 1, 3)).toBe(formulaShape('=B3*C3', 2, 3));
    expect(formulaShape('=B2*C2', 1, 3)).not.toBe(formulaShape('=B3*C2', 2, 3));
  });
  it('keeps absolute parts, ignores string literals and function names', () => {
    expect(formulaShape('=B2*$F$1', 1, 3)).toBe(formulaShape('=B7*$F$1', 6, 3));
    expect(formulaShape('=LOG10(B2)&"A1"', 1, 3)).toContain('LOG10(');
    expect(formulaShape('=LOG10(B2)&"A1"', 1, 3)).toContain('"A1"');
  });
  it('rebuilds a formula for another row, and refuses to leave the sheet', () => {
    expect(formulaFromShape(formulaShape('=B2*C2', 1, 3), 4, 3)).toBe('=B5*C5');
    expect(formulaFromShape(formulaShape('=B2*C2', 1, 3), 0, 3)).toBe('=B1*C1');
    expect(formulaFromShape('{R-3C0}', 1, 0)).toBeNull();
  });
});

describe('checkSheet', () => {
  const rows: SheetCellValue[][] = [['单价', '数量', '金额'], [3, 2, null], [4, 5, null], [5, 1, null], [6, 7, null], [7, 3, null]];
  const fill = (r: number) => ({ cell: `C${r}`, formula: `=A${r}*B${r}` });

  it('reports a formula that breaks its column rule, with the fix', () => {
    const content = book(rows, [fill(2), fill(3), { cell: 'C4', formula: '=A4+B4' }, fill(5), fill(6)]);
    const [finding] = checkSheet(content).findings;
    expect(finding).toMatchObject({ kind: 'inconsistent-formula', range: 'C4', severity: 'warning', fix: { formula: '=A4*B4' } });
  });

  it('reports a typed number inside a column of formulas', () => {
    const content = book(rows.map((r, i) => (i === 3 ? [r[0]!, r[1]!, 99] : r)), [fill(2), fill(3), fill(5), fill(6)]);
    expect(kinds(content)).toContain('constant-in-formulas@C4');
  });

  it('leaves a total row at the foot of the column alone', () => {
    const content = book([...rows, ['', '', null]], [fill(2), fill(3), fill(4), fill(5), fill(6), { cell: 'C7', formula: '=SUM(C2:C6)' }]);
    expect(kinds(content)).toEqual([]);
  });

  it('spots a SUM that stops one row short', () => {
    const content = book([[1], [2], [3], [4]], [{ cell: 'B1', formula: '=SUM(A1:A3)' }]);
    expect(checkSheet(content).findings[0]).toMatchObject({ kind: 'range-gap', range: 'B1', fix: { formula: '=SUM(A1:A4)' } });
  });

  it('flags text numbers in a numeric column, but not an all-text ID column', () => {
    const mixed = book([[10], [20], ['30'], [40]]);
    expect(checkSheet(mixed).findings[0]).toMatchObject({ kind: 'number-as-text', range: 'A3', fix: { value: 30 } });
    const ids = book([['250201'], ['250202'], ['250203'], ['250204']]);
    expect(checkSheet(ids).findings).toEqual([]);
  });

  it('flags stray spaces and offers the trimmed text', () => {
    const [finding] = checkSheet(book([['张三 '], ['李四']])).findings;
    expect(finding).toMatchObject({ kind: 'stray-space', range: 'A1', fix: { value: '张三' } });
  });

  it('treats a non-breaking space like a stray space', () => {
    const [finding] = checkSheet(book([[`张三${String.fromCharCode(160)}`], ['李四']])).findings;
    expect(finding).toMatchObject({ kind: 'stray-space', fix: { value: '张三' } });
  });

  it('groups magic numbers and whole-column references per column', () => {
    const content = book([[1], [2], [3]], [{ cell: 'B1', formula: '=A1*1.13' }, { cell: 'B2', formula: '=A2*1.13' }, { cell: 'B3', formula: '=A3*1.13' }, { cell: 'C1', formula: '=SUM(A:A)' }]);
    const found = checkSheet(content).findings;
    expect(found.filter((f) => f.kind === 'magic-number')).toHaveLength(1);
    expect(found.find((f) => f.kind === 'magic-number')?.range).toBe('B1:B3');
    expect(found.find((f) => f.kind === 'whole-column-ref')?.range).toBe('C1');
  });

  it('reports cached error values', () => {
    const content = book([[1]]);
    content.sheets[0]!.cells['0']!['1'] = { f: '=A1/0', v: '#DIV/0!' };
    expect(checkSheet(content).findings[0]).toMatchObject({ kind: 'error-value', severity: 'error', range: 'B1' });
  });

  it('does not complain about a clean sheet, and reports what it scanned', () => {
    const result = checkSheet(book(rows, [fill(2), fill(3), fill(4), fill(5), fill(6)]));
    expect(result.total).toBe(0);
    expect(result.scanned).toEqual({ sheets: 1, cells: 18, formulas: 5 });
  });

  it('lists only what an edit newly breaks', () => {
    const base = book(rows, [fill(2), fill(3), fill(4), fill(5), fill(6)]);
    const edited = book(rows, [fill(2), fill(3), { cell: 'C4', formula: '=A4+B4' }, fill(5), fill(6)]);
    expect(newSheetFindings(base, edited).map((f) => f.range)).toEqual(['C4']);
    expect(newSheetFindings(edited, edited)).toEqual([]);
  });
});
