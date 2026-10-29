import { expect, test } from 'vitest';
import { nextFollowState } from './followState';

const base = { threshold: 56 };

test('reaching the end always re-engages following', () => {
  expect(nextFollowState({ ...base, following: false, distanceFromEnd: 10, msSinceUserIntent: 99999 })).toBe(true);
});

test('moving away right after user intent releases following', () => {
  expect(nextFollowState({ ...base, following: true, distanceFromEnd: 400, msSinceUserIntent: 100 })).toBe(false);
});

test('moving away with no user intent (layout shift) keeps following', () => {
  expect(nextFollowState({ ...base, following: true, distanceFromEnd: 400, msSinceUserIntent: 5000 })).toBe(true);
});

test('stays released until the user returns to the end', () => {
  expect(nextFollowState({ ...base, following: false, distanceFromEnd: 400, msSinceUserIntent: 5000 })).toBe(false);
});
