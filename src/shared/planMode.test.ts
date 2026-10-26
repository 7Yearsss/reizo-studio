import { describe, expect, it } from 'vitest';
import { ceilingWithPlanMode, PLAN_MODE_NOTICE } from './planMode';
import { applyRunCeiling } from '../main/server/agent/runCeiling';

describe('plan mode', () => {
  it('forces a read-only ceiling, whatever the run had', () => {
    expect(ceilingWithPlanMode(undefined, true)).toBe('readonly');
    expect(ceilingWithPlanMode('workspace', true)).toBe('readonly');
    expect(ceilingWithPlanMode('workspace', false)).toBe('workspace');
    expect(ceilingWithPlanMode(undefined, false)).toBeUndefined();
  });

  it('before the plan is confirmed every write, shell, computer and external tool is gone; reading and planning stay', () => {
    const tools = { read_file: 1, grep: 1, todo_write: 1, ask_user: 1, write_file: 1, edit_file: 1, run_command: 1, computer: 1, create_schedule: 1, generate_image: 1, mcp__x__y: 1, http_fetch: 1 };
    const left = Object.keys(applyRunCeiling(tools, ceilingWithPlanMode(undefined, true) as 'readonly')).sort();
    expect(left).toEqual(['ask_user', 'grep', 'read_file', 'todo_write']);
  });

  it('tells the model to plan, not act', () => {
    expect(PLAN_MODE_NOTICE).toContain('numbered plan');
    expect(PLAN_MODE_NOTICE).toContain('todo_write');
  });
});
