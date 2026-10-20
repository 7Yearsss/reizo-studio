import { describe, expect, it } from 'vitest';
import { letterTile, letterTileStyle } from './tileColor';

describe('letterTile', () => {
  it('extracts uppercase initial letter and deterministic hue', () => {
    const a1 = letterTile('github');
    const a2 = letterTile('github');
    expect(a1.letter).toBe('G');
    expect(a1.hue).toBe(a2.hue);
    expect(a1.hue).toBeGreaterThanOrEqual(0);
    expect(a1.hue).toBeLessThan(360);
  });

  it('strips leading punctuation like @ or /', () => {
    expect(letterTile('@modelcontextprotocol/server').letter).toBe('M');
    expect(letterTile('/skills/fix').letter).toBe('S');
    expect(letterTile('--flag').letter).toBe('F');
  });

  it('handles empty, whitespace-only, or punctuation-only strings safely', () => {
    expect(letterTile('').letter).toBe('?');
    expect(letterTile('   ').letter).toBe('?');
    expect(letterTile('///').letter).toBe('/');
  });

  it('supports CJK and unicode characters', () => {
    const res = letterTile('插件管理');
    expect(res.letter).toBe('插');
    expect(res.hue).toBeGreaterThanOrEqual(0);
    expect(res.hue).toBeLessThan(360);
  });
});

describe('letterTileStyle', () => {
  it('returns valid hsl style object with the given hue', () => {
    const style = letterTileStyle(180);
    expect(style.backgroundColor).toContain('180');
    expect(style.color).toContain('180');
    expect(style.borderColor).toContain('180');
  });
});
