import type { ChatStreamEvent, TurnOutcome } from '../../../shared/stream';
import { encodeLiveEnvelope, type LiveEnvelope } from '../../../shared/liveRevision';
import {
  type AgentDoneData,
  type AgentErrorData,
  type AgentEvent,
  type AgentInteractionRequestData,
  type AgentTextData,
  type AgentThinkingData,
  type AgentToolResultData,
  type AgentToolUseData,
  isTerminalAgentErrorEvent,
} from '../../../shared/agentEvent';
import { formatProviderError } from './providerError';
import type { SessionStore, ToolCallPart, TurnRuntimeStore } from '../../../shared/chat';
import type { LargeValueStore } from '../storage/largeValueStore';
import { createTurnPersister } from './messagePersister';
import { clearPermissionSink, setPermissionSink, type PendingInteractionInfo } from './permissions';

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
  /** Keep the live HTTP stream from looking dead during thinking / approval. */
  heartbeatMs: number;
}

const DEFAULT_WATCHDOG: TurnWatchdogConfig = {
  idleMs: 5 * 60_000,
  stallMs: 15 * 60_000,
  abortGraceMs: 10_000,
  heartbeatMs: 15_000,
};

const RING_BUFFER_CAP = 500;

interface FullStreamLike {
  fullStream: AsyncIterable<{ type: string; [key: string]: unknown }>;
  finishReason?: PromiseLike<string | undefined>;
}

export interface AwaitingInteractionContext {
  sessionId: string;
  /** The turn's abort signal — abandon the resume if it fires. */
  signal: AbortSignal;
  /** Interactions raised during the pass that just ended. */
  pending: PendingInteractionInfo[];
  /**
   * Feed one resolved tool result into the turn: persists it onto the pending
   * assistant row, emits the `tool` stream event so the renderer's row
   * completes, and folds it into the snapshot returned by `getAssistant`.
   */
  emitToolResult: (result: {
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
    result?: string;
    error?: string;
  }) => void;
  getAssistant: () => { text: string; parts: ToolCallPart[] };
}

export interface StartTurnOptions {
  sessionStore: SessionStore;
  sessionId: string;
  createStream: (signal: AbortSignal) => FullStreamLike;
  translate: (chunk: { type: string; [key: string]: unknown }) => AgentEvent | null;
  onReady?: (emit: (event: ChatStreamEvent) => void) => void;
  largeValues?: LargeValueStore;
  watchdog?: Partial<TurnWatchdogConfig>;
  /**
   * Called when a pass ends because a tool needs the user. Returns the next
   * provider stream to fold into the *same* turn once the user has answered
   * and any approved tools have run, or `null` to finish the turn here. While
   * this promise is pending the turn is suspended with every provider timer
   * cleared — human think-time is never inside a provider step budget.
   */
  onAwaitingInteraction?: (ctx: AwaitingInteractionContext) => Promise<FullStreamLike | null>;
  /**
   * Called when a provider pass ended with text (no pending interaction).
   * Return another stream to keep the *same* product turn running — this is
   * the outer agent loop other harnesses use so "I'll continue checking"
   * is not treated as a finished answer.
   */
  onContinuePass?: (ctx: {
    signal: AbortSignal;
    getAssistant: () => { text: string; parts: ToolCallPart[] };
    finishReason?: string;
    passIndex: number;
  }) => Promise<FullStreamLike | null>;
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
  /** Why the current turn's abort signal fired. `null` = provider/transport. */
  private abortReason: 'user' | 'watchdog' | null = null;
  private turnDone = false;
  private lastDone: LiveEnvelope | null = null;
  private ring: LiveEnvelope[] = [];
  private subscribers = new Set<Subscriber>();

  constructor(private readonly sessionId: string) {}

