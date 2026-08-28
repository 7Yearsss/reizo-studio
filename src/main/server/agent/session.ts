import type { ChatStreamEvent } from '../../../shared/stream';
import { encodeLiveEnvelope, type LiveEnvelope } from '../../../shared/liveRevision';
import {
  isTerminalAgentErrorEvent,
  type AgentDoneData,
  type AgentErrorData,
  type AgentEvent,
  type AgentTextData,
  type AgentToolResultData,
  type AgentToolUseData,
} from '../../../shared/agentEvent';
import type { SessionStore, ToolCallPart, TurnRuntimeStore } from '../../../shared/chat';
import type { LargeValueStore } from '../storage/largeValueStore';
import { createTurnPersister } from './messagePersister';
import { clearPermissionSink, setPermissionSink } from './permissions';

/**
 * Owns a session's turn lifecycle: one monotonic `turnGeneration`, one live
 * turn at a time, abort + two-tier watchdogs, a per-session monotonic
 * `liveRevision`, a ring buffer of the current turn's events, and a
 * subscriber fan-out so a dropped client can `resume` from a gap.
 */

export interface TurnWatchdogConfig {
  idleMs: number;
  stallMs: number;
  abortGraceMs: number;
}

const DEFAULT_WATCHDOG: TurnWatchdogConfig = {
  idleMs: 5 * 60_000,
  stallMs: 15 * 60_000,
  abortGraceMs: 10_000,
};

const RING_BUFFER_CAP = 500;

interface FullStreamLike {
  fullStream: AsyncIterable<{ type: string; [key: string]: unknown }>;
}

export interface StartTurnOptions {
  sessionStore: SessionStore;
  sessionId: string;
  createStream: (signal: AbortSignal) => FullStreamLike;
  translate: (chunk: { type: string; [key: string]: unknown }) => AgentEvent | null;
  onReady?: (emit: (event: ChatStreamEvent) => void) => void;
  largeValues?: LargeValueStore;
  watchdog?: Partial<TurnWatchdogConfig>;
}

export type StartTurnOutcome = 'accepted' | 'rejected-before-dispatch';

function runtimeOf(store: SessionStore): Partial<TurnRuntimeStore> {
  return store as Partial<TurnRuntimeStore>;
}

type Subscriber = (envelope: LiveEnvelope) => void;

class AgentSession {
  turnGeneration = 0;
  running = false;

  private liveRevision = 0;
  private liveRevisionLoaded = false;
  private epoch: string | null = null;
  private currentAbort: AbortController | null = null;
  private turnDone = false;
  private lastDone: LiveEnvelope | null = null;
  private ring: LiveEnvelope[] = [];
  private subscribers = new Set<Subscriber>();

  constructor(private readonly sessionId: string) {}

  abort(): boolean {
    if (!this.currentAbort) return false;
    try {
      this.currentAbort.abort();
    } catch (err) {
      console.error('[AgentSession] abort() failed', err);
    }
    return true;
  }

  private abortPrevious(): void {
    if (this.currentAbort && !this.currentAbort.signal.aborted) {
      try {
        this.currentAbort.abort();
      } catch (err) {
        console.error('[AgentSession] abortPrevious() failed', err);
      }
    }
  }

  private ensureRevisionLoaded(store: SessionStore): void {
    if (this.liveRevisionLoaded) return;
    this.liveRevisionLoaded = true;
    const state = runtimeOf(store).getRuntimeState?.(this.sessionId);
    if (state && typeof state.liveRevision === 'number' && state.liveRevision > this.liveRevision) {
      this.liveRevision = state.liveRevision;
    }
  }

  private broadcast(event: ChatStreamEvent): LiveEnvelope {
    const envelope: LiveEnvelope = {
      v: 1,
      sessionId: this.sessionId,
      rev: ++this.liveRevision,
      epoch: this.epoch ?? 'idle',
      event,
    };
    this.ring.push(envelope);
    if (this.ring.length > RING_BUFFER_CAP) this.ring.shift();
    if (event.type === 'done') {
      this.turnDone = true;
      this.lastDone = envelope;
    }
    for (const sub of this.subscribers) {
      try {
        sub(envelope);
      } catch (err) {
        console.error('[AgentSession] subscriber threw', err);
      }
    }
    return envelope;
  }

