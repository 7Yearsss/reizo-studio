import type { ChatStreamEvent } from './stream';

/**
 * Every event the chat stream emits is wrapped in a `LiveEnvelope` carrying
 * a per-session monotonic `rev` and a `epoch` that changes whenever the
 * backing `AgentSession` turn is (re)created. A client that drops the
 * connection can `GET /stream/resume?after=<rev>&epoch=<epoch>` to have the
 * gap replayed from a ring buffer, then reattach to the live turn.
 *
 * Phase 2: `event` is still the legacy `ChatStreamEvent`, and
 * `parseStreamLine` transparently unwraps it so the renderer needs no
 * change. Phase 3 formalises the envelope on the renderer side and switches
 * `event` to `AgentEvent`.
 */
export interface LiveEnvelope {
  v: 1;
  sessionId: string;
  rev: number;
  epoch: string;
  event: ChatStreamEvent;
}

export function isLiveEnvelope(value: unknown): value is LiveEnvelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<LiveEnvelope>;
  return (
    v.v === 1 &&
    typeof v.sessionId === 'string' &&
    typeof v.rev === 'number' &&
    typeof v.epoch === 'string' &&
    !!v.event &&
    typeof (v.event as { type?: unknown }).type === 'string'
  );
}

export function encodeLiveEnvelope(envelope: LiveEnvelope): string {
  return `${JSON.stringify(envelope)}\n`;
}

/**
 * Whether a gap in this event type forces a full resync (vs. being safely
 * skippable). Consumed by the renderer fence in Phase 3.
 */
export function participatesInLiveRestore(event: ChatStreamEvent): boolean {
  switch (event.type) {
    case 'text':
    case 'tool':
    case 'todos':
    case 'permission':
    case 'ask':
    case 'done':
      return true;
    case 'error':
      // Only a terminal error (one that ends the turn) must be gap-free.
      return true;
    default:
      return false;
  }
}
