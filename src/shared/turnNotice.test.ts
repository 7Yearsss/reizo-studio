import { describe, expect, it } from 'vitest';
import { shouldNotifyTurnDone, turnDoneNotice } from './turnNotice';

describe('turn done notice', () => {
  it('only for long replies that finish or fail while the window is hidden', () => {
    expect(shouldNotifyTurnDone({ hidden: true, durationMs: 45_000, outcome: 'completed' })).toBe(true);
    expect(shouldNotifyTurnDone({ hidden: true, durationMs: 45_000, outcome: 'error' })).toBe(true);
    expect(shouldNotifyTurnDone({ hidden: false, durationMs: 45_000, outcome: 'completed' })).toBe(false);
    expect(shouldNotifyTurnDone({ hidden: true, durationMs: 5_000, outcome: 'completed' })).toBe(false);
    expect(shouldNotifyTurnDone({ hidden: true, durationMs: 45_000, outcome: 'interrupted' })).toBe(false);
    expect(shouldNotifyTurnDone({ hidden: true, durationMs: undefined, outcome: 'completed' })).toBe(false);
  });
  it('words the notice for the session and outcome', () => {
    expect(turnDoneNotice('周报整理', 'completed').body).toContain('周报整理');
    expect(turnDoneNotice('', 'error').title).toContain('失败');
  });
});
