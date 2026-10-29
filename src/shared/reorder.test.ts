import { expect, test } from 'vitest';
import { moveItem } from './reorder';

test('moves left and right', () => {
  expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
  expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
});

test('clamps at the ends and returns the same array when nothing moves', () => {
  const list = ['a', 'b'];
  expect(moveItem(list, 0, -1)).toBe(list);
  expect(moveItem(list, 1, 1)).toBe(list);
  expect(moveItem(list, 5, 1)).toBe(list);
});
