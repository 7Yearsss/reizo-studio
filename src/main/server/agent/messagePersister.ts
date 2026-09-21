import { nanoid } from 'nanoid';
import type { ChatMessage, ReasoningSegment, SessionStore, ToolCallPart } from '../../../shared/chat';
import type { TurnOutcome } from '../../../shared/stream';
import type { LargeValueStore } from '../storage/largeValueStore';

/**
 * Replace an oversized string with a `{ __ref }` marker so the row doesn't
 * bloat the DB. Returns the value unchanged when it fits inline or when no
 * spill store is available. Spill failure propagates (fail-closed).
 */
export function spillField(store: LargeValueStore | undefined, value: string): string {
  if (!store) return value;
  const ref = store.maybeSpill(value);
  return ref ? JSON.stringify(ref) : value;
}

/**
 * Per-turn assistant-row accumulator. The event hot path only mutates
 * in-memory O(1) state here (append a string, upsert a tool part); the
 * single DB write happens once, at `commit`, serialized per session so
 * concurrent turns can't interleave writes.
 *
 * `clientId` is allocated on the first activity and is meant to be stamped
 * into the outgoing stream so the renderer's streaming bubble already
 * carries the final row id (replace-not-append on landing). The NDJSON wire
 * doesn't surface it yet — that's Phase 3.
 */

const commitChains = new Map<string, Promise<unknown>>();

export interface TurnPersister {
  readonly clientId: string;
  onText(delta: string): void;
  onReasoning(delta: string): void;
  onToolPart(part: ToolCallPart): void;
  hasContent(): boolean;
  /** Assistant text + tool parts accumulated so far (defensive copies). */
  snapshot(): { text: string; parts: ToolCallPart[] };
  /** Serialized append of the assistant row. No-op when aborted / empty. */
  commit(opts: { aborted: boolean; outcome?: TurnOutcome }): Promise<void>;
  /**
   * Discard accumulated state without persisting. Called on provider stream
   * crashes (HTTP 524 / mid-flight abort) so the session DB never contains a
   * half-built assistant row with orphaned tool-call stubs. Inspired by
   * Claude Code's tombstone pattern.
   */
  rollback(): void;
}

export function createTurnPersister(deps: {
  sessionStore: SessionStore;
  sessionId: string;
  turnId: string;
  generation: number;
  largeValues?: LargeValueStore;
}): TurnPersister {
  const { sessionStore, sessionId, turnId, generation, largeValues } = deps;
  const clientId = nanoid();
  let text = '';
  let reasoning = '';
  let reasoningStartedAt = 0;
  let reasoningEndedAt = 0;
  // Ordered reasoning beats: a segment opens on the first delta after a
  // non-reasoning beat (text/tool) and records the tool index it precedes, so
  // the renderer can interleave thinking rows between tool rows.
  const reasoningSegments: ReasoningSegment[] = [];
  let segmentOpen = false;
  let segmentStartedAt = 0;
  const turnStartedAt = Date.now();
  const parts: ToolCallPart[] = [];

  function closeReasoningSegment(): void {
    segmentOpen = false;
  }
  // Set when a tool finishes so the next text delta starts a new paragraph —
  // multi-pass turns otherwise concatenate every pass's prose into one wall.
  let paragraphBreak = false;

  function onToolPart(part: ToolCallPart): void {
    closeReasoningSegment();
    const existing = parts.find((p) => p.id === part.id);
    if (existing) {
      existing.name = part.name;
      existing.args = part.args;
      if (part.result !== undefined) existing.result = part.result;
      if (part.error !== undefined) existing.error = part.error;
    } else {
      parts.push({ ...part });
    }
    if (part.result !== undefined || part.error !== undefined) paragraphBreak = true;
  }

  function hasContent(): boolean {
    return text.length > 0 || parts.length > 0;
  }

  async function commit({ aborted, outcome }: { aborted: boolean; outcome?: TurnOutcome }): Promise<void> {
    if (aborted || !hasContent()) return;
    const spilledParts = parts.length
      ? parts.map((p) => ({
          ...p,
          result: p.result !== undefined ? spillField(largeValues, p.result) : undefined,
          // The turn is committing — a part that never produced a result or an
          // error (interrupt, crash mid-tool) can never finish. Marking it keeps
          // the card from rendering its pending/animating state forever.
          error:
            p.error !== undefined
              ? spillField(largeValues, p.error)
              : p.result === undefined
                ? 'interrupted'
                : undefined,
        }))
      : undefined;
    const message: ChatMessage = {
      id: nanoid(),
      clientId,
      role: 'assistant',
      content: spillField(largeValues, text),
      parts: spilledParts,
      ...(reasoning
        ? { reasoning, reasoningMs: Math.max(0, reasoningEndedAt - reasoningStartedAt) }
        : {}),
      ...(reasoningSegments.length ? { reasoningSegments } : {}),
      durationMs: Math.max(0, Date.now() - turnStartedAt),
      ...(outcome ? { turnOutcome: outcome } : {}),
      createdAt: new Date().toISOString(),
      turnId,
      generation,
    };
    const prev: Promise<unknown> = commitChains.get(sessionId) ?? Promise.resolve();
    const run = prev.then(() => sessionStore.appendMessage(sessionId, message));
    commitChains.set(sessionId, run.catch((): void => undefined));
    await run;
  }

  return {
    clientId,
    snapshot: () => ({ text, parts: parts.map((p) => ({ ...p })) }),
    onText: (delta) => {
      closeReasoningSegment();
      if (paragraphBreak && text.length > 0 && !text.endsWith('\n\n')) text += '\n\n';
      paragraphBreak = false;
      text += delta;
    },
    onReasoning: (delta) => {
      if (!reasoning) reasoningStartedAt = Date.now();
      reasoning += delta;
      reasoningEndedAt = Date.now();
      if (!segmentOpen) {
        segmentOpen = true;
        segmentStartedAt = Date.now();
        reasoningSegments.push({ text: '', beforeToolIndex: parts.length });
      }
      const segment = reasoningSegments[reasoningSegments.length - 1];
      segment.text += delta;
      segment.durationMs = Math.max(0, Date.now() - segmentStartedAt);
    },
    onToolPart,
    hasContent,
    commit,
    rollback: () => {
      text = '';
      reasoning = '';
      parts.length = 0;
    },
  };
}
