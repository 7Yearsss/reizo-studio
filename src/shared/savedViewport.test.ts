import { expect, test } from 'vitest';
import { parseSavedViewport } from './savedViewport';

test('reads a stored viewport and clamps zoom', () => {
  expect(parseSavedViewport('{"x":10,"y":-5,"zoom":1.5}')).toEqual({ x: 10, y: -5, zoom: 1.5 });
  expect(parseSavedViewport('{"x":0,"y":0,"zoom":99}')?.zoom).toBe(3);
  expect(parseSavedViewport('{"x":0,"y":0,"zoom":0.001}')?.zoom).toBe(0.05);
});

test('rejects missing or malformed values', () => {
  for (const raw of [null, undefined, '', 'nope', '{}', '{"x":1,"y":2,"zoom":0}', '{"x":"1","y":2,"zoom":1}', 'null']) {
    expect(parseSavedViewport(raw as string | null)).toBeNull();
  }
});
