import { describe, expect, it, vi } from 'vitest';
import { translateOpenAiChunk } from './openai';
import { isTerminalAgentErrorEvent } from '../../../../shared/agentEvent';

describe('translateOpenAiChunk', () => {
  it('maps text-delta to text', () => {
    expect(translateOpenAiChunk({ type: 'text-delta', text: 'hi' })).toEqual({
      type: 'text',
      data: { delta: 'hi' },
      source: 'openai',
    });
    expect(translateOpenAiChunk({ type: 'text-delta', delta: 'yo' })).toEqual({
      type: 'text',
      data: { delta: 'yo' },
      source: 'openai',
    });
  });

  it('does not stringify text-delta ids or numeric indexes as visible text', () => {
    expect(translateOpenAiChunk({ type: 'text-delta', id: '0' })).toBeNull();
    expect(translateOpenAiChunk({ type: 'text-delta', id: 0, delta: 0 })).toBeNull();
    expect(translateOpenAiChunk({ type: 'reasoning-delta', id: '0' })).toBeNull();
  });

  it('maps reasoning to thinking', () => {
    expect(translateOpenAiChunk({ type: 'reasoning', text: 'hmm' })).toMatchObject({
      type: 'thinking',
      data: { delta: 'hmm' },
    });
    expect(translateOpenAiChunk({ type: 'reasoning-delta', delta: 'more' })).toMatchObject({
      type: 'thinking',
      data: { delta: 'more' },
    });
  });

  it('maps tool-call / tool-result / tool-error', () => {
    expect(
      translateOpenAiChunk({ type: 'tool-call', toolCallId: 'c1', toolName: 'grep', input: { q: 'x' } }),
    ).toMatchObject({ type: 'tool_use', data: { id: 'c1', name: 'grep', args: { q: 'x' } } });

    expect(
      translateOpenAiChunk({
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'grep',
        input: {},
        output: { hits: 2 },
      }),
    ).toMatchObject({ type: 'tool_result', data: { id: 'c1', result: '{\n  "hits": 2\n}' } });

    expect(
      translateOpenAiChunk({
        type: 'tool-error',
        toolCallId: 'c1',
        toolName: 'grep',
        input: {},
        error: 'boom',
      }),
    ).toMatchObject({ type: 'tool_result', data: { id: 'c1', error: 'boom' } });
  });

  it('maps abort and error', () => {
    expect(translateOpenAiChunk({ type: 'abort' })).toMatchObject({ type: 'done', data: { aborted: true } });
    const err = translateOpenAiChunk({ type: 'error', error: 'nope' });
    expect(err).toMatchObject({ type: 'error', data: { message: 'nope', isTerminal: true } });
    expect(isTerminalAgentErrorEvent(err!)).toBe(true);
  });

  it('rewrites a retryable 524 APICallError instead of showing openai_error', () => {
    const error = Object.assign(new Error('openai_error'), {
      name: 'AI_APICallError',
      statusCode: 524,
      isRetryable: true,
      data: { error: { message: 'openai_error', type: 'bad_response_status_code' } },
    });
    const err = translateOpenAiChunk({ type: 'error', error });
    expect(err).toMatchObject({
      type: 'error',
      data: {
        message: '上游超时（HTTP 524）。网关在等待模型输出时断开了，可以重试。',
        isTerminal: true,
      },
    });
  });

  it('maps step lifecycle chunks to visible status events', () => {
    expect(translateOpenAiChunk({ type: 'start-step', step: 0 })).toMatchObject({
      type: 'status',
      data: { phase: 'thinking', step: 0 },
    });
    expect(translateOpenAiChunk({ type: 'finish-step', step: 0 })).toMatchObject({
      type: 'status',
      data: { phase: 'thinking', step: 0 },
    });
  });

  it('drops known structural chunks silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const type of ['start', 'text-start', 'tool-input-delta']) {
      expect(translateOpenAiChunk({ type })).toBeNull();
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('logs provider finish reason without surfacing a user event', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    expect(translateOpenAiChunk({ type: 'finish', finishReason: 'stop' })).toBeNull();
    expect(info).toHaveBeenCalledWith('[chat] provider finish reason=stop');
    info.mockRestore();
  });

  it('warns once and drops an unknown chunk type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(translateOpenAiChunk({ type: 'totally-new-thing-xyz' })).toBeNull();
    expect(translateOpenAiChunk({ type: 'totally-new-thing-xyz' })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('isTerminalAgentErrorEvent fallback', () => {
  it('explicit isTerminal wins', () => {
    expect(isTerminalAgentErrorEvent({ type: 'error', data: { isTerminal: false } })).toBe(false);
  });
  it('falls back to !willRetry', () => {
    expect(isTerminalAgentErrorEvent({ type: 'error', data: { willRetry: true } })).toBe(false);
    expect(isTerminalAgentErrorEvent({ type: 'error', data: { willRetry: false } })).toBe(true);
  });
  it('assumes terminal when nothing is set', () => {
    expect(isTerminalAgentErrorEvent({ type: 'error', data: {} })).toBe(true);
  });
  it('is false for non-error events', () => {
    expect(isTerminalAgentErrorEvent({ type: 'text', data: { delta: 'x' } })).toBe(false);
  });
});
