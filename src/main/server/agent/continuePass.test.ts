import { describe, expect, it } from 'vitest';
import { hasDeliveredArtifact, hitStepCap, looksLikeDeferredWork, looksLikeDeliverableRequest, shouldContinueAgentPass } from './continuePass';

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
  it('requires a confirmed successful file result before accepting delivery', () => {
    const part = { type: 'tool' as const, id: 'file', name: 'generate_file', args: {} };
    for (const result of [undefined, '', 'invalid', '{"ok":false,"artifactId":"file"}', '{"ok":true}', '{"ok":true,"artifactId":""}']) {
      expect(hasDeliveredArtifact([{ ...part, result }])).toBe(false);
    }
    const result = '{"ok":true,"artifactId":"file"}';
    expect(hasDeliveredArtifact([{ ...part, result }])).toBe(true);
    expect(hasDeliveredArtifact([{ ...part, result, error: 'failed' }])).toBe(false);
  });
  it('does not accept pasted prose as delivery of the requested TXT file', () => {
    expect(shouldContinueAgentPass({ userText: '帮我生成一个出师表的 txt', text: '以下是全文，可复制并保存为出师表.txt。当前无法直接附加 TXT 文件。', delivered: false, finishReason: 'stop' })).toBe('undelivered');
    expect(looksLikeDeliverableRequest('生成一个 README.md 文件')).toBe(true);
    expect(looksLikeDeliverableRequest('Create a TXT file with this poem')).toBe(true);
    expect(looksLikeDeliverableRequest('txt 文件和 md 文件有什么区别？')).toBe(false);
  });
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

  it('continues with undelivered when user asked for a deliverable but no artifact was produced', () => {
    expect(looksLikeDeliverableRequest('帮我生成一份2026年Q1财务预算表格')).toBe(true);
    expect(
      shouldContinueAgentPass({
        text: '好的，我已经整理好了2026年Q1预算的核心思路。',
        finishReason: 'stop',
        userText: '帮我生成一份2026年Q1财务预算表格',
        delivered: false,
      }),
    ).toBe('undelivered');
    expect(
      shouldContinueAgentPass({
        text: '已生成预算表格。',
        finishReason: 'stop',
        userText: '帮我生成一份2026年Q1财务预算表格',
        delivered: true,
      }),
    ).toBeNull();
    expect(looksLikeDeliverableRequest('怎么生成一个 Excel 公式？')).toBe(false);
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

describe('hitStepCap', () => {
  it('is true only when the pass stopped with tool calls pending', () => {
    expect(hitStepCap('tool-calls')).toBe(true);
    expect(hitStepCap('stop')).toBe(false);
    expect(hitStepCap(undefined)).toBe(false);
  });
});
