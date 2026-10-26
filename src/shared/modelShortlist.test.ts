import { describe, expect, it } from 'vitest';
import { EMPTY_SHORTLIST, parseShortlist, recordPick, shortlistOptions, toggleFavorite } from './modelShortlist';

describe('modelShortlist', () => {
  it('parses defensively', () => {
    expect(parseShortlist('x')).toEqual(EMPTY_SHORTLIST);
    expect(parseShortlist({ favorites: ['a', 1, 'a', ''], recent: 'no' })).toEqual({ favorites: ['a'], recent: [] });
  });

  it('keeps five recents, newest first, without duplicates', () => {
    let list = EMPTY_SHORTLIST;
    for (const v of ['a', 'b', 'c', 'd', 'e', 'f', 'c']) list = recordPick(list, v);
    expect(list.recent).toEqual(['c', 'f', 'e', 'd', 'b']);
  });

  it('toggles favourites on and off', () => {
    const on = toggleFavorite(EMPTY_SHORTLIST, 'a');
    expect(on.favorites).toEqual(['a']);
    expect(toggleFavorite(on, 'a').favorites).toEqual([]);
  });

  it('shows favourites then non-favourite recents, dropping models that no longer exist', () => {
    const options = [{ value: 'a' }, { value: 'b' }, { value: 'c' }];
    const shown = shortlistOptions({ favorites: ['b', 'gone'], recent: ['b', 'c', 'also-gone', 'a'] }, options);
    expect(shown.favorites.map((o) => o.value)).toEqual(['b']);
    expect(shown.recent.map((o) => o.value)).toEqual(['c', 'a']);
  });
});
