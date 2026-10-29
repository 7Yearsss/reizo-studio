import { expect, test } from 'vitest';
import { unseenCount, unseenLabel } from './unseenCount';

test('counts messages added since leaving the live edge', () => {
  expect(unseenCount(12, 10)).toBe(2);
  expect(unseenCount(10, 10)).toBe(0);
  expect(unseenCount(8, 10)).toBe(0);
});

test('caps the count and labels the cap with a plus', () => {
  expect(unseenCount(500, 0)).toBe(99);
  expect(unseenLabel(99)).toBe('99+');
  expect(unseenLabel(3)).toBe('3');
});
