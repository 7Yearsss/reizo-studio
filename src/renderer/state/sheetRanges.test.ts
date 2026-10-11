import { beforeEach, describe, expect, it } from 'vitest';
import { parseSheetReferences } from '../../shared/sheetReferences';
import { clearPinnedSheets, liveSheetSelection, pinSheetSelection, publishSheetSelection, removePinnedSheet, restoreSheetReferences, sheetMentions } from './sheetWorkspace';

const S = 's1';
const pick = (range: string) => publishSheetSelection(S, { artifactId: 'b1', name: '工作簿', sheetId: 'sh', sheetName: 'Sheet1', range });
const sent = (first?: number) => parseSheetReferences(sheetMentions(S, first)).refs;

describe('quoted sheet ranges', () => {
  beforeEach(() => { clearPinnedSheets(S); publishSheetSelection(S, { artifactId: 'b1', name: '工作簿' }); });

  it('numbers quoted ranges after the document and HTML ones, and leaves the live selection unnumbered', () => {
    pick('A1:B2'); expect(pinSheetSelection(S)).toBe(true);
    pick('D1:D5'); pinSheetSelection(S);
    pick('F1');
    expect(sent(3).map((r) => [r.range, r.label])).toEqual([['A1:B2', 3], ['D1:D5', 4], ['F1', undefined]]);
  });

  it('a quoted range is not sent twice when it is still the live selection', () => {
    pick('A1:B2'); pinSheetSelection(S); pinSheetSelection(S);
    expect(liveSheetSelection(S)).toBeUndefined();
    expect(sent().map((r) => r.range)).toEqual(['A1:B2']);
  });

  it('cannot quote without a cell range', () => {
    expect(pinSheetSelection(S)).toBe(false);
    expect(sent().filter((r) => r.range)).toEqual([]);
  });

  it('removing one shifts the numbers after it down', () => {
    pick('A1'); pinSheetSelection(S); pick('B1'); pinSheetSelection(S);
    removePinnedSheet(S, 0);
    expect(sent().find((r) => r.range === 'B1')?.label).toBe(1);
  });

  it('a restored message drops stale numbers and gets them again in order', () => {
    restoreSheetReferences(S, [{ artifactId: 'b1', name: '工作簿', range: 'A1', label: 7 }, { artifactId: 'b1', name: '工作簿', range: 'B1', label: 9 }]);
    publishSheetSelection(S, { artifactId: 'b1', name: '工作簿' });
    expect(sent().map((r) => r.label)).toEqual([1, 2, undefined]);
  });
});
