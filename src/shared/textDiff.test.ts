import { describe, expect, it } from 'vitest';
import { diffHunks } from './textDiff';

function apply(text: string, hunks: ReturnType<typeof diffHunks>): string {
  return [...hunks].reverse().reduce((out, h) => out.slice(0, h.start) + h.text + out.slice(h.end), text);
}

describe('diffHunks', () => {
  it('marks only the characters that changed', () => {
    const hunks = diffHunks('项目预计十月上线。', '项目预计十一月上线。');
    expect(hunks).toEqual([{ start: 5, end: 5, text: '一' }]);
  });
  it('splits distant edits and keeps unchanged text out of them', () => {
    const before = '甲方应在三十日内付款，乙方应在十日内交付。';
    const after = '甲方应在十五日内付款，乙方应在七日内交付。';
    const hunks = diffHunks(before, after);
    expect(hunks.length).toBe(2);
    expect(apply(before, hunks)).toBe(after);
    for (const h of hunks) expect(h.end - h.start).toBeLessThan(6);
  });
  it('works on whole words for Latin text and handles pure insert or delete', () => {
    expect(diffHunks('the quick brown fox', 'the slow brown fox')).toEqual([{ start: 4, end: 9, text: 'slow' }]);
    expect(apply('abc', diffHunks('abc', 'abcdef'))).toBe('abcdef');
    expect(apply('abcdef', diffHunks('abcdef', 'abc'))).toBe('abc');
    expect(diffHunks('same', 'same')).toEqual([]);
  });
  it('merges neighbouring changes into one hunk', () => {
    const hunks = diffHunks('abcdefgh', 'aXcYefgh', 2);
    expect(hunks.length).toBe(1);
    expect(apply('abcdefgh', hunks)).toBe('aXcYefgh');
  });
});
