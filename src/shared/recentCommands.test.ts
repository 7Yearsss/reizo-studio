import { describe, expect, it } from 'vitest';
import { parseRecent, recordRecent, resolveRecent } from './recentCommands';

describe('recentCommands', () => {
  it('keeps five, newest first, no duplicates', () => {
    let ids: string[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'c']) ids = recordRecent(ids, id);
    expect(ids).toEqual(['c', 'f', 'e', 'd', 'b']);
  });
  it('parses defensively', () => {
    expect(parseRecent('x')).toEqual([]);
    expect(parseRecent(['a', 1, 'a', ''])).toEqual(['a']);
  });
  it('drops commands that no longer exist and keeps recency order', () => {
    expect(resolveRecent(['b', 'gone', 'a'], [{ id: 'a' }, { id: 'b' }]).map((i) => i.id)).toEqual(['b', 'a']);
  });
});
