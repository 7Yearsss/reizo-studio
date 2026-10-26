import { describe, expect, it } from 'vitest';
import { describeBackground, formatElapsed } from './backgroundTasks';

describe('backgroundTasks', () => {
  it('formats elapsed time', () => {
    expect(formatElapsed(5_000)).toBe('5 秒');
    expect(formatElapsed(125_000)).toBe('2 分钟');
    expect(formatElapsed(3_900_000)).toBe('1 小时 5 分钟');
  });
  it('shows nothing when nothing runs, and counts only running ones', () => {
    expect(describeBackground([], 0)).toBeNull();
    expect(describeBackground([{ command: 'x', running: false, startedAt: 0 }], 10)).toBeNull();
    const out = describeBackground([{ command: 'npm run dev', running: true, startedAt: 0 }, { command: 'old', running: false, startedAt: 0 }], 90_000);
    expect(out?.label).toBe('1 个后台任务运行中');
    expect(out?.detail).toBe('npm run dev（1 分钟）');
  });
  it('shortens long commands in the detail', () => {
    const out = describeBackground([{ command: 'x'.repeat(100), running: true, startedAt: 0 }], 1000);
    expect(out?.detail).toContain('…');
  });
});
