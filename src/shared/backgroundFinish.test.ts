import { expect, test } from 'vitest';
import { backgroundFinished } from './backgroundFinish';

test('reports only sessions that stopped sending out of view', () => {
  expect(backgroundFinished({ previous: { a: true, b: true, c: false }, next: { a: false, b: true, c: false }, visibleSessionId: 'z' })).toEqual(['a']);
});

test('ignores the conversation being looked at and interrupted turns', () => {
  expect(backgroundFinished({ previous: { a: true }, next: { a: false }, visibleSessionId: 'a' })).toEqual([]);
  expect(backgroundFinished({ previous: { a: true }, next: { a: false }, interrupted: new Set(['a']) })).toEqual([]);
});

test('a session that keeps sending is not finished', () => {
  expect(backgroundFinished({ previous: { a: true }, next: { a: true } })).toEqual([]);
});
