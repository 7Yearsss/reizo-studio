import { afterEach, expect, test } from 'vitest';
import { recalledScroll, rememberScroll, resetScrollMemoryForTest } from './scrollMemory';

afterEach(() => resetScrollMemoryForTest());

test('remembers per key and forgets when back at the top', () => {
  rememberScroll('doc:a', 340.4);
  expect(recalledScroll('doc:a')).toBe(340);
  expect(recalledScroll('doc:b')).toBe(0);
  rememberScroll('doc:a', 0);
  expect(recalledScroll('doc:a')).toBe(0);
});

test('caps how many positions are kept, dropping the oldest', () => {
  for (let i = 0; i < 205; i++) rememberScroll(`k${i}`, 10 + i);
  expect(recalledScroll('k0')).toBe(0);
  expect(recalledScroll('k204')).toBe(214);
});
