import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './chat';
import { isCompactBoundary, makeBoundary, messagesForModel, summarizableRange, SUMMARY_PREAMBLE } from './compactBoundary';

const msg = (id: string, role: ChatMessage['role']): ChatMessage => ({ id, role, content: id, createdAt: '2026-01-01T00:00:00Z' });
const convo = (turns: number) => Array.from({ length: turns }, (_, i) => [msg(`u${i}`, 'user'), msg(`a${i}`, 'assistant')]).flat();

describe('compact boundary', () => {
  it('without a boundary the model sees everything', () => {
    expect(messagesForModel(convo(3)).map((m) => m.id)).toEqual(['u0', 'a0', 'u1', 'a1', 'u2', 'a2']);
  });

  it('after a boundary the model sees the summary then only later messages; nothing is deleted', () => {
    const all = [...convo(3), makeBoundary({ summaryText: '用户在做预算表', summarizedToId: 'a1', source: 'manual' }, 'x'), msg('u3', 'user'), msg('a3', 'assistant')];
    const seen = messagesForModel(all);
    expect(seen.map((m) => m.id)).toEqual(['compact-boundary-x', 'u2', 'a2', 'u3', 'a3']);
    expect(seen[0].content).toBe(SUMMARY_PREAMBLE + '用户在做预算表');
    expect(all).toHaveLength(9);
  });

  it('only the last boundary counts', () => {
    const all = [
      ...convo(4),
      makeBoundary({ summaryText: 'one', summarizedToId: 'a0', source: 'manual' }, '1'),
      makeBoundary({ summaryText: 'two', summarizedToId: 'a2', source: 'auto' }, '2'),
    ];
    expect(messagesForModel(all).map((m) => m.id)).toEqual(['compact-boundary-2', 'u3', 'a3']);
  });

  it('a boundary whose anchor is missing is ignored, not trusted', () => {
    const all = [...convo(2), makeBoundary({ summaryText: 's', summarizedToId: 'gone', source: 'manual' }, 'x')];
    expect(messagesForModel(all).map((m) => m.id)).toEqual(['u0', 'a0', 'u1', 'a1']);
    expect(isCompactBoundary(all[4])).toBe(true);
  });

  it('picks what to summarise and keeps the recent turns verbatim', () => {
    expect(summarizableRange(convo(2), 2)).toBeNull();
    const range = summarizableRange(convo(5), 2)!;
    expect(range.messages.map((m) => m.id)).toEqual(['u0', 'a0', 'u1', 'a1', 'u2', 'a2']);
    expect(range.toId).toBe('a2');
  });

  it('a second compaction folds the previous summary in', () => {
    const all = [...convo(6), makeBoundary({ summaryText: 'first', summarizedToId: 'a1', source: 'manual' }, 'p')];
    const range = summarizableRange(all, 2)!;
    expect(range.messages[0].id).toBe('compact-boundary-p');
    expect(range.toId).toBe('a3');
  });
});
