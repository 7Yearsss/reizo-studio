import type { ModelMessage } from 'ai';
import type { ToolCallPart } from '../../../shared/chat';
import {
  getToolOutputBudget,
  microCompactToolResult,
  TOOL_OUTPUT_BUDGETS,
} from './microCompact';
import { estimateMessagesTokens } from './budgetTracker';

export { getToolOutputBudget, microCompactToolResult, TOOL_OUTPUT_BUDGETS };

/** Per-result cap sent to the model. UI/persistence can keep the full value. */
export const TOOL_OUTPUT_CLIP_CHARS = 8_000;
/** Older than this many tool results become a one-line stub. */
export const RECENT_TOOL_RESULTS_FULL = 8;

export function clipToolOutput(value: string, max = TOOL_OUTPUT_CLIP_CHARS): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;
}

// ---------------------------------------------------------------------------
// L2: Snip old turns. When the conversation exceeds `maxTurns` user/assistant
// pairs or estimated tokens exceed safe threshold, the oldest pairs (excluding
// the initial request) are replaced with a summarizing stub.
// ---------------------------------------------------------------------------

export const SNIP_MAX_TURNS = 30;
export const SNIP_KEEP_RECENT = 10;
export const SNIP_TOKEN_THRESHOLD = 80_000;

/**
 * Remove the oldest user/assistant turn pairs from the middle of a
 * conversation, keeping the first pair (the original request context) and
 * the `keepRecent` most recent pairs intact. Triggered either by turn count
 * or by total estimated tokens exceeding safety threshold.
 */
export function snipOldTurns(
  messages: ModelMessage[],
  maxTurns = SNIP_MAX_TURNS,
  keepRecent = SNIP_KEEP_RECENT,
  tokenThreshold = SNIP_TOKEN_THRESHOLD,
): ModelMessage[] {
  const userIndices: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'user') userIndices.push(i);
  });

  const estimatedTokens = estimateMessagesTokens(messages);
  const exceedsTurns = userIndices.length > maxTurns;
  const exceedsTokens = estimatedTokens > tokenThreshold;

  if (!exceedsTurns && !exceedsTokens) return messages;

  const snipEnd = userIndices.length - keepRecent;
  if (snipEnd <= 1) return messages; // nothing to snip

  const secondTurnStart = userIndices[1];
  const recentTurnStart = userIndices[snipEnd];

  const snipped = snipEnd - 1;
  const stub: ModelMessage = {
    role: 'user' as const,
    content: `[Earlier ${snipped} conversation turns were compacted to save context window (${estimatedTokens} estimated tokens). The key findings and tool results from those turns have been incorporated into subsequent messages.]`,
  };

  return [
    ...messages.slice(0, secondTurnStart),
    stub,
    ...messages.slice(recentTurnStart),
  ];
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
    // L1 + L3: apply micro-compact (semantic trimming + tool budget).
    return { ...part, result: microCompactToolResult(part.name, part.result) };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** L1 + L3: compact a tool-result part with smart semantic compaction. */
function clipPartOutput(part: unknown): unknown {
  if (!isRecord(part)) return part;
  if (part.type !== 'tool-result') return part;
  const toolName = typeof part.toolName === 'string' ? part.toolName : '';
  const output = part.output;
  if (typeof output === 'string') {
    return { ...part, output: microCompactToolResult(toolName, output) };
  }
  if (isRecord(output) && output.type === 'text' && typeof output.value === 'string') {
    return { ...part, output: { ...output, value: microCompactToolResult(toolName, output.value) } };
  }
  if (isRecord(output) && output.type === 'json') {
    const serialized = JSON.stringify(output.value ?? null);
    const budget = getToolOutputBudget(toolName);
    if (serialized.length <= budget) return part;
    return {
      ...part,
      output: { type: 'text', value: microCompactToolResult(toolName, serialized) },
    };
  }
  return part;
}

/**
 * Shrink tool-result payloads the AI SDK accumulated across steps. Responses
 * API turns each call/result into its own `input` item; leaving 100+ full
 * git diffs / test logs in that array is what pushed v2api.top into HTTP 524.
 *
 * Enhanced with the L1/L2 compaction layers:
 *   L1 — per-tool character budgets (grep 3k, read_file 6k, etc.)
 *   L2 — snip oldest turns when conversation exceeds SNIP_MAX_TURNS
 */
export function compactModelMessages(messages: ModelMessage[]): ModelMessage[] {
  // L2: snip old turns first.
  const snipped = snipOldTurns(messages);

  const toolResultSlots: Array<{ messageIndex: number; partIndex: number }> = [];
  snipped.forEach((message, messageIndex) => {
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

  return snipped.map((message, messageIndex) => {
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
