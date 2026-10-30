import { describe, expect, it } from 'vitest';
import { eventToKeys, matchesKeys, resolveKeys, sanitizeOverrides, validateBinding } from './shortcutBindings';

const ev = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods,
});

describe('shortcut bindings', () => {
  it('records a combination and ignores bare modifiers', () => {
    expect(eventToKeys(ev('k', { ctrlKey: true }))).toBe('Mod+K');
    expect(eventToKeys(ev('K', { metaKey: true, shiftKey: true }))).toBe('Mod+Shift+K');
    expect(eventToKeys(ev('Control', { ctrlKey: true }))).toBeNull();
  });

  it('matches defaults and overrides', () => {
    expect(matchesKeys(resolveKeys('palette', {}), ev('k', { ctrlKey: true }))).toBe(true);
    expect(matchesKeys(resolveKeys('palette', { palette: 'Mod+P' }), ev('k', { ctrlKey: true }))).toBe(false);
  });

  it('rejects bare keys, shift-only, reserved and conflicting bindings', () => {
    expect(validateBinding('palette', 'K', {}).ok).toBe(false);
    expect(validateBinding('palette', 'Shift+K', {}).ok).toBe(false);
    expect(validateBinding('palette', 'Mod+C', {}).ok).toBe(false);
    const clash = validateBinding('palette', 'Mod+B', {});
    expect(clash).toEqual({ ok: false, reason: expect.stringContaining('侧栏') });
    expect(validateBinding('palette', 'Mod+Shift+K', {}).ok).toBe(true);
  });

  it('sees another rebound shortcut as the conflict, and frees the old key', () => {
    expect(validateBinding('palette', 'Mod+E', { sidebar: 'Mod+E' }).ok).toBe(false);
    expect(validateBinding('palette', 'Mod+B', { sidebar: 'Mod+E' }).ok).toBe(true);
  });

  it('drops garbage and defaults when loading', () => {
    expect(sanitizeOverrides({ palette: 'Mod+K', sidebar: 'x', shortcuts: 'Mod+Shift+H', bogus: 'Mod+Q' })).toEqual({
      shortcuts: 'Mod+Shift+H',
    });
    expect(sanitizeOverrides(null)).toEqual({});
  });
});
