// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createMaskCanvas } from './pixelOps';

describe('mask canvas export', () => {
  it('builds a same-size black canvas', () => {
    const canvas = createMaskCanvas(32, 24);
    expect(canvas.width).toBe(32);
    expect(canvas.height).toBe(24);
  });

  it('toolbar kinds include inpaint and erase', async () => {
    const { EDIT_META } = await import('../../../../shared/canvasImageEdit');
    expect(EDIT_META.inpaint.needsMask).toBe(true);
    expect(EDIT_META.erase.needsMask).toBe(true);
  });
});

