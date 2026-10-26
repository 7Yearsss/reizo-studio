import { describe, expect, it } from 'vitest';
import { currentDateLine, expandPromptVars, formatToday } from './promptVars';

const now = new Date(2026, 9, 27, 9, 5); // Tue 27 Oct 2026, 09:05 local

describe('prompt variables', () => {
  it('formats today with the weekday', () => {
    expect(formatToday(now)).toBe('2026-10-27（周二）');
    expect(currentDateLine(now)).toContain('2026-10-27（周二） 09:05');
  });
  it('fills the known variables, case- and space-insensitively', () => {
    expect(expandPromptVars('今天是 {{date}} {{weekday}}，现在 {{ time }}，项目 {{Project}}，目录 {{workspace}}', { now, workspaceName: 'docs', projectName: '周报' }))
      .toBe('今天是 2026-10-27 周二，现在 09:05，项目 周报，目录 docs');
  });
  it('leaves unknown variables and unavailable values exactly as written', () => {
    expect(expandPromptVars('{{nope}} {{project}}', { now })).toBe('{{nope}} {{project}}');
  });
});
