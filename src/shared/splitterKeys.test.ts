import { expect, test } from 'vitest';
import { splitterKeyWidth } from './splitterKeys';

test('left widens and right narrows, shift takes bigger steps', () => {
  expect(splitterKeyWidth(400, 'ArrowLeft', false, 320, 900)).toBe(424);
  expect(splitterKeyWidth(400, 'ArrowRight', false, 320, 900)).toBe(376);
  expect(splitterKeyWidth(400, 'ArrowLeft', true, 320, 900)).toBe(496);
});

test('clamps to limits and Home/End jump to them', () => {
  expect(splitterKeyWidth(330, 'ArrowRight', true, 320, 900)).toBe(320);
  expect(splitterKeyWidth(890, 'ArrowLeft', false, 320, 900)).toBe(900);
  expect(splitterKeyWidth(500, 'Home', false, 320, 900)).toBe(320);
  expect(splitterKeyWidth(500, 'End', false, 320, 900)).toBe(900);
});

test('other keys are ignored', () => {
  expect(splitterKeyWidth(500, 'a', false, 320, 900)).toBeNull();
});
