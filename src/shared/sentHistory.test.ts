import { expect, test } from 'vitest';
import { historyStep } from './sentHistory';

const history = ['a', 'b', 'c'];

test('up walks back from the newest and stops at the oldest', () => {
  expect(historyStep(history, null, 'up')).toEqual({ cursor: 0, text: 'c' });
  expect(historyStep(history, 0, 'up')).toEqual({ cursor: 1, text: 'b' });
  expect(historyStep(history, 2, 'up')).toEqual({ cursor: 2, text: 'a' });
});

test('down walks forward and returns to an empty draft', () => {
  expect(historyStep(history, 2, 'down')).toEqual({ cursor: 1, text: 'b' });
  expect(historyStep(history, 0, 'down')).toEqual({ cursor: null, text: '' });
  expect(historyStep(history, null, 'down')).toEqual({ cursor: null, text: null });
});

test('blank entries and empty history are ignored', () => {
  expect(historyStep([], null, 'up')).toEqual({ cursor: null, text: null });
  expect(historyStep(['x', '  '], null, 'up')).toEqual({ cursor: 0, text: 'x' });
});
