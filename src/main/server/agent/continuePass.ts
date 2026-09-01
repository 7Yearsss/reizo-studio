import type { TodoItem } from '../../../shared/stream';

/** Extra provider passes after the model first stops with text. Bounded. */
export const MAX_CONTINUE_PASSES = 2;

export const CONTINUE_USER_MESSAGE =
  'Continue. The previous assistant message did not finish the user request. Use tools as needed and deliver the remaining findings now. Do not only restate the plan.';

export type ContinueReason = 'truncated' | 'todos' | 'deferred';

/**
 * Harness-side stop check. Other agents (Claude Code, Cline, Cindy) do not
 * treat "the model returned text" as "the product turn is done" when the
 * work is still open — truncated output, open todos, or a plan that defers
 * the rest of the job. That decision lives in code, not in the system prompt.
 */
export function shouldContinueAgentPass(input: {
  text: string;
  todos?: Pick<TodoItem, 'status'>[];
  finishReason?: string;
}): ContinueReason | null {
  const reason = (input.finishReason ?? '').toLowerCase();
  if (reason === 'length' || reason === 'max_tokens') return 'truncated';
  if (input.todos?.some((item) => item.status === 'pending' || item.status === 'in_progress')) {
    return 'todos';
  }
  if (looksLikeDeferredWork(input.text)) return 'deferred';
  return null;
}

/** The model announced more work instead of doing it. */
export function looksLikeDeferredWork(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 30) return false;
  const defers =
    /我继续|接下来(?:会|我|去)|我再(?:去|核对|检查|看)|初步看|随后会|I(?:'ll| will) (?:continue|check|look|verify|inspect)|let me (?:continue|keep checking|check)/i;
  const concludes = /结论[:：]|总结[:：]|发现如下|修复如下|已完成以下|here's what i found|in conclusion/i;
  return defers.test(trimmed) && !concludes.test(trimmed);
}
