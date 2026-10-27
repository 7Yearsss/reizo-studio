import { describe, expect, it } from 'vitest';
import { rectFromPoints, toImageRect } from './cropRect';

describe('rectFromPoints', () => {
  it('works whichever corner the drag started from', () => {
    expect(rectFromPoints({ x: 50, y: 40 }, { x: 10, y: 90 })).toEqual({ x: 10, y: 40, width: 40, height: 50 });
  });
});

describe('toImageRect', () => {
  const shown = { width: 400, height: 300 };
  const natural = { width: 2000, height: 1500 };
  it('scales a selection on the shown picture up to real pixels', () => {
    expect(toImageRect({ x: 10, y: 20, width: 100, height: 50 }, shown, natural)).toEqual({ x: 50, y: 100, width: 500, height: 250 });
  });
  it('keeps a selection that runs off the picture inside it', () => {
    expect(toImageRect({ x: -20, y: 250, width: 500, height: 200 }, shown, natural)).toEqual({ x: 0, y: 1250, width: 2000, height: 250 });
  });
  it('treats a stray click or tiny drag as no selection', () => {
    expect(toImageRect({ x: 5, y: 5, width: 1, height: 1 }, shown, natural)).toBeNull();
    expect(toImageRect({ x: 5, y: 5, width: 100, height: 100 }, { width: 0, height: 0 }, natural)).toBeNull();
  });
});
