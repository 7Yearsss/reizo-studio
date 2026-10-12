import { describe, expect, it } from 'vitest';
import { linkSheetCells, parseSheetCellHref } from './linkSheetCells';

describe('linkSheetCells', () => {
  it('links sheet-qualified cells and ranges, in prose or in inline code', () => {
    expect(linkSheetCells('看 Sheet1!C5 和 `Sheet1!A1:B9`')).toBe('看 [Sheet1!C5](#sheetcell:Sheet1!C5) 和 [`Sheet1!A1:B9`](#sheetcell:Sheet1!A1:B9)');
  });

  it('handles Chinese and quoted sheet names', () => {
    expect(linkSheetCells("见 成绩表!B2 与 '月度 数据'!A1")).toBe("见 [成绩表!B2](#sheetcell:%E6%88%90%E7%BB%A9%E8%A1%A8!B2) 与 ['月度 数据'!A1](#sheetcell:%E6%9C%88%E5%BA%A6%20%E6%95%B0%E6%8D%AE!A1)");
  });

  it('leaves bare addresses, code blocks, URLs and function calls alone', () => {
    expect(linkSheetCells('C5 有问题')).toBe('C5 有问题');
    expect(linkSheetCells('```\nSheet1!C5\n```')).toBe('```\nSheet1!C5\n```');
    expect(linkSheetCells('https://x.com/a!B1')).toBe('https://x.com/a!B1');
    expect(linkSheetCells('Sheet1!LOG10(')).toBe('Sheet1!LOG10(');
  });

  it('drops dollar signs from the target but keeps the text as written', () => {
    expect(linkSheetCells('Data!$B$2')).toBe('[Data!$B$2](#sheetcell:Data!B2)');
  });

  it('round-trips through parseSheetCellHref', () => {
    const link = /\((#sheetcell:[^)]+)\)/.exec(linkSheetCells("'月度 数据'!A1:B2"))![1]!;
    expect(parseSheetCellHref(link)).toEqual({ sheetName: '月度 数据', range: 'A1:B2' });
    expect(parseSheetCellHref('https://x.com')).toBeNull();
  });
});
