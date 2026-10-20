import { describe, expect, it } from 'vitest';
import { countUpStep } from './CountingNumber';

describe('CountingNumber / countUpStep', () => {
  it('returns 0 when remaining is 0 or negative', () => {
    expect(countUpStep(0, 5, 0.5)).toBe(0);
    expect(countUpStep(-10, 5, 0.5)).toBe(0);
  });

  it('returns exact remaining on the final step (stepsLeft <= 1)', () => {
    expect(countUpStep(17, 1, 0.2)).toBe(17);
    expect(countUpStep(3, 0, 0.9)).toBe(3);
  });

  it('guarantees step does not exceed remaining even with maximum jitter', () => {
    for (let i = 0; i < 50; i++) {
      const step = countUpStep(5, 2, 1.0);
      expect(step).toBeLessThanOrEqual(5);
      expect(step).toBeGreaterThanOrEqual(1);
    }
  });

  it('calculates proportional steps for larger numbers', () => {
    const step = countUpStep(100, 5, 0.5);
    // Base is 100/5 = 20. With jitter 0.5, multiplier is 0.6 + 0.4 = 1.0 => 20.
    expect(step).toBe(20);
  });
});
