import { expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../shared/canvas';
vi.mock('../api', () => ({}));
vi.mock('../state/tabStore', () => ({}));
vi.mock('../state/uiStore', () => ({}));
vi.mock('./toast', () => ({}));
import { editorVersionInput } from './sendToVideoEditor';

it('captures the displayed older version independently of the active/latest version', () => {
  const node = { id: 'node', canvasId: 'canvas', title: 'video', output: { assets: ['old.mp4', 'new.mp4'], activeAssetIndex: 1, resultSet: [{ asset: 'old.mp4', assetId: 'old-id' }, { asset: 'new.mp4', assetId: 'new-id' }] } } as CanvasNode;
  const input = editorVersionInput(node, 0);
  expect(input.assetId).toBe('old-id');
  node.output = { assets: ['newer.mp4'] };
  expect(input.assetId).toBe('old-id');
});
it('guards legacy indexes with the selected path and refuses unavailable versions', () => {
  const node = { id: 'node', canvasId: 'canvas', title: 'video', output: { assets: ['old.mp4', 'new.mp4'] } } as CanvasNode;
  expect(editorVersionInput(node, 0)).toMatchObject({ sourceNodeId: 'node', assetIndex: 0, expectedPath: 'old.mp4' });
  expect(() => editorVersionInput(node, 5)).toThrow('版本不可用');
});
