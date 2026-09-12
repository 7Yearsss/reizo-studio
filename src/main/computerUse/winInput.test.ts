import { describe, expect, it } from 'vitest';
import { physArg, resolveWinChord } from './winInput';

describe('physArg', () => {
  it('returns -1 -1 for a null point (use current cursor)', () => {
    expect(physArg(null, 1)).toBe('-1 -1');
  });

  it('scales logical coordinates by the display scale factor', () => {
    expect(physArg({ x: 100, y: 50 }, 1)).toBe('100 50');
    expect(physArg({ x: 100, y: 50 }, 1.5)).toBe('150 75');
    expect(physArg({ x: 10, y: 10 }, 2)).toBe('20 20');
  });
});

describe('resolveWinChord', () => {
  it('maps a plain letter to its VK code with no modifiers', () => {
    expect(resolveWinChord('a')).toEqual({ mods: [], key: 0x41 });
  });

  it('maps ctrl+s', () => {
    expect(resolveWinChord('ctrl+s')).toEqual({ mods: [0x11], key: 0x53 });
  });

  it('maps a named key', () => {
    expect(resolveWinChord('Return')).toEqual({ mods: [], key: 0x0d });
    expect(resolveWinChord('alt+Tab')).toEqual({ mods: [0x12], key: 0x09 });
  });

  it('orders modifiers ctrl, alt, shift, meta', () => {
    expect(resolveWinChord('shift+ctrl+F5')).toEqual({ mods: [0x11, 0x10], key: 0x74 });
  });

  it('returns null when there is no non-modifier key', () => {
    expect(resolveWinChord('ctrl+shift')).toBeNull();
    expect(resolveWinChord('')).toBeNull();
  });
});