  abort(): boolean {
    if (!this.currentAbort) return false;
    // `trip()` sets 'watchdog' just before calling this; don't clobber it.
    if (!this.abortReason) this.abortReason = 'user';
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
    this.abortReason = null;
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
    const turnStartedAt = Date.now();
    console.info(`[chat] provider stream started session=${sessionId} turn=${turnId}`);
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
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let lastPhase: 'thinking' | 'tools' | 'replying' | 'waiting' = 'thinking';
    let terminalError: string | undefined;
    let errorEmitted = false;
    let finalOutcome: TurnOutcome = 'error';
    let endMarked = false;
    const markEnd = () => {
      if (endMarked) return;
      endMarked = true;
      rt.markTurnEnd?.(sessionId, finalOutcome, terminalError);
      const snap = persister.snapshot();
      console.info(
        `[chat] turn terminal session=${sessionId} turn=${turnId} outcome=${finalOutcome} durationMs=${Date.now() - turnStartedAt} tools=${snap.parts.length} textChars=${snap.text.length}${terminalError ? ` error=${terminalError}` : ''}`,
      );
    };
    let watchdogsPaused = false;
    const trip = (reason: string) => {
      if (watchdogsPaused) return;
      terminalError = reason;
      emit({ type: 'error', error: reason });
      errorEmitted = true;
      this.abortReason = 'watchdog';
      this.abort();
    };
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer =
        watchdogsPaused || toolsInFlight > 0
          ? null
          : setTimeout(() => trip('Upstream idle timeout'), wd.idleMs);
    };
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = watchdogsPaused ? null : setTimeout(() => trip('Turn stalled'), wd.stallMs);
    };
    const clearWatchdogs = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (stallTimer) clearTimeout(stallTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      idleTimer = null;
      stallTimer = null;
      heartbeatTimer = null;
    };
    const notePhase = (phase: typeof lastPhase) => {
      lastPhase = phase;
    };
    const armHeartbeat = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = wd.heartbeatMs > 0
        ? setInterval(() => {
            if (this.turnDone || isStale()) return;
            emit({ type: 'status', phase: lastPhase, heartbeat: true });
          }, wd.heartbeatMs)
        : null;
    };
    /**
     * The turn is parked on the user (permission / question). No provider
     * connection is open, so nothing can hang — silence the watchdogs until
     * the resumed pass starts.
     */
    const pauseWatchdogs = () => {
      watchdogsPaused = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (stallTimer) clearTimeout(stallTimer);
      idleTimer = null;
      stallTimer = null;
    };
    const resumeWatchdogs = () => {
      watchdogsPaused = false;
      armIdle();
      armStall();
      if (!heartbeatTimer) armHeartbeat();
    };

    options.onReady?.(emit);
    setPermissionSink(sessionId, emit);
    emit({ type: 'status', phase: 'thinking' });
    armIdle();
    armStall();
    armHeartbeat();

    let aborted = false;

    const feedPersister = (event: AgentEvent) => {
      if (event.type === 'text') {
        persister.onText((event.data as AgentTextData).delta);
      } else if (event.type === 'thinking') {
        persister.onReasoning((event.data as AgentThinkingData).delta);
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

    const emitToolResult = (r: {
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
      result?: string;
      error?: string;
    }) => {
      const event: AgentEvent = {
        type: 'tool_result',
        data: { id: r.toolCallId, name: r.name, args: r.args, result: r.result, error: r.error },
        source: 'openai',
        turnGeneration: generation,
        turnScope: 'turn',
      };
      feedPersister(event);
      const streamEvent = agentEventToStreamEvent(event);
      if (streamEvent) emit(streamEvent);
    };

    const run = async () => {
      try {
        let currentStream: FullStreamLike = stream;
        let continuePassIndex = 0;
        // One iteration = one provider pass. A pass that ends because a tool
        // needs the user suspends here (watchdogs paused, no connection open)
        // and folds the resumed provider stream back into the same turn.
        // After a clean text stop, onContinuePass may open another pass so
        // a plan-then-stop does not settle the product turn.
        for (;;) {
          let awaiting: PendingInteractionInfo[] | null = null;

          for await (const chunk of currentStream.fullStream) {
            if (isStale()) {
              aborted = true;
              break;
            }
            const event = translate(chunk);
            if (!event) continue;
            event.turnGeneration = generation;
            event.turnScope = 'turn';

            if (event.type === 'interaction_request') {
              toolsInFlight = Math.max(0, toolsInFlight - 1);
              const d = event.data as AgentInteractionRequestData;
              (awaiting ??= []).push({
                toolCallId: d.id,
                name: d.name,
                args: d.args,
                kind: d.kind,
                questions: d.questions,
              });
              continue;
            }

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

            if (event.type === 'error') {
              if (isTerminalAgentErrorEvent(event)) {
                terminalError = (event.data as AgentErrorData).message;
              } else {
                notePhase('thinking');
                emit({ type: 'status', phase: 'thinking' });
                continue;
              }
            }

            if (event.type === 'done') {
              aborted = Boolean((event.data as AgentDoneData).aborted);
              break;
            }

            const streamEvent = agentEventToStreamEvent(event);
            if (streamEvent) {
              emit(streamEvent);
              if (streamEvent.type === 'error') errorEmitted = true;
              if (streamEvent.type === 'status') notePhase(streamEvent.phase);
              else if (streamEvent.type === 'reasoning') notePhase('thinking');
              else if (streamEvent.type === 'text') notePhase('replying');
              else if (streamEvent.type === 'tool' && streamEvent.result === undefined && streamEvent.error === undefined) {
                notePhase('tools');
              }
            }
          }

          // An abort grace timeout may have already closed subscribers with a
          // synthetic terminal event while the provider iterator was unwinding.
          if (this.turnDone) return;
          if (aborted || abortController.signal.aborted || terminalError) break;

          if (awaiting && awaiting.length > 0) {
            if (!options.onAwaitingInteraction) {
              terminalError = 'A tool needs approval but this turn cannot suspend';
              break;
            }
            notePhase('waiting');
            emit({ type: 'status', phase: 'waiting' });
            pauseWatchdogs();
            let next: FullStreamLike | null = null;
            try {
              next = await options.onAwaitingInteraction({
                sessionId,
                signal: abortController.signal,
                pending: awaiting,
                emitToolResult,
                getAssistant: () => persister.snapshot(),
              });
            } catch (err) {
              terminalError = err instanceof Error ? err.message : String(err);
            } finally {
              resumeWatchdogs();
            }
            if (this.turnDone) return;
            if (terminalError || aborted || abortController.signal.aborted || isStale()) break;
            if (next) {
              currentStream = next;
              notePhase('thinking');
              emit({ type: 'status', phase: 'thinking' });
              continue;
            }
          }

          if (options.onContinuePass) {
            let finishReason: string | undefined;
            if (currentStream.finishReason) {
              try {
                finishReason = await currentStream.finishReason;
              } catch {
                finishReason = undefined;
              }
            }
            const next = await options.onContinuePass({
              signal: abortController.signal,
              getAssistant: () => persister.snapshot(),
              finishReason,
              passIndex: continuePassIndex,
            });
            continuePassIndex += 1;
            if (next && !isStale() && !terminalError && !abortController.signal.aborted) {
              currentStream = next;
              notePhase('thinking');
              emit({ type: 'status', phase: 'thinking' });
              console.info(
                `[chat] continue pass session=${sessionId} turn=${turnId} pass=${continuePassIndex} finishReason=${finishReason ?? ''}`,
              );
              continue;
            }
          }
          break;
        }

        if (this.turnDone) return;

        const interrupted = (aborted || abortController.signal.aborted) && !terminalError;
        if (!interrupted && !terminalError && !persister.hasContent()) {
          terminalError = 'Provider ended without an assistant result';
        }
        if (persister.hasContent()) {
          await persister.commit({ aborted: false });
        }
        if (terminalError && !errorEmitted) {
          emit({ type: 'error', error: terminalError });
        }
        const outcome = interrupted ? 'interrupted' : terminalError ? 'error' : 'completed';
        finalOutcome = outcome;
        markEnd();
        emit({
          type: 'done',
          outcome,
          ...(outcome === 'completed' ? { aborted: false } : {}),
          ...(interrupted ? { aborted: true } : {}),
          ...(terminalError ? { error: terminalError } : {}),
        });
      } catch (err) {
        if (this.turnDone) return;
        const thrownError = formatProviderError(err);
        const supersededByNewerTurn = this.turnGeneration !== generation;
        if (this.abortReason === 'user' && !terminalError) {
          // The one true interruption: the user pressed stop.
          finalOutcome = 'interrupted';
          markEnd();
          emit({ type: 'done', outcome: 'interrupted', aborted: true });
        } else if (supersededByNewerTurn && !terminalError) {
          // A newer turn owns the stream now — stay quiet.
          finalOutcome = 'interrupted';
          markEnd();
        } else {
          // Provider / transport / watchdog: an error, even though it often
          // trips the same abort signal from inside the SDK.
          const error = terminalError ?? thrownError;
          terminalError = error;
          finalOutcome = 'error';
          markEnd();
          if (!errorEmitted) emit({ type: 'error', error });
          emit({ type: 'done', outcome: 'error', error });
        }
      } finally {
        clearWatchdogs();
        clearPermissionSink(sessionId);
        markEnd();
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
          finalOutcome = terminalError ? 'error' : 'interrupted';
          this.broadcast({
            type: 'done',
            outcome: finalOutcome,
            ...(finalOutcome === 'interrupted' ? { aborted: true } : {}),
            ...(terminalError ? { error: terminalError } : {}),
          });
          markEnd();
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

    let unsubscribe: (() => void) | null = null;
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

        let replayedDone = false;
        for (const envelope of this.ring) {
          if (envelope.rev > opts.replayAfter) write(envelope);
          if (envelope.event.type === 'done' && envelope.rev > opts.replayAfter) replayedDone = true;
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
              event: {
                type: 'done',
                outcome: 'error',
                error: 'Turn outcome unavailable; retry required',
              },
            });
          }
          close();
          return;
        }

        const sub: Subscriber = (envelope) => {
          write(envelope);
          if (envelope.event.type === 'done') {
            unsubscribe?.();
            close();
          }
        };
        unsubscribe = () => {
          this.subscribers.delete(sub);
          unsubscribe = null;
        };
        this.subscribers.add(sub);
        // The turn can finish between the initial replay and subscriber
        // registration. Re-check after subscribing so a late `done` cannot
        // leave the renderer waiting forever.
        if (!this.running || this.turnDone) {
          unsubscribe?.();
          if (this.lastDone && this.lastDone.rev > opts.replayAfter && !replayedDone) write(this.lastDone);
          close();
        }
      },
      cancel: () => {
        // A disconnected renderer must not remain in the fan-out set. The
        // provider may continue running so a later resume can attach cleanly.
        // `close` is guarded because cancel can race with a terminal done.
        unsubscribe?.();
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
    case 'thinking':
      return { type: 'reasoning', delta: (event.data as AgentThinkingData).delta };
    case 'tool_result': {
      const d = event.data as AgentToolResultData;
      return { type: 'tool', id: d.id, name: d.name, args: d.args, result: d.result, error: d.error };
    }
    case 'tool_use': {
      const d = event.data as AgentToolUseData;
      // Surface the start boundary immediately. The renderer upserts the
      // later tool_result by id, so the same row transitions spinner -> done.
      return { type: 'tool', id: d.id, name: d.name, args: d.args };
    }
    case 'status': {
      const d = event.data as {
        phase?: 'thinking' | 'tools' | 'replying' | 'waiting';
        step?: number;
      };
      if (!d.phase) return null;
      return { type: 'status', phase: d.phase, step: d.step };
    }
    case 'interaction_request':
      // Not projected here — permissions.ts owns the gated `permission` /
      // `ask` stream events so parallel prompts surface one at a time.
      return null;
    case 'error':
      return { type: 'error', error: (event.data as AgentErrorData).message };
    default:
      return null;
  }
}

export { agentEventToStreamEvent };
export type { ToolCallPart };
