// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { getCanvasNodeThumbnail } from '../components/canvas/canvasThumbnail';
import * as canvasStore from './canvasStore';
import type { CanvasNode } from '../../shared/canvas';

vi.mock('../api', () => ({
  canvasAssetUrlSync: (rel: string) => `http://localhost:3000/assets/${rel}`,
  setCanvasSelection: vi.fn(async () => undefined),
  getCanvas: vi.fn(async () => null),
}));

describe('canvasThumbnail extractor', () => {
  it('extracts thumbnail from node output assets', () => {
    const node = {
      id: 'node1',
      type: 'image',
      x: 0,
      y: 0,
      output: {
        assets: ['images/shot1.png'],
      },
    } as unknown as CanvasNode;
    expect(getCanvasNodeThumbnail(node)).toBe('http://localhost:3000/assets/images/shot1.png');
  });

  it('falls back to params imageUrl or videoUrl', () => {
    const imageNode = {
      id: 'node2',
      type: 'image',
      x: 0,
      y: 0,
      params: { imageUrl: 'https://example.com/art.jpg' },
    } as unknown as CanvasNode;
    expect(getCanvasNodeThumbnail(imageNode)).toBe('https://example.com/art.jpg');

    const videoNode = {
      id: 'node3',
      type: 'video',
      x: 0,
      y: 0,
      params: { videoUrl: 'https://example.com/clip.mp4' },
    } as unknown as CanvasNode;
    expect(getCanvasNodeThumbnail(videoNode)).toBe('https://example.com/clip.mp4');
  });

  it('returns undefined if node has no media assets or urls', () => {
    const noteNode = {
      id: 'node4',
      type: 'note',
      x: 0,
      y: 0,
      params: { content: 'hello text' },
    } as unknown as CanvasNode;
    expect(getCanvasNodeThumbnail(noteNode)).toBeUndefined();
  });
});

describe('canvasStore selection state', () => {
  it('tracks selectedNodeIdsBySession reactively', () => {
    canvasStore.setSelection('sess1', ['n1', 'n2', 'n3']);
    expect(canvasStore.getSnapshot().selectedNodeIdsBySession.sess1).toEqual(['n1', 'n2', 'n3']);

    canvasStore.deselectNode('sess1', 'n2');
    expect(canvasStore.getSnapshot().selectedNodeIdsBySession.sess1).toEqual(['n1', 'n3']);

    canvasStore.clearSelection('sess1');
    expect(canvasStore.getSnapshot().selectedNodeIdsBySession.sess1).toEqual([]);
  });
});
