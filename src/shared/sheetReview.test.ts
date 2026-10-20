import { describe, expect, it } from 'vitest';
import { applySheetOperations, workbookFromCreateSheets, type SheetArtifactContent } from './sheetContent';
import { applySheetReviewOperations, buildSheetDiffPreview, diffSheetContent, formatSheetDiffCounts, isDestructiveSheetChange, sheetChangeRisks, sheetImpacts, sheetReviewTarget, sheetTargetsOverlap, type SheetReviewOperation } from './sheetReview';

function book(): SheetArtifactContent {
  const result = workbookFromCreateSheets([{ name: '数据', values: [['产品', '销量'], ['A', 10], ['B', 20]], formulas: [{ cell: 'B4', formula: '=SUM(B2:B3)' }] }]);
  if ('error' in result) throw new Error(result.error);
  return result.content;
}

describe('diffSheetContent', () => {
  it('classifies added, modified, formula and cleared cells', () => {
    const base = book();
    const next = applySheetOperations(base, [
      { op: 'setValues', sheet: '数据', start: 'B2', values: [[15]] },
      { op: 'setValues', sheet: '数据', start: 'C1', values: [['备注']] },
      { op: 'setFormulas', sheet: '数据', start: 'B4', formulas: [['=AVERAGE(B2:B3)']] },
      { op: 'clearRange', sheet: '数据', range: 'A3' },
    ]);
    if ('error' in next) throw new Error(next.error);
    const diff = diffSheetContent(base, next.content);
    expect(diff.counts).toEqual({ added: 1, modified: 1, formula: 1, cleared: 1 });
    expect(diff.sheets[0]!.cells.map((cell) => `${cell.a1}:${cell.kind}`)).toEqual(['C1:added', 'B2:modified', 'A3:cleared', 'B4:formula']);
    expect(formatSheetDiffCounts(diff)).toBe('新增 1 · 修改 1 · 公式 1 · 清空 1');
  });

  it('ignores recomputed formula results and reports sheet-level changes', () => {
    const base = book();
    base.sheets[0]!.cells['3']!['1']!.v = 30;
    const same = applySheetOperations(base, [{ op: 'setValues', sheet: '数据', start: 'A1', values: [['产品']] }]);
    if ('error' in same) throw new Error(same.error);
    expect(diffSheetContent(base, same.content).sheets).toEqual([]);
    const added = applySheetReviewOperations(base, [{ op: 'addSheet', name: '汇总', values: [['合计']], formulas: [{ cell: 'B1', formula: '=SUM(数据!B2:B3)' }] }]);
    const diff = diffSheetContent(base, added);
    expect(diff.sheets).toMatchObject([{ name: '汇总', status: 'added' }]);
    expect(diff.counts.added).toBe(2);
  });
});

describe('review targets', () => {
  it('detects overlapping ranges and whole-sheet operations', () => {
    const base = book();
    const a = sheetReviewTarget(base, { op: 'setValues', sheet: '数据', start: 'A1', values: [[1, 2], [3, 4]] });
    expect(a.label).toBe('数据!A1:B2');
    expect(sheetTargetsOverlap(a, sheetReviewTarget(base, { op: 'clearRange', sheet: '数据', range: 'B2:C3' }))).toBe(true);
    expect(sheetTargetsOverlap(a, sheetReviewTarget(base, { op: 'clearRange', sheet: '数据', range: 'C1:C3' }))).toBe(false);
    expect(sheetTargetsOverlap(a, sheetReviewTarget(base, { op: 'renameSheet', sheet: '数据', name: 'X' }))).toBe(true);
  });

  it('marks clears and formula overwrites as destructive', () => {
    const base = book();
    const overwrite = { op: 'setValues' as const, sheet: '数据', start: 'B4', values: [[30]] };
    expect(isDestructiveSheetChange(overwrite, diffSheetContent(base, applySheetReviewOperations(base, [overwrite])))).toBe(true);
    const plain = { op: 'setValues' as const, sheet: '数据', start: 'B2', values: [[11]] };
    expect(isDestructiveSheetChange(plain, diffSheetContent(base, applySheetReviewOperations(base, [plain])))).toBe(false);
  });
});

it('builds a highlighted preview that keeps cleared values visible', () => {
  const base = book();
  const candidate = applySheetReviewOperations(base, [{ op: 'clearRange', sheet: '数据', range: 'A2' }, { op: 'setValues', sheet: '数据', start: 'B3', values: [[25]] }]);
  type Preview = { sheets: Record<string, { tabColor?: string; cellData: Record<string, Record<string, { v?: unknown; s?: unknown }>> }> };
  const preview = buildSheetDiffPreview(base, candidate, diffSheetContent(base, candidate), 'Book') as Preview;
  const sheet = preview.sheets[base.sheets[0]!.id]!;
  expect(sheet.tabColor).toBeTruthy();
  expect(sheet.cellData['1']!['0']).toMatchObject({ v: 'A', s: { st: { s: 1 } } });
  expect(sheet.cellData['2']!['1']).toMatchObject({ v: 25, s: { bg: { rgb: expect.any(String) } } });
  expect(candidate.sheets[0]!.cells['1']?.['0']).toBeUndefined();
});

describe('review risks and impact', () => {
  const run = (operation: SheetReviewOperation) => { const base = book(); const next = applySheetReviewOperations(base, [operation]); return { base, next, diff: diffSheetContent(base, next) }; };

  it('says exactly what a destructive edit destroys', () => {
    const overwrite = run({ op: 'setValues', sheet: '数据', start: 'B4', values: [[30]] });
    expect(sheetChangeRisks({ op: 'setValues', sheet: '数据', start: 'B4', values: [[30]] }, overwrite.diff)).toEqual(['把公式改成了固定值：B4']);
    const clear = run({ op: 'clearRange', sheet: '数据', range: 'A2:B3' });
    expect(sheetChangeRisks({ op: 'clearRange', sheet: '数据', range: 'A2:B3' }, clear.diff)).toEqual(['清空 4 个有内容的单元格：A2、B2、A3、B3']);
  });

  it('has no risk to report for a plain addition', () => {
    const add = run({ op: 'setValues', sheet: '数据', start: 'A5', values: [['C', 5]] });
    expect(sheetChangeRisks({ op: 'setValues', sheet: '数据', start: 'A5', values: [['C', 5]] }, add.diff)).toEqual([]);
  });

  it('lists untouched formulas whose result moves, using the engine-computed candidate', () => {
    const { base, next, diff } = run({ op: 'setValues', sheet: '数据', start: 'B2', values: [[15]] });
    base.sheets[0]!.cells['3']!['1']!.v = 30;
    const computed = JSON.parse(JSON.stringify(next));
    computed.sheets[0].cells['3']['1'].v = 35;
    expect(sheetImpacts(base, computed, diff)).toMatchObject([{ a1: 'B4', before: 30, after: 35, sheetName: '数据' }]);
    computed.sheets[0].cells['3']['1'].v = 30;
    expect(sheetImpacts(base, computed, diff)).toEqual([]);
  });

  it('ignores formulas the base never calculated, and ones the edit itself rewrote', () => {
    const { base, next, diff } = run({ op: 'setFormulas', sheet: '数据', start: 'B4', formulas: [['=SUM(B2:B3)+1']] });
    const computed = JSON.parse(JSON.stringify(next)); computed.sheets[0].cells['3']['1'].v = 31;
    expect(sheetImpacts(base, computed, diff)).toEqual([]);
  });
});
