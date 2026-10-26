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
