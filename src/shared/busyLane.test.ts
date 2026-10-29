import { expect, test } from 'vitest';
import { activeBusyLane } from './busyLane';

test('without the modifier the preference wins', () => {
  expect(activeBusyLane('queue', false)).toBe('queue');
  expect(activeBusyLane('steer', false)).toBe('steer');
});

test('holding the modifier takes the opposite lane', () => {
  expect(activeBusyLane('queue', true)).toBe('steer');
  expect(activeBusyLane('steer', true)).toBe('queue');
});
