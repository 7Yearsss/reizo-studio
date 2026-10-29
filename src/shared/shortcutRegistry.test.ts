import { expect, test } from 'vitest';
import { formatShortcut, groupShortcuts, SHORTCUTS } from './shortcutRegistry';

test('ids are unique and every entry has text', () => {
  expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
  for (const s of SHORTCUTS) { expect(s.keys).not.toBe(''); expect(s.label).not.toBe(''); }
});

test('formats Mod per platform', () => {
  expect(formatShortcut('Mod+Shift+T', false)).toBe('Ctrl+Shift+T');
  expect(formatShortcut('Mod+Shift+T', true)).toBe('⌘⇧T');
  expect(formatShortcut('Alt+Shift+Left/Right', true)).toBe('⌥⇧←/→');
  expect(formatShortcut('F6', true)).toBe('F6');
});

test('groups by scope in a fixed order without empty groups', () => {
  const groups = groupShortcuts();
  expect(groups[0][0]).toBe('全局');
  expect(groups.every(([, list]) => list.length > 0)).toBe(true);
  expect(groups.flatMap(([, list]) => list).length).toBe(SHORTCUTS.length);
});
