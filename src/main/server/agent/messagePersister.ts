import { nanoid } from 'nanoid';
import type { ChatMessage, SessionStore, ToolCallPart } from '../../../shared/chat';
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
  /** Serialized append of the assistant row. No-op when aborted / empty. */
  commit(opts: { aborted: boolean }): Promise<void>;
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
  const parts: ToolCallPart[] = [];

  function onToolPart(part: ToolCallPart): void {
    const existing = parts.find((p) => p.id === part.id);
    if (existing) {
      existing.name = part.name;
      existing.args = part.args;
      if (part.result !== undefined) existing.result = part.result;
      if (part.error !== undefined) existing.error = part.error;
    } else {
      parts.push({ ...part });
    }
  }

  function hasContent(): boolean {
    return text.length > 0 || parts.length > 0;
  }

  async function commit({ aborted }: { aborted: boolean }): Promise<void> {
    if (aborted || !hasContent()) return;
    const spilledParts = parts.length
      ? parts.map((p) => ({
          ...p,
          result: p.result !== undefined ? spillField(largeValues, p.result) : undefined,
          error: p.error !== undefined ? spillField(largeValues, p.error) : undefined,
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
    onText: (delta) => {
      text += delta;
    },
    onReasoning: (delta) => {
      if (!reasoning) reasoningStartedAt = Date.now();
      reasoning += delta;
      reasoningEndedAt = Date.now();
    },
    onToolPart,
    hasContent,
    commit,
  };
}
