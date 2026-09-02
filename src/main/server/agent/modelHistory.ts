import type { ModelMessage } from 'ai';
import type { ToolCallPart } from '../../../shared/chat';

/** Per-result cap sent to the model. UI/persistence can keep the full value. */
export const TOOL_OUTPUT_CLIP_CHARS = 8_000;
/** Older than this many tool results become a one-line stub. */
export const RECENT_TOOL_RESULTS_FULL = 8;

export function clipToolOutput(value: string, max = TOOL_OUTPUT_CLIP_CHARS): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;
}

export function compactAssistantParts(parts: ToolCallPart[]): ToolCallPart[] {
  const resultIds = parts.filter((part) => part.result).map((part) => part.id);
  const keep = new Set(resultIds.slice(-RECENT_TOOL_RESULTS_FULL));
  return parts.map((part) => {
    if (!part.result) return part;
    if (!keep.has(part.id)) {
      return {
        ...part,
        result: JSON.stringify({
          truncated: true,
          tool: part.name,
          note: 'Older tool output omitted to keep the provider request small.',
        }),
      };
    }
    return { ...part, result: clipToolOutput(part.result) };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clipPartOutput(part: unknown): unknown {
  if (!isRecord(part)) return part;
  if (part.type !== 'tool-result') return part;
  const output = part.output;
  if (typeof output === 'string') return { ...part, output: clipToolOutput(output) };
  if (isRecord(output) && output.type === 'text' && typeof output.value === 'string') {
    return { ...part, output: { ...output, value: clipToolOutput(output.value) } };
  }
  if (isRecord(output) && output.type === 'json') {
    const serialized = JSON.stringify(output.value ?? null);
    if (serialized.length <= TOOL_OUTPUT_CLIP_CHARS) return part;
    return {
      ...part,
      output: { type: 'text', value: clipToolOutput(serialized) },
    };
  }
  return part;
}

/**
 * Shrink tool-result payloads the AI SDK accumulated across steps. Responses
 * API turns each call/result into its own `input` item; leaving 100+ full
 * git diffs / test logs in that array is what pushed v2api.top into HTTP 524.
 */
export function compactModelMessages(messages: ModelMessage[]): ModelMessage[] {
  const toolResultSlots: Array<{ messageIndex: number; partIndex: number }> = [];
  messages.forEach((message, messageIndex) => {
    if (message.role !== 'tool' || !Array.isArray(message.content)) return;
    const parts = message.content as unknown[];
    parts.forEach((part, partIndex) => {
      if (isRecord(part) && part.type === 'tool-result') {
        toolResultSlots.push({ messageIndex, partIndex });
      }
    });
  });
  const keepFrom = Math.max(0, toolResultSlots.length - RECENT_TOOL_RESULTS_FULL);
  const stub = new Set(toolResultSlots.slice(0, keepFrom).map((slot) => `${slot.messageIndex}:${slot.partIndex}`));

  return messages.map((message, messageIndex) => {
    if (message.role !== 'tool' || !Array.isArray(message.content)) return message;
    const parts = message.content as unknown[];
    const content = parts.map((part, partIndex) => {
      if (stub.has(`${messageIndex}:${partIndex}`)) {
        const name = isRecord(part) && typeof part.toolName === 'string' ? part.toolName : 'tool';
        return {
          type: 'tool-result',
          toolCallId: isRecord(part) ? part.toolCallId : undefined,
          toolName: name,
          output: {
            type: 'json',
            value: {
              truncated: true,
              tool: name,
              note: 'Older tool output omitted to keep the provider request small.',
            },
          },
        };
      }
      return clipPartOutput(part);
    });
    return { ...message, content } as ModelMessage;
  });
}
