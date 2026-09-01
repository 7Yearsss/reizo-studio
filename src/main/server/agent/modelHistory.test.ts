import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  RECENT_TOOL_RESULTS_FULL,
  clipToolOutput,
  compactAssistantParts,
  compactModelMessages,
} from './modelHistory';

describe('clipToolOutput', () => {
  it('leaves short values alone', () => {
    expect(clipToolOutput('hello')).toBe('hello');
  });

  it('annotates the omitted tail', () => {
    const clipped = clipToolOutput('abcdefghij', 4);
    expect(clipped.startsWith('abcd')).toBe(true);
    expect(clipped).toMatch(/truncated 6 chars/);
  });
});

describe('compactAssistantParts', () => {
  it('stubs tool results older than the recent window', () => {
    const parts = Array.from({ length: RECENT_TOOL_RESULTS_FULL + 2 }, (_, i) => ({
      type: 'tool' as const,
      id: `c${i}`,
      name: 'run_command',
      args: { command: `echo ${i}` },
      result: `output-${i}-${'x'.repeat(50)}`,
    }));
    const compact = compactAssistantParts(parts);
    expect(JSON.parse(compact[0].result ?? '{}')).toMatchObject({ truncated: true, tool: 'run_command' });
    expect(compact.at(-1)?.result?.startsWith('output-')).toBe(true);
  });
});

describe('compactModelMessages', () => {
  it('keeps only the newest tool results in full', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'review this' },
      {
        role: 'tool',
        content: Array.from({ length: 12 }, (_, i) => ({
          type: 'tool-result',
          toolCallId: `c${i}`,
          toolName: 'run_command',
          output: { type: 'text' as const, value: `log-${i}-${'y'.repeat(20)}` },
        })),
      } as ModelMessage,
    ];
    const compact = compactModelMessages(messages);
    const parts = (compact[1] as { content: Array<{ output: { value: unknown } }> }).content;
    expect(parts).toHaveLength(12);
    expect(parts[0].output.value).toMatchObject({ truncated: true });
    expect(parts.at(-1)?.output.value).toMatch(/^log-11-/);
  });
});
