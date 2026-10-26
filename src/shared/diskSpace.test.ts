import { describe, expect, it } from 'vitest';
import { diskLevel, formatBytes, nextDiskCheckMs, shouldWarnDisk } from './diskSpace';

const GB = 1024 ** 3;

describe('diskSpace', () => {
  it('grades free space', () => {
    expect(diskLevel(50 * GB)).toBe('ok');
    expect(diskLevel(4 * GB)).toBe('low');
    expect(diskLevel(0.5 * GB)).toBe('critical');
    expect(diskLevel(NaN)).toBe('ok');
  });
  it('checks more often as the disk fills', () => {
    expect(nextDiskCheckMs(50 * GB)).toBe(60 * 60_000);
    expect(nextDiskCheckMs(4 * GB)).toBe(15 * 60_000);
    expect(nextDiskCheckMs(0.5 * GB)).toBe(5 * 60_000);
  });
  it('warns only when things get worse', () => {
    expect(shouldWarnDisk('ok', 'low')).toBe(true);
    expect(shouldWarnDisk('low', 'low')).toBe(false);
    expect(shouldWarnDisk('low', 'critical')).toBe(true);
    expect(shouldWarnDisk('critical', 'low')).toBe(false);
  });
  it('formats sizes', () => {
    expect(formatBytes(2.5 * GB)).toBe('2.5 GB');
    expect(formatBytes(300 * 1024 ** 2)).toBe('300 MB');
  });
});
