import { expect, test } from 'vitest';
import { escapeStopStep } from './escapeStop';

test('first press arms, second within the window stops', () => {
  const first = escapeStopStep(null, 1000);
  expect(first).toEqual({ armedAt: 1000, stop: false });
  expect(escapeStopStep(first.armedAt, 1800)).toEqual({ armedAt: null, stop: true });
});

test('a late second press re-arms instead of stopping', () => {
  expect(escapeStopStep(1000, 5000)).toEqual({ armedAt: 5000, stop: false });
});
