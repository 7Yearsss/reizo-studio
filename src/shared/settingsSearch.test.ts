import { describe, expect, it } from 'vitest';
import { SETTINGS_CATALOG, resolveSettingsTarget, searchSettings } from './settingsSearch';

describe('settings catalog', () => {
  it('has unique ids and no alias that collides with an id or another alias', () => {
    const seen = new Set<string>();
    for (const e of SETTINGS_CATALOG) {
      for (const key of [e.id, ...(e.aliases ?? [])].map((k) => k.toLowerCase())) {
        expect(seen.has(key), `duplicate key ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('gives every anchor to one entry only', () => {
    const anchors = SETTINGS_CATALOG.filter((e) => e.anchor).map((e) => `${e.section}/${e.anchor}`);
    expect(new Set(anchors).size).toBe(anchors.length);
  });
});

describe('search', () => {
  it('ranks an exact title above keyword hits', () => {
    expect(searchSettings('权限')[0].id).toBe('general.permissions');
    expect(searchSettings('proxy')[0].id).toBe('network');
  });
  it('finds by keyword, English or Chinese, ignoring case and spaces', () => {
    expect(searchSettings('Dark')[0].id).toBe('general.appearance');
    expect(searchSettings('API key')[0].id).toBe('providers');
  });
  it('returns nothing for an empty or unmatched query', () => {
    expect(searchSettings('  ')).toEqual([]);
    expect(searchSettings('zzzzqq')).toEqual([]);
  });
  it('resolves ids and retired aliases, and misses cleanly', () => {
    expect(resolveSettingsTarget('general.permissions')?.section).toBe('general');
    expect(resolveSettingsTarget('Admin')?.section).toBe('providers');
    expect(resolveSettingsTarget('gone')).toBeUndefined();
  });
});