  start(options: StartTurnOptions): { outcome: StartTurnOutcome; response: Response } {
    const { sessionStore, createStream, translate } = options;
    const sessionId = this.sessionId;
    const wd: TurnWatchdogConfig = { ...DEFAULT_WATCHDOG, ...options.watchdog };
    const rt = runtimeOf(sessionStore);

    this.abortPrevious();
    this.ensureRevisionLoaded(sessionStore);
    const generation = ++this.turnGeneration;
    const epoch = `e_${Date.now().toString(36)}_${generation}`;
    this.epoch = epoch;
    this.ring = [];
    this.turnDone = false;
    this.lastDone = null;
    const abortController = new AbortController();
    this.currentAbort = abortController;
    this.running = true;

    let stream: FullStreamLike;
    try {
      stream = createStream(abortController.signal);
    } catch (err) {
      this.running = false;
      if (this.currentAbort === abortController) this.currentAbort = null;
      return {
        outcome: 'rejected-before-dispatch',
        response: Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 500 },
        ),
      };
    }

    rt.markTurnStart?.(sessionId);
    const turnId = `t_${Date.now().toString(36)}_${generation}`;
    const persister = createTurnPersister({
      sessionStore,
      sessionId,
      turnId,
      generation,
      largeValues: options.largeValues,
    });

    const isStale = () => abortController.signal.aborted || this.turnGeneration !== generation;
    const emit = (event: ChatStreamEvent) => this.broadcast(event);

    let toolsInFlight = 0;
    let idleTimer: NodeJS.Timeout | null = null;
    let stallTimer: NodeJS.Timeout | null = null;
    const trip = (reason: string) => {
      emit({ type: 'error', error: reason });
      this.abort();
    };
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer =
        toolsInFlight > 0 ? null : setTimeout(() => trip('Upstream idle timeout'), wd.idleMs);
    };
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => trip('Turn stalled'), wd.stallMs);
    };
    const clearWatchdogs = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (stallTimer) clearTimeout(stallTimer);
      idleTimer = null;
      stallTimer = null;
    };

    options.onReady?.(emit);
    setPermissionSink(sessionId, emit);
    armIdle();
    armStall();

    let aborted = false;

    const feedPersister = (event: AgentEvent) => {
      if (event.type === 'text') {
        persister.onText((event.data as AgentTextData).delta);
      } else if (event.type === 'tool_use') {
        const d = event.data as AgentToolUseData;
        persister.onToolPart({ type: 'tool', id: d.id, name: d.name, args: d.args });
      } else if (event.type === 'tool_result') {
        const d = event.data as AgentToolResultData;
        persister.onToolPart({
          type: 'tool',
          id: d.id,
          name: d.name,
          args: d.args,
          result: d.result,
          error: d.error,
        });
      }
    };

    const run = async () => {
      try {
        for await (const chunk of stream.fullStream) {
          if (isStale()) {
            aborted = true;
            break;
          }
          const event = translate(chunk);
          if (!event) continue;
          event.turnGeneration = generation;
          event.turnScope = 'turn';

          armStall();
          if (event.type === 'tool_use') {
            toolsInFlight += 1;
            if (idleTimer) {
              clearTimeout(idleTimer);
              idleTimer = null;
            }
          } else if (event.type === 'tool_result') {
            toolsInFlight = Math.max(0, toolsInFlight - 1);
            armIdle();
          } else {
            armIdle();
          }

          feedPersister(event);

          if (event.type === 'done') {
            aborted = Boolean((event.data as AgentDoneData).aborted);
            break;
          }

          const streamEvent = agentEventToStreamEvent(event);
          if (streamEvent) emit(streamEvent);

          if (event.type === 'error' && isTerminalAgentErrorEvent(event)) {
            // Terminal provider error — the SDK stream normally ends now.
          }
        }

        await persister.commit({ aborted: aborted || abortController.signal.aborted });
        emit({ type: 'done', aborted: aborted || abortController.signal.aborted });
      } catch (err) {
        if (abortController.signal.aborted || isStale()) {
          emit({ type: 'done', aborted: true });
        } else {
          emit({ type: 'error', error: err instanceof Error ? err.message : String(err) });
          emit({ type: 'done' });
        }
      } finally {
        clearWatchdogs();
        clearPermissionSink(sessionId);
        rt.markTurnEnd?.(sessionId);
        rt.setLiveRevision?.(sessionId, this.liveRevision);
        if (this.currentAbort === abortController) {
          this.currentAbort = null;
          this.running = false;
        }
      }
    };

    const body = this.streamResponse({ replayAfter: -1 });
    void run();

    abortController.signal.addEventListener('abort', () => {
      setTimeout(() => {
        if (this.currentAbort === abortController) {
          this.currentAbort = null;
          this.running = false;
        }
      }, wd.abortGraceMs);
    });

    return {
      outcome: 'accepted',
      response: body,
    };
  }

  /**
   * Build an NDJSON Response that first replays ring-buffer envelopes with
   * `rev > replayAfter`, then (if the turn is still live) subscribes for the
   * rest. If the turn has already ended it replays the tail and closes.
   */
  private streamResponse(opts: { replayAfter: number; epoch?: string }): Response {
    const encoder = new TextEncoder();
    const staleEpoch = opts.epoch !== undefined && this.epoch !== null && opts.epoch !== this.epoch;

    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let closed = false;
        const write = (envelope: LiveEnvelope) => {
          if (closed) return;
          controller.enqueue(encoder.encode(encodeLiveEnvelope(envelope)));
        };
        const close = () => {
          if (closed) return;
          closed = true;
          controller.close();
        };

        for (const envelope of this.ring) {
          if (envelope.rev > opts.replayAfter) write(envelope);
        }

        const turnLive = this.running && !this.turnDone && !staleEpoch;
        if (!turnLive) {
          if (this.lastDone && this.lastDone.rev > opts.replayAfter) {
            // already replayed above
          } else if (opts.replayAfter >= 0) {
            // Resume of a turn we no longer have buffered — synth a done so
            // the client stops waiting and falls back to getSession.
            write({
              v: 1,
              sessionId: this.sessionId,
              rev: this.liveRevision + 1,
              epoch: this.epoch ?? 'idle',
              event: { type: 'done', aborted: false },
            });
          }
          close();
          return;
        }

        const sub: Subscriber = (envelope) => {
          write(envelope);
          if (envelope.event.type === 'done') {
            this.subscribers.delete(sub);
            close();
          }
        };
        this.subscribers.add(sub);
      },
      cancel: () => {
        /* subscriber self-removes on done; a cancelled reader just stops reading */
      },
    });

    return new Response(body, {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-cache',
      },
    });
  }

  resume(opts: { after: number; epoch?: string }): Response {
    return this.streamResponse({ replayAfter: opts.after, epoch: opts.epoch });
  }
}

