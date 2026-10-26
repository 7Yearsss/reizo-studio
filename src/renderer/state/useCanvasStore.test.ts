import { expect, it } from 'vitest';
import type { CanvasNode } from '../../shared/canvas';
import { sameNodeIgnoringGeometry, sameNodesIgnoringGeometry } from './useCanvasStore';

const node = (patch: Partial<CanvasNode> = {}) => ({
  id: 'n', canvasId: 'c', type: 'image', x: 0, y: 0, w: 100, h: 100, title: 't', params: {}, paramsHash: null,
  runState: 'idle', output: null, updatedAt: '2026-01-01', ...patch,
}) as CanvasNode;

it('treats a live drag (x/y/w/h only) as unchanged', () => {
  const a = node();
  expect(sameNodeIgnoringGeometry(a, { ...a, x: 40, y: 8, w: 120, h: 90 })).toBe(true);
  expect(sameNodesIgnoringGeometry([a], [{ ...a, x: 5 }])).toBe(true);
});

it('still reports real changes', () => {
  const a = node();
  expect(sameNodeIgnoringGeometry(a, { ...a, title: 'other' })).toBe(false);
  expect(sameNodeIgnoringGeometry(a, { ...a, output: { assets: ['x'] } as CanvasNode['output'] })).toBe(false);
  expect(sameNodeIgnoringGeometry(a, { ...a, runState: 'running' })).toBe(false);
  expect(sameNodesIgnoringGeometry([a], [a, node({ id: 'm' })])).toBe(false);
  expect(sameNodeIgnoringGeometry(a, undefined)).toBe(false);
});
