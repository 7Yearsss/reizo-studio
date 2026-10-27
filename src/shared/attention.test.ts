import { describe, expect, it } from 'vitest';
import { shouldNudge, summarizeAttention } from './attention';

describe('summarizeAttention', () => {
  it('counts only waiting conversations and words the tooltip for one or many', () => {
    const none = summarizeAttention([{ id: 'a', title: 'x', waiting: false }]);
    expect(none).toMatchObject({ count: 0, tooltip: 'Reizo Studio' });
    const one = summarizeAttention([{ id: 'a', title: '周报整理', waiting: true }, { id: 'b', title: 'y', waiting: false }]);
    expect(one).toMatchObject({ count: 1, ids: ['a'], title: '周报整理' });
    expect(one.tooltip).toContain('周报整理');
    expect(summarizeAttention([{ id: 'a', title: 'a', waiting: true }, { id: 'b', title: 'b', waiting: true }]).tooltip).toContain('2 个对话');
  });
});

describe('shouldNudge', () => {
  it('nudges for a newly waiting conversation while the window is behind, once', () => {
    expect(shouldNudge([], ['a'], false)).toBe(true);
    expect(shouldNudge(['a'], ['a'], false)).toBe(false);
    expect(shouldNudge(['a'], ['a', 'b'], false)).toBe(true);
    expect(shouldNudge(['a'], [], false)).toBe(false);
  });
  it('stays quiet while the user is looking at the window', () => {
    expect(shouldNudge([], ['a'], true)).toBe(false);
  });
});
