import { expect, test } from 'vitest';
import { parseAnchors, pickAnchor, withAnchor } from './readingAnchor';

test('picks the first message still in view and its offset', () => {
  const rects = [
    { id: 'a', top: -300, bottom: -20 },
    { id: 'b', top: -20, bottom: 180 },
    { id: 'c', top: 180, bottom: 400 },
  ];
  expect(pickAnchor(rects, 0, false)).toEqual({ messageId: 'b', offset: -20 });
});

test('nothing is remembered at the live edge or with no visible message', () => {
  expect(pickAnchor([{ id: 'a', top: 0, bottom: 50 }], 0, true)).toBeNull();
  expect(pickAnchor([{ id: 'a', top: -80, bottom: -10 }], 0, false)).toBeNull();
});

test('set, replace and clear one session without touching the others', () => {
  let a = withAnchor({}, 's1', { messageId: 'm1', offset: 12.4 });
  a = withAnchor(a, 's2', { messageId: 'm2', offset: 0 });
  expect(a.s1).toEqual({ messageId: 'm1', offset: 12 });
  a = withAnchor(a, 's1', null);
  expect(Object.keys(a)).toEqual(['s2']);
});

test('keeps only the most recently touched sessions', () => {
  let a: ReturnType<typeof withAnchor> = {};
  for (let i = 0; i < 70; i++) a = withAnchor(a, `s${i}`, { messageId: 'm', offset: 0 });
  expect(Object.keys(a).length).toBe(60);
  expect(a.s0).toBeUndefined();
  expect(a.s69).toBeDefined();
});

test('malformed storage is ignored', () => {
  expect(parseAnchors(null)).toEqual({});
  expect(parseAnchors('nope')).toEqual({});
  expect(parseAnchors(JSON.stringify({ s: { messageId: 1 }, t: { messageId: 'x', offset: 5 } }))).toEqual({ t: { messageId: 'x', offset: 5 } });
});
