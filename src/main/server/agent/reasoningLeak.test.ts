import { describe, expect, it } from 'vitest';
import { hasReasoningLeak, isMostlyCjk } from './reasoningLeak';

describe('hasReasoningLeak', () => {
  const userText = '帮我检查文档一致性';
  it('flags an English reasoning sentence inside a Chinese reply', () => {
    const reply = '我将提议编号修复。 The user requested a full consistency check. 全文只发现一处问题。';
    expect(hasReasoningLeak({ userText, reply })).toBe(true);
  });
  it('ignores a clean Chinese reply', () => {
    expect(hasReasoningLeak({ userText, reply: '全文只发现一处问题：序号写成「3.」。' })).toBe(false);
  });
  it('ignores English replies to English users', () => {
    expect(hasReasoningLeak({ userText: 'check the doc', reply: 'The user requested a check, so I did it.' })).toBe(false);
  });
  it('does not flag Chinese replies that merely quote English terms', () => {
    expect(hasReasoningLeak({ userText, reply: '已把 expectedVersion 设为 20，并提交了 propose_document_edits。' })).toBe(false);
  });
});

describe('isMostlyCjk', () => {
  it('judges by letters, not digits or punctuation', () => {
    expect(isMostlyCjk('第 1 章，共 20 页。')).toBe(true);
    expect(isMostlyCjk('Hello 世')).toBe(false);
  });
});
