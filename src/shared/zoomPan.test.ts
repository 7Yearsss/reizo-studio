import { expect, test } from 'vitest';
import { clampZoom, exceedsPanThreshold, offsetForZoom, zoomByWheel, ZOOM_MAX, ZOOM_MIN } from './zoomPan';

test('wheel zooms in fixed steps within 0.25–4', () => {
  expect(zoomByWheel(1, -100)).toBe(1.25);
  expect(zoomByWheel(1, 100)).toBe(0.75);
  expect(zoomByWheel(ZOOM_MAX, -100)).toBe(ZOOM_MAX);
  expect(zoomByWheel(ZOOM_MIN, 100)).toBe(ZOOM_MIN);
  expect(zoomByWheel(2, 0)).toBe(2);
  expect(clampZoom(99)).toBe(ZOOM_MAX);
});

test('zooming keeps the point under the cursor fixed', () => {
  const cursor = { x: 100, y: 40 };
  const next = offsetForZoom({ x: 0, y: 0 }, cursor, 1, 2);
  // image point under cursor before: cursor/1; after: (cursor - next)/2 — must match
  expect((cursor.x - next.x) / 2).toBeCloseTo(cursor.x);
  expect((cursor.y - next.y) / 2).toBeCloseTo(cursor.y);
  expect(offsetForZoom({ x: 5, y: 5 }, cursor, 1, 1)).toEqual({ x: 5, y: 5 });
});

test('small movements are clicks, not pans', () => {
  expect(exceedsPanThreshold(2, 2)).toBe(false);
  expect(exceedsPanThreshold(4, 4)).toBe(true);
});
