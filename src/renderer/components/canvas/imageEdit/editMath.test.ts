import { describe, expect, it } from 'vitest';
import { imageLineWidth, outpaintResultSize } from './editMath';

describe('imageLineWidth', () => {
  it('converts a 28px screen brush on a 2000px image shown at 500px to 112 image pixels', () => {
    expect(imageLineWidth(28, 500, 2000)).toBe(112);
  });

  it('keeps a 1:1 mapping when display matches natural size', () => {
    expect(imageLineWidth(28, 1024, 1024)).toBe(28);
  });
});

describe('outpaintResultSize', () => {
  it('adds pad on each side relative to the source', () => {
    expect(outpaintResultSize(1000, 800, { left: 0.2, right: 0.1, top: 0, bottom: 0.5 })).toEqual({
      w: 1300,
      h: 1200,
    });
  });
});
