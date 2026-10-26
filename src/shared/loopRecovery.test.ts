import { describe, expect, it } from 'vitest';
import { HALTED_PREFIX, isHaltedNotice, LOOP_RECOVERY_MESSAGE } from './loopRecovery';

describe('loopRecovery', () => {
  it('recognises only the halted notice, not the stuck warning', () => {
    expect(isHaltedNotice(`${HALTED_PREFIX}同一工具连续失败`)).toBe(true);
    expect(isHaltedNotice('这一轮可能卡住了：同一工具连续失败')).toBe(false);
    expect(isHaltedNotice(null)).toBe(false);
  });
  it('the recovery message asks for a different approach', () => {
    expect(LOOP_RECOVERY_MESSAGE).toContain('换一种');
  });
});
