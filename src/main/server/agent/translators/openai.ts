import type { AgentEvent } from '../../../../shared/agentEvent';
import { unwrapApprovalRequiredError } from '../permissions';
import { formatProviderError } from '../providerError';

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

/** Provider text fields only. Never stringify `id: 0` / numeric indexes. */
function streamText(chunk: StreamPart): string {
  for (const key of ['text', 'delta', 'textDelta'] as const) {
    const value = chunk[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

/** Structural / lifecycle chunks that are intentionally not surfaced. */
const IGNORED = new Set([
  'start',
  'start-step',
  'finish-step',
  'step-start',
  'step-finish',
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
    case 'start-step':
    case 'step-start':
      return {
        type: 'status',
        data: { phase: 'thinking', step: stepNumber(chunk.step) },
        source: 'openai',
      };

    case 'finish-step':
    case 'step-finish':
      // A finished step is not "still writing". The next useful work is
      // another think/tool pass, or the turn ends.
      return {
        type: 'status',
        data: { phase: 'thinking', step: stepNumber(chunk.step) },
        source: 'openai',
      };

    case 'finish':
      console.info(
        `[chat] provider finish reason=${String(chunk.finishReason ?? chunk.reason ?? '')}`,
      );
      return null;

    case 'text-delta': {
      const delta = streamText(chunk);
      if (!delta) return null;
      return {
        type: 'text',
        data: { delta },
        source: 'openai',
      };
    }

    case 'reasoning':
    case 'reasoning-delta': {
      const delta = streamText(chunk);
      if (!delta) return null;
      return {
        type: 'thinking',
        data: { delta },
        source: 'openai',
      };
    }

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

    case 'tool-error': {
      // A tool that needs the user's go-ahead unwinds with this sentinel.
      // Surface it as a suspend request, not a failed tool result.
      const approval = unwrapApprovalRequiredError(chunk.error);
      if (approval) {
        return {
          type: 'interaction_request',
          data: {
            id: approval.interaction.toolCallId,
            name: approval.interaction.name,
            args: approval.interaction.args,
            kind: approval.interaction.kind,
            questions: approval.interaction.questions,
          },
          source: 'openai',
        };
      }
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
    }

    case 'abort':
      return { type: 'done', data: { aborted: true }, source: 'openai' };

    case 'error':
      return {
        type: 'error',
        data: {
          message: formatProviderError(chunk.error),
          isTerminal: true,
        },
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

function stepNumber(value: unknown): number | undefined {
  const step = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(step) && step >= 0 ? step : undefined;
}
