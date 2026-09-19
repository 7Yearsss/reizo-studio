import { describe, expect, it } from 'vitest';
import { applySlashArgs, extractSlashQuery } from './SlashPalette';

describe('extractSlashQuery', () => {
  it('returns null for non-slash input', () => {
    expect(extractSlashQuery('hello')).toBeNull();
    expect(extractSlashQuery('a /b')).toBeNull();
    expect(extractSlashQuery('')).toBeNull();
  });

  it('splits command and args', () => {
    expect(extractSlashQuery('/sum')).toEqual({ query: 'sum', args: '' });
    expect(extractSlashQuery('/sum a b')).toEqual({ query: 'sum', args: 'a b' });
    expect(extractSlashQuery('/sum  多 行\n文本 ')).toEqual({ query: 'sum', args: '多 行\n文本' });
  });
});

describe('applySlashArgs', () => {
  it('substitutes $ARGUMENTS', () => {
    expect(applySlashArgs('总结: $ARGUMENTS', '这段文字')).toBe('总结: 这段文字');
    expect(applySlashArgs('$ARGUMENTS 和 $ARGUMENTS', 'x')).toBe('x 和 x');
  });

  it('substitutes positional $1..$N', () => {
    expect(applySlashArgs('比较 $1 与 $2', '甲 乙')).toBe('比较 甲 与 乙');
    expect(applySlashArgs('$1-$3', 'a b')).toBe('a-');
  });

  it('appends args when template has no placeholders', () => {
    expect(applySlashArgs('固定前缀', '尾巴')).toBe('固定前缀 尾巴');
  });

  it('returns args when template is empty, template when no args', () => {
    expect(applySlashArgs(undefined, 'x')).toBe('x');
    expect(applySlashArgs('固定', '')).toBe('固定');
  });
});
