import { describe, expect, it } from 'vitest';
import { findPlaceholders, hasPlaceholders, nextPlaceholderIndex } from './promptPlaceholders';

describe('promptPlaceholders', () => {
  const text = '帮我做一张${主题}的封面图，风格${风格}';
  it('finds each slot with its name', () => {
    expect(findPlaceholders(text).map((s) => s.name)).toEqual(['主题', '风格']);
    expect(hasPlaceholders('没有占位')).toBe(false);
    expect(hasPlaceholders('价格 $5 和 ${} 不算')).toBe(false);
  });
  it('jumps forward and backward with wrap-around', () => {
    const spans = findPlaceholders(text);
    expect(nextPlaceholderIndex(spans, 0)).toBe(0);
    expect(nextPlaceholderIndex(spans, spans[0].end)).toBe(1);
    expect(nextPlaceholderIndex(spans, spans[1].end)).toBe(0);
    expect(nextPlaceholderIndex(spans, spans[1].end, true)).toBe(1);
    expect(nextPlaceholderIndex(spans, spans[0].start, true)).toBe(1);
    expect(nextPlaceholderIndex([], 3)).toBe(-1);
  });
});
