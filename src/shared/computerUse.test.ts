import { describe, expect, it } from 'vitest';
import {
  ComputerInputSchema,
  clampPoint,
  normalizeHotkey,
  summarizeComputerAction,
} from './computerUse';

describe('ComputerInputSchema', () => {
  it('accepts a bare screenshot action', () => {
    expect(ComputerInputSchema.parse({ action: 'screenshot' })).toEqual({ action: 'screenshot' });
  });

  it('accepts a click with an explicit point', () => {
    const parsed = ComputerInputSchema.parse({ action: 'left_click', x: 10, y: 20 });
    expect(parsed).toMatchObject({ action: 'left_click', x: 10, y: 20 });
  });

  it('accepts a click with no point (uses current cursor)', () => {
    expect(ComputerInputSchema.parse({ action: 'double_click' })).toEqual({ action: 'double_click' });
  });

  it('requires a direction for scroll', () => {
    expect(() => ComputerInputSchema.parse({ action: 'scroll' })).toThrow();
    expect(ComputerInputSchema.parse({ action: 'scroll', direction: 'down' })).toMatchObject({
      direction: 'down',
    });
  });

  it('rejects empty type text', () => {
    expect(() => ComputerInputSchema.parse({ action: 'type', text: '' })).toThrow();
  });

  it('rejects an unknown action', () => {
    expect(() => ComputerInputSchema.parse({ action: 'teleport' })).toThrow();
  });

  it('clamps wait ms to the allowed range', () => {
    expect(() => ComputerInputSchema.parse({ action: 'wait', ms: 99_999 })).toThrow();
  });
});

describe('clampPoint', () => {
  const size = { width: 1920, height: 1080 };

  it('keeps an in-bounds point', () => {
    expect(clampPoint({ x: 100, y: 200 }, size)).toEqual({ x: 100, y: 200 });
  });

  it('clamps past the right/bottom edge to the last pixel', () => {
    expect(clampPoint({ x: 5000, y: 5000 }, size)).toEqual({ x: 1919, y: 1079 });
  });

  it('clamps negatives to zero and rounds', () => {
    expect(clampPoint({ x: -3, y: 12.7 }, size)).toEqual({ x: 0, y: 13 });
  });

  it('survives a zero-sized display', () => {
    expect(clampPoint({ x: 10, y: 10 }, { width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('normalizeHotkey', () => {
  it('canonicalizes modifier aliases and ordering', () => {
    expect(normalizeHotkey('Cmd+Shift+S')).toBe('shift+meta+S');
    expect(normalizeHotkey('Control+ a')).toBe('ctrl+a');
    expect(normalizeHotkey('option+Tab')).toBe('alt+Tab');
  });

  it('preserves the casing of the final named key', () => {
    expect(normalizeHotkey('ctrl+Return')).toBe('ctrl+Return');
    expect(normalizeHotkey('F5')).toBe('F5');
  });

  it('returns empty for junk', () => {
    expect(normalizeHotkey('  +  ')).toBe('');
  });
});

describe('summarizeComputerAction', () => {
  it('describes a click with a point', () => {
    expect(summarizeComputerAction({ action: 'left_click', x: 3, y: 4 })).toContain('(3, 4)');
  });

  it('describes a pointless click as current position', () => {
    expect(summarizeComputerAction({ action: 'left_click' })).toContain('当前位置');
  });

  it('truncates long typed text', () => {
    const text = 'x'.repeat(80);
    expect(summarizeComputerAction({ action: 'type', text })).toContain('…');
  });
});
