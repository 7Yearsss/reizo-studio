import { describe, expect, it } from 'vitest';
import { workbookFromCreateSheets } from './sheetContent';
import { applySheetPivot } from './sheetPivot';
import { evaluateWorkbookFormulas } from './sheetFormulaEval';

describe('evaluateWorkbookFormulas (A4)', () => {
  it('evaluates arithmetic, ranges, conditionals, and SUMIFS/COUNTIFS', () => {
    const res = workbookFromCreateSheets([
      {
        name: 'Sales',
        values: [
          ['Region', 'Item', 'Amount'],
          ['East', 'Apple', 100],
          ['West', 'Banana', 200],
          ['East', 'Apple', 150],
        ],
        formulas: [
          { cell: 'D2', formula: '=C2*1.1' },
          { cell: 'C5', formula: '=SUM(C2:C4)' },
          { cell: 'C6', formula: '=AVERAGE(C2:C4)' },
          { cell: 'C7', formula: '=SUMIFS(C2:C4, A2:A4, "=East", B2:B4, "=Apple")' },
          { cell: 'C8', formula: '=COUNTIFS(A2:A4, "=East")' },
          { cell: 'C9', formula: '=IF(C5>400, "Over", "Under")' },
        ],
      },
    ]);
    if ('error' in res) throw new Error(res.error);
    const evaluated = evaluateWorkbookFormulas(res.content);
    const id = res.content.sheets[0]!.id;
    expect(evaluated.get(`${id}!D2`)).toBeCloseTo(110);
    expect(evaluated.get(`${id}!C5`)).toBe(450);
    expect(evaluated.get(`${id}!C6`)).toBe(150);
    expect(evaluated.get(`${id}!C7`)).toBe(250);
    expect(evaluated.get(`${id}!C8`)).toBe(2);
    expect(evaluated.get(`${id}!C9`)).toBe('Over');
  });

  it('evaluates pivot table formulas across sheets and detects cycles safely', () => {
    const res = workbookFromCreateSheets([
      {
        name: 'Data',
        values: [
          ['Dept', 'Cost'],
          ['R&D', 300],
          ['Ops', 100],
          ['R&D', 200],
        ],
        formulas: [
          { cell: 'C1', formula: '=C2' },
          { cell: 'C2', formula: '=C1' },
        ],
      },
    ]);
    if ('error' in res) throw new Error(res.error);
    const pivoted = applySheetPivot(res.content, {
      source: { sheet: 'Data', range: 'A1:B4' },
      rows: ['Dept'],
      values: [{ field: 'Cost', agg: 'sum' }],
      target: { newSheet: 'Pivot', start: 'A1' },
    });
    const evaluated = evaluateWorkbookFormulas(pivoted.content);
    const dataId = pivoted.content.sheets[0]!.id;
    const pivotId = pivoted.content.sheets[1]!.id;
    expect(evaluated.get(`${dataId}!C1`)).toBe('#CYCLE!');
    // Pivot rows: Ops (100), R&D (500), Total (600)
    expect(evaluated.get(`${pivotId}!B2`)).toBe(100);
    expect(evaluated.get(`${pivotId}!B3`)).toBe(500);
    expect(evaluated.get(`${pivotId}!B4`)).toBe(600);
  });

  it('treats a blank cell as empty text and as zero in arithmetic', () => {
    const res = workbookFromCreateSheets([
      {
        name: 'Check',
        values: [
          ['Label', 'Yes'],
          ['', ''],
        ],
        formulas: [
          { cell: 'C1', formula: '=IF(A2="","empty","full")' },
          { cell: 'C2', formula: '=B1="yes"' },
          { cell: 'C3', formula: '=A2+1' },
        ],
      },
    ]);
    if ('error' in res) throw new Error(res.error);
    const evaluated = evaluateWorkbookFormulas(res.content);
    const id = res.content.sheets[0]!.id;
    expect(evaluated.get(`${id}!C1`)).toBe('empty');
    expect(evaluated.get(`${id}!C2`)).toBe(true);
    expect(evaluated.get(`${id}!C3`)).toBe(1);
  });
});
