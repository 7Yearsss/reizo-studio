import { describe, expect, it } from 'vitest';
import { getCanvasSelection, setCanvasSelection } from './selection';

describe('canvas selection (ephemeral)', () => {
  it('stores, dedupes, caps and clears', () => {
    expect(getCanvasSelection('c1')).toEqual([]);
    setCanvasSelection('c1', ['a', 'b', 'a']);
    expect(getCanvasSelection('c1')).toEqual(['a', 'b']);
    setCanvasSelection('c1', Array.from({ length: 60 }, (_, i) => `n${i}`));
    expect(getCanvasSelection('c1')).toHaveLength(50);
    setCanvasSelection('c1', []);
    expect(getCanvasSelection('c1')).toEqual([]);
  });

  it('is per canvas', () => {
    setCanvasSelection('cA', ['x']);
    setCanvasSelection('cB', ['y']);
    expect(getCanvasSelection('cA')).toEqual(['x']);
    expect(getCanvasSelection('cB')).toEqual(['y']);
  });
});