const sessions = new Map<string, AgentSession>();

export function getAgentSession(sessionId: string): AgentSession {
  let session = sessions.get(sessionId);
  if (!session) {
    session = new AgentSession(sessionId);
    sessions.set(sessionId, session);
  }
  return session;
}

export function abortChatTurn(sessionId: string): boolean {
  return sessions.get(sessionId)?.abort() ?? false;
}

export function startAgentTurn(options: StartTurnOptions): Response {
  return getAgentSession(options.sessionId).start(options).response;
}

export function resumeAgentTurn(sessionId: string, opts: { after: number; epoch?: string }): Response {
  return getAgentSession(sessionId).resume(opts);
}

/** Legacy `ChatStreamEvent` projection — removed in Phase 3. */
function agentEventToStreamEvent(event: AgentEvent): ChatStreamEvent | null {
  switch (event.type) {
    case 'text':
      return { type: 'text', delta: (event.data as AgentTextData).delta };
    case 'tool_result': {
      const d = event.data as AgentToolResultData;
      return { type: 'tool', id: d.id, name: d.name, args: d.args, result: d.result, error: d.error };
    }
    case 'error':
      return { type: 'error', error: (event.data as AgentErrorData).message };
    default:
      return null;
  }
}

export { agentEventToStreamEvent };
export type { ToolCallPart };
