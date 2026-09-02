/**
 * Vendor-neutral agent event union. The `ai` SDK (and, later, other
 * harnesses) are translated into this shape by
 * `src/main/server/agent/translators/*`. In Phase 1 these events live only
 * inside `AgentSession`; the NDJSON wire still speaks the legacy
 * `ChatStreamEvent` (see `agentEventToStreamEvent`). Phase 2 wraps these in
 * a `LiveEnvelope` and puts them on the wire directly.
 */

export type AgentEventType =
  | 'text'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'tool_result_full'
  | 'status'
  | 'interaction_request'
  | 'interaction_dismissed'
  | 'turn_diff'
  | 'done'
  | 'error';

export interface AgentTextData {
  delta: string;
}

export interface AgentThinkingData {
  delta: string;
}

export interface AgentToolUseData {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentToolResultData {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
}

/**
 * The provider tried to run a tool that needs the user's go-ahead. The turn
 * has *suspended* — the provider stream for this pass has ended and no
 * provider timer is running — until every pending interaction for the
 * session is answered, after which the turn resumes with a fresh pass.
 */
export interface AgentInteractionRequestData {
  id: string;
  name: string;
  args: Record<string, unknown>;
  kind: 'permission' | 'ask';
  /** Present when `kind === 'ask'`. */
  questions?: import('./stream').AskQuestion[];
}

export interface AgentErrorData {
  message: string;
  /**
   * `false` means "the producer may still retry" (e.g. an auth retry loop) —
   * show the banner but do NOT release the running turn.
   */
  isTerminal: boolean;
  willRetry?: boolean;
}

export interface AgentDoneData {
  aborted?: boolean;
}

export interface AgentEvent {
  type: AgentEventType;
  data: unknown;
  /**
   * A completed turn's background child can emit after a newer turn started;
   * such events are still renderable but must not inherit the newer turn's
   * attribution or watchdog state.
   */
  turnScope?: 'turn' | 'background';
  /** Monotonic turn generation this event was produced under. */
  turnGeneration?: number;
  source?: 'openai';
}

/**
 * Three-tier fallback: explicit `isTerminal` → `!willRetry` → assume
 * terminal. The last default is deliberate — an old/unknown error event
 * must not leave a turn hung forever.
 */
export function isTerminalAgentErrorEvent(event: AgentEvent): boolean {
  if (event.type !== 'error') return false;
  const data = event.data as Partial<AgentErrorData> | undefined;
  if (typeof data?.isTerminal === 'boolean') return data.isTerminal;
  if (typeof data?.willRetry === 'boolean') return !data.willRetry;
  return true;
}
