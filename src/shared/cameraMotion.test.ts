import { describe, expect, it } from 'vitest';
import {
  cameraFromPreset,
  cameraSummary,
  cameraToKlingConfig,
  cameraToPrompt,
  hasCamera,
  normalizeCamera,
} from './cameraMotion';

describe('cameraFromPreset', () => {
  it('maps each legacy preset to a structured value', () => {
    expect(cameraFromPreset('zoom_in')).toEqual({ zoom: 6 });
    expect(cameraFromPreset('zoom_out')).toEqual({ zoom: -6 });
    expect(cameraFromPreset('pan_left')).toEqual({ pan: -6 });
    expect(cameraFromPreset('pan_right')).toEqual({ pan: 6 });
    expect(cameraFromPreset('orbit')).toEqual({ horizontal: 5, pan: -5 });
  });

  it('treats none / unknown / nullish as no motion', () => {
    expect(cameraFromPreset('none')).toEqual({});
    expect(cameraFromPreset('wat')).toEqual({});
    expect(cameraFromPreset(undefined)).toEqual({});
    expect(cameraFromPreset(null)).toEqual({});
  });
});

describe('normalizeCamera', () => {
  it('clamps each axis into [-10, 10] and rounds', () => {
    expect(normalizeCamera({ pan: 12, tilt: -99, zoom: 3.6 })).toEqual({ pan: 10, tilt: -10, zoom: 4 });
  });

  it('drops zero and non-finite axes', () => {
    expect(normalizeCamera({ pan: 0, tilt: Number.NaN, zoom: 5 })).toEqual({ zoom: 5 });
  });

  it('returns {} for nullish input', () => {
    expect(normalizeCamera(undefined)).toEqual({});
    expect(normalizeCamera(null)).toEqual({});
    expect(normalizeCamera({})).toEqual({});
  });

  it('singleAxis keeps only the largest-magnitude axis', () => {
    expect(normalizeCamera({ pan: 6, tilt: 3, zoom: -8 }, { singleAxis: true })).toEqual({ zoom: -8 });
  });

  it('singleAxis on empty motion returns {}', () => {
    expect(normalizeCamera({ pan: 0 }, { singleAxis: true })).toEqual({});
  });
});

describe('hasCamera', () => {
  it('is false for empty / nullish / all-zero, true for any effective axis', () => {
    expect(hasCamera(undefined)).toBe(false);
    expect(hasCamera({})).toBe(false);
    expect(hasCamera({ pan: 0, zoom: 0 })).toBe(false);
    expect(hasCamera({ tilt: -2 })).toBe(true);
  });
});

describe('cameraToPrompt', () => {
  it('returns empty string for no motion', () => {
    expect(cameraToPrompt({})).toBe('');
    expect(cameraToPrompt(undefined)).toBe('');
  });

  it('phrases direction and intensity, low magnitude = 缓慢, high = 大幅', () => {
    expect(cameraToPrompt({ pan: 2 })).toBe('镜头运动：缓慢向右摇。');
    expect(cameraToPrompt({ zoom: -9 })).toBe('镜头运动：大幅镜头拉远。');
    expect(cameraToPrompt({ tilt: 5 })).toBe('镜头运动：向上仰。');
  });

  it('joins multiple axes in CAMERA_AXES order', () => {
    expect(cameraToPrompt({ zoom: 4, pan: -6 })).toBe('镜头运动：向左摇、镜头推近。');
  });
});

describe('cameraSummary', () => {
  it('is 默认运镜 when empty', () => {
    expect(cameraSummary({})).toBe('默认运镜');
    expect(cameraSummary(null)).toBe('默认运镜');
  });

  it('lists axis label + magnitude', () => {
    expect(cameraSummary({ pan: 6, zoom: 3 })).toBe('向右摇 6 · 镜头推近 3');
  });
});

describe('cameraToKlingConfig', () => {
  it('returns undefined when there is no motion', () => {
    expect(cameraToKlingConfig({})).toBeUndefined();
    expect(cameraToKlingConfig(undefined)).toBeUndefined();
  });

  it('emits Kling simple config with a single axis', () => {
    expect(cameraToKlingConfig({ pan: 6 })).toEqual({ type: 'simple', config: { pan: 6 } });
  });

  it('reduces multi-axis input to the dominant axis', () => {
    expect(cameraToKlingConfig({ pan: 3, zoom: -8, tilt: 2 })).toEqual({
      type: 'simple',
      config: { zoom: -8 },
    });
  });

  it('clamps before emitting', () => {
    expect(cameraToKlingConfig({ tilt: 40 })).toEqual({ type: 'simple', config: { tilt: 10 } });
  });
});
