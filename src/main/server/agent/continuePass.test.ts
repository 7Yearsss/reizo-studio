import { describe, expect, it } from 'vitest';
import { looksLikeDeferredWork, shouldContinueAgentPass } from './continuePass';

const SCREENSHOT =
  '初步看下来，这批改动不是单纯 UI 调整，而是把权限交互从“阻塞等待”改成“抛出请求、暂停 turn、用户处理后重新发起 provider pass”，同时增加 turn outcome 持久化。这个改动风险较高，我继续核对几个关键边界：重复交互、取消/关闭窗口、错误状态处理、迁移兼容和恢复流程。';

describe('looksLikeDeferredWork', () => {
  it('flags the plan-then-stop screenshot text', () => {
    expect(looksLikeDeferredWork(SCREENSHOT)).toBe(true);
  });

  it('does not flag a finished findings reply', () => {
    expect(
      looksLikeDeferredWork('结论：权限队列在刷新后会丢 in-flight 的 done。建议在 markTurnEnd 里补一次 flush。'),
    ).toBe(false);
  });
});

describe('shouldContinueAgentPass', () => {
  it('continues when the model was truncated', () => {
    expect(shouldContinueAgentPass({ text: 'hello', finishReason: 'length' })).toBe('truncated');
  });

  it('continues while todos are still open', () => {
    expect(
      shouldContinueAgentPass({
        text: 'working',
        todos: [{ status: 'in_progress' }, { status: 'pending' }],
      }),
    ).toBe('todos');
  });

  it('continues when the last text defers the rest of the job', () => {
    expect(shouldContinueAgentPass({ text: SCREENSHOT, finishReason: 'stop' })).toBe('deferred');
  });

  it('does not continue a finished answer', () => {
    expect(
      shouldContinueAgentPass({
        text: '结论：测试 104 个全过，lint 仍失败。',
        finishReason: 'stop',
        todos: [{ status: 'completed' }],
      }),
    ).toBeNull();
  });
});
