import { describe, expect, it } from 'vitest';
import { tabIndexForShortcut, type ShortcutKeyEvent } from './tabShortcut';

const ev = (over: Partial<ShortcutKeyEvent>): ShortcutKeyEvent => ({ key: '1', code: 'Digit1', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...over });

describe('tabIndexForShortcut', () => {
  it('maps Ctrl+N to the Nth tab', () => {
    expect(tabIndexForShortcut(ev({ key: '3', code: 'Digit3' }), 5)).toBe(2);
    expect(tabIndexForShortcut(ev({ ctrlKey: false, metaKey: true }), 2)).toBe(0);
  });
  it('9 selects the last tab', () => {
    expect(tabIndexForShortcut(ev({ key: '9', code: 'Digit9' }), 4)).toBe(3);
  });
  it('ignores missing tabs, other modifiers and IME composition', () => {
    expect(tabIndexForShortcut(ev({ key: '5', code: 'Digit5' }), 3)).toBeNull();
    expect(tabIndexForShortcut(ev({ altKey: true }), 3)).toBeNull();
    expect(tabIndexForShortcut(ev({ isComposing: true }), 3)).toBeNull();
    expect(tabIndexForShortcut(ev({ ctrlKey: false }), 3)).toBeNull();
  });
});

import { shortcutDigitForTab } from './tabShortcut';

describe('shortcutDigitForTab', () => {
  it('numbers the first eight tabs and gives 9 to the last when there are more', () => {
    expect([0, 1, 2].map((i) => shortcutDigitForTab(i, 3))).toEqual([1, 2, 3]);
    expect(shortcutDigitForTab(7, 8)).toBe(8);
    expect(shortcutDigitForTab(8, 12)).toBeNull();
    expect(shortcutDigitForTab(11, 12)).toBe(9);
  });
  it('matches what Ctrl+digit actually selects', () => {
    for (const count of [1, 3, 8, 10]) {
      for (let i = 0; i < count; i += 1) {
        const digit = shortcutDigitForTab(i, count);
        if (digit === null) continue;
        expect(tabIndexForShortcut({ key: String(digit), ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, count)).toBe(i);
      }
    }
  });
});
