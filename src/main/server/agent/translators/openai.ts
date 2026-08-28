import type { AgentEvent } from '../../../../shared/agentEvent';

/**
 * Translates one `ai` SDK `fullStream` chunk into a vendor-neutral
 * `AgentEvent`, or `null` when the chunk carries no user-facing meaning.
 * Unknown chunk types are logged once and dropped — never forwarded (a
 * consumer's default case just returns state, so pushing it downstream is
 * pure waste).
 */

type StreamPart = { type: string; [key: string]: unknown };

const warned = new Set<string>();

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    const cause = (value as { cause?: unknown }).cause;
    return value.message
      ? `${value.message}${cause ? `\n${stringify(cause)}` : ''}`
      : value.name || String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

/** Structural / lifecycle chunks that are intentionally not surfaced. */
const IGNORED = new Set([
  'start',
  'finish',
  'start-step',
  'finish-step',
  'step-start',
  'reset-step',
  'text-start',
  'text-end',
  'reasoning-start',
  'reasoning-end',
  'tool-input-start',
  'tool-input-delta',
  'tool-input-end',
  'tool-input-available',
  'tool-input-error',
  'raw',
  'response-metadata',
  'message-metadata',
  'model-call-start',
  'model-call-end',
  'model-call-response-metadata',
  'finish-reason',
  'file',
  'source',
]);

export function translateOpenAiChunk(chunk: StreamPart): AgentEvent | null {
  switch (chunk.type) {
    case 'text-delta':
      return { type: 'text', data: { delta: String(chunk.text ?? '') }, source: 'openai' };

    case 'reasoning':
    case 'reasoning-delta':
      return {
        type: 'thinking',
        data: { delta: String(chunk.text ?? chunk.delta ?? '') },
        source: 'openai',
      };

    case 'tool-call':
      return {
        type: 'tool_use',
        data: {
          id: String(chunk.toolCallId ?? ''),
          name: String(chunk.toolName ?? ''),
          args: asRecord(chunk.input),
        },
        source: 'openai',
      };

    case 'tool-result':
      return {
        type: 'tool_result',
        data: {
          id: String(chunk.toolCallId ?? ''),
          name: String(chunk.toolName ?? ''),
          args: asRecord(chunk.input),
          result: stringify(chunk.output),
        },
        source: 'openai',
      };

    case 'tool-error':
      return {
        type: 'tool_result',
        data: {
          id: String(chunk.toolCallId ?? ''),
          name: String(chunk.toolName ?? ''),
          args: asRecord(chunk.input),
          error: stringify(chunk.error),
        },
        source: 'openai',
      };

    case 'abort':
      return { type: 'done', data: { aborted: true }, source: 'openai' };

    case 'error':
      return {
        type: 'error',
        data: { message: stringify(chunk.error), isTerminal: true },
        source: 'openai',
      };

    default:
      if (!IGNORED.has(chunk.type) && !warned.has(chunk.type)) {
        warned.add(chunk.type);
        console.warn('[translator/openai] unmapped chunk type:', chunk.type);
      }
      return null;
  }
}
