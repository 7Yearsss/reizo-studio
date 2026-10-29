import { expect, test } from 'vitest';
import { nextRegionIndex } from './regionCycle';

test('cycles forward and backward with wrap-around', () => {
  expect(nextRegionIndex(4, 0, false)).toBe(1);
  expect(nextRegionIndex(4, 3, false)).toBe(0);
  expect(nextRegionIndex(4, 0, true)).toBe(3);
  expect(nextRegionIndex(4, 2, true)).toBe(1);
});

test('starts sensibly when nothing is focused', () => {
  expect(nextRegionIndex(4, -1, false)).toBe(0);
  expect(nextRegionIndex(4, -1, true)).toBe(3);
  expect(nextRegionIndex(0, -1, false)).toBe(-1);
});
