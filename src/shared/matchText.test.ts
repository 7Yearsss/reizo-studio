import { describe, expect, it } from 'vitest';
import { matchAny, matchScore, matchText } from './matchText';

describe('matchText', () => {
  it('matches substrings case-insensitively', () => {
    expect(matchText('Exp', 'export')).toBe(true);
    expect(matchText('zzz', 'export')).toBe(false);
  });
  it('matches pinyin initials and full pinyin', () => {
    expect(matchText('dc', '导出')).toBe(true);
    expect(matchText('wd', '文档')).toBe(true);
    expect(matchText('wendang', '文档')).toBe(true);
    expect(matchText('xg', '修改')).toBe(true);
    expect(matchText('xx', '导出')).toBe(false);
  });
  it('ranks substring above pinyin and prefix above inner', () => {
    expect(matchScore('导', '导出')).toBeGreaterThan(matchScore('dc', '导出'));
    expect(matchScore('ex', 'export')).toBeGreaterThan(matchScore('po', 'export'));
  });
  it('empty query matches everything; matchAny takes the best field', () => {
    expect(matchText('', 'anything')).toBe(true);
    expect(matchAny('wd', ['nope', '文档', undefined])).toBeGreaterThan(0);
  });
});
