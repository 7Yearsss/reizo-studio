import { describe, expect, it } from 'vitest';
import {
  defaultNodeBox,
  CANVAS_IMAGE_MODELS,
  CANVAS_VIDEO_MODELS,
  type CanvasNodeType,
} from '../../../shared/canvas';

describe('multi-modal canvas models and node specifications', () => {
  it('provides curated image models with default Schnell', () => {
    expect(CANVAS_IMAGE_MODELS.length).toBeGreaterThanOrEqual(4);
    const schnell = CANVAS_IMAGE_MODELS.find((m) => m.id === 'flux-schnell');
    expect(schnell).toBeDefined();
    expect(schnell?.badge).toBe('推荐');
  });

  it('provides curated video models with default Kling', () => {
    expect(CANVAS_VIDEO_MODELS.length).toBeGreaterThanOrEqual(4);
    const kling = CANVAS_VIDEO_MODELS.find((m) => m.id === 'kling-1.5');
    expect(kling).toBeDefined();
    expect(kling?.badge).toBe('默认');
  });

  it('provides default bounding boxes for all node types including note', () => {
    const types: CanvasNodeType[] = ['image', 'video', 'agent', 'note'];
    for (const t of types) {
      const box = defaultNodeBox(t);
      expect(box.w).toBeGreaterThan(100);
      expect(box.h).toBeGreaterThan(100);
    }
    expect(defaultNodeBox('note')).toEqual({ w: 280, h: 220 });
  });
});
