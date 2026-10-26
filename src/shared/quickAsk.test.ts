import { describe, expect, it } from 'vitest';
import { isQuickWindowHash, MAX_QUICK_ASK_CHARS, normalizeQuickAsk, quickWindowPosition } from './quickAsk';

describe('quick ask', () => {
  it('accepts only non-empty strings, trimmed and capped', () => {
    expect(normalizeQuickAsk('  你好  ')).toBe('你好');
    expect(normalizeQuickAsk('   ')).toBeNull();
    expect(normalizeQuickAsk(42)).toBeNull();
    expect(normalizeQuickAsk('x'.repeat(MAX_QUICK_ASK_CHARS + 10))).toHaveLength(MAX_QUICK_ASK_CHARS);
  });
  it('recognises the quick window hash', () => {
    expect(isQuickWindowHash('#quick')).toBe(true);
    expect(isQuickWindowHash('quick')).toBe(true);
    expect(isQuickWindowHash('#other')).toBe(false);
    expect(isQuickWindowHash('')).toBe(false);
  });
  it('centres horizontally on the display it is shown on, upper third', () => {
    expect(quickWindowPosition({ x: 1920, y: 0, width: 1920, height: 1000 }, { width: 600, height: 140 })).toEqual({ x: 2580, y: 220 });
  });
});
