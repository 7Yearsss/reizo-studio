import { describe, expect, it } from 'vitest';
import { MAX_STASH, parseStash, pushStash, removeStash, stashPreview } from './draftStash';

describe('draft stash', () => {
  it('puts new drafts on top and ignores blank ones', () => {
    let s = pushStash([], 'one', 1, 'a');
    s = pushStash(s, 'two', 2, 'b');
    expect(s.map((e) => e.text)).toEqual(['two', 'one']);
    expect(pushStash(s, '   ', 3, 'c')).toEqual(s);
  });
  it('moves the same text to the top instead of duplicating it', () => {
    let s = pushStash([], 'one', 1, 'a');
    s = pushStash(s, 'two', 2, 'b');
    s = pushStash(s, 'one ', 3, 'c');
    expect(s.map((e) => e.id)).toEqual(['c', 'b']);
  });
  it('keeps only the newest MAX_STASH', () => {
    let s: ReturnType<typeof pushStash> = [];
    for (let i = 0; i < MAX_STASH + 4; i++) s = pushStash(s, `draft ${i}`, i, `id${i}`);
    expect(s).toHaveLength(MAX_STASH);
    expect(s[0].text).toBe(`draft ${MAX_STASH + 3}`);
  });
  it('removes by id', () => {
    const s = pushStash(pushStash([], 'a', 1, 'x'), 'b', 2, 'y');
    expect(removeStash(s, 'x').map((e) => e.id)).toEqual(['y']);
  });
  it('parses stored data defensively', () => {
    expect(parseStash(null)).toEqual([]);
    expect(parseStash('nope')).toEqual([]);
    expect(parseStash('{"a":1}')).toEqual([]);
    expect(parseStash('[{"id":"a","text":"t","at":1},{"id":3},null]')).toEqual([{ id: 'a', text: 't', at: 1 }]);
  });
  it('previews one clipped line', () => {
    expect(stashPreview('a\n\n  b   c')).toBe('a b c');
    expect(stashPreview('x'.repeat(100), 10)).toBe(`${'x'.repeat(10)}…`);
  });
});
