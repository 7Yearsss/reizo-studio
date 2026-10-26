import { describe, expect, it } from 'vitest';
import { describeCadence, isValidCadence, nextCadenceRun } from './schedule';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

describe('schedule cadence', () => {
  it('weekdays skip the weekend (2026-10-30 is a Friday)', () => {
    const c = { kind: 'weekdays', hour: 9, minute: 0 } as const;
    expect(nextCadenceRun(c, at(2026, 10, 30, 10))).toEqual(at(2026, 11, 2, 9));
    expect(nextCadenceRun(c, at(2026, 10, 30, 8))).toEqual(at(2026, 10, 30, 9));
    expect(nextCadenceRun(c, at(2026, 10, 30, 9))).toEqual(at(2026, 11, 2, 9));
  });
  it('daily and weekly', () => {
    expect(nextCadenceRun({ kind: 'daily', hour: 18, minute: 30 }, at(2026, 10, 27, 19))).toEqual(at(2026, 10, 28, 18, 30));
    expect(nextCadenceRun({ kind: 'weekly', hour: 9, minute: 0, dayOfWeek: 1 }, at(2026, 10, 27, 12))).toEqual(at(2026, 11, 2, 9));
  });
  it('validates and describes', () => {
    expect(isValidCadence({ kind: 'weekly', hour: 9, minute: 0, dayOfWeek: 1 })).toBe(true);
    expect(isValidCadence({ kind: 'weekly', hour: 9, minute: 0 })).toBe(false);
    expect(isValidCadence({ kind: 'daily', hour: 24, minute: 0 })).toBe(false);
    expect(isValidCadence({ kind: 'hourly', hour: 1, minute: 0 })).toBe(false);
    expect(describeCadence({ kind: 'weekdays', hour: 9, minute: 5 })).toBe('工作日 09:05');
    expect(describeCadence({ kind: 'weekly', hour: 9, minute: 0, dayOfWeek: 1 })).toBe('每周一 09:00');
  });
});
