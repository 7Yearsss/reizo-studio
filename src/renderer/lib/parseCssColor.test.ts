import { describe, expect, it } from 'vitest';
import { parseCssColor } from './parseCssColor';

describe('parseCssColor', () => {
  it('parses #rrggbb', () => {
    expect(parseCssColor('#faf6ee')).toEqual([
      0xfa / 255,
      0xf6 / 255,
      0xee / 255,
    ]);
  });

  it('parses #rgb', () => {
    expect(parseCssColor('#c63')).toEqual([12 / 15, 6 / 15, 3 / 15]);
  });

  it('parses rgb()', () => {
    expect(parseCssColor('rgb(194, 109, 58)')).toEqual([194 / 255, 109 / 255, 58 / 255]);
  });
});
