import { describe, expect, it } from 'vitest';
import { parseSavedWindowState, resolveWindowBounds } from './windowBounds';

const primary = { x: 0, y: 0, width: 1920, height: 1080 };
const second = { x: 1920, y: 0, width: 1920, height: 1080 };
const fallback = { width: 1280, height: 840 };
const min = { width: 900, height: 600 };

describe('parseSavedWindowState', () => {
  it('rejects malformed, zero-sized and absurd values', () => {
    expect(parseSavedWindowState(null)).toBeNull();
    expect(parseSavedWindowState({ x: 0, y: 0, width: 0, height: 0 })).toBeNull();
    expect(parseSavedWindowState({ x: '1', y: 0, width: 10, height: 10 })).toBeNull();
    expect(parseSavedWindowState({ x: 0, y: 0, width: 1e9, height: 10 })).toBeNull();
    expect(parseSavedWindowState({ x: 10.4, y: 5, width: 800, height: 600, maximized: true })).toEqual({ x: 10, y: 5, width: 800, height: 600, maximized: true });
  });
});

describe('resolveWindowBounds', () => {
  it('centres the default size when nothing is saved', () => {
    expect(resolveWindowBounds(null, [primary], primary, fallback, min).bounds).toEqual({ x: 320, y: 120, width: 1280, height: 840 });
  });

  it('restores a saved position and the maximized flag', () => {
    const out = resolveWindowBounds({ x: 100, y: 80, width: 1000, height: 700, maximized: true }, [primary], primary, fallback, min);
    expect(out).toEqual({ bounds: { x: 100, y: 80, width: 1000, height: 700 }, maximized: true });
  });

  it('falls back to the primary display when the saved one was unplugged', () => {
    const out = resolveWindowBounds({ x: 2200, y: 100, width: 1000, height: 700 }, [primary], primary, fallback, min);
    expect(out.bounds.x).toBeLessThan(primary.width);
    expect(out.maximized).toBe(false);
  });

  it('keeps a window on the second display when it is still there', () => {
    const out = resolveWindowBounds({ x: 2200, y: 100, width: 1000, height: 700 }, [primary, second], primary, fallback, min);
    expect(out.bounds).toEqual({ x: 2200, y: 100, width: 1000, height: 700 });
  });

  it('pulls a mostly off-screen window back and clamps oversize', () => {
    const edge = resolveWindowBounds({ x: 1500, y: 100, width: 1000, height: 700 }, [primary], primary, fallback, min);
    expect(edge.bounds.x + edge.bounds.width).toBeLessThanOrEqual(1920);
    const huge = resolveWindowBounds({ x: 0, y: 0, width: 2400, height: 1300 }, [primary], primary, fallback, min);
    expect(huge.bounds.width).toBe(1920);
    expect(huge.bounds.height).toBe(1080);
  });

  it('a title bar above the screen counts as lost', () => {
    const out = resolveWindowBounds({ x: 100, y: -900, width: 1000, height: 1000 }, [primary], primary, fallback, min);
    expect(out.bounds.y).toBeGreaterThanOrEqual(0);
  });
});
