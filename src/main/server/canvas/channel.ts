import { nanoid } from 'nanoid';
import type { CanvasEnvelope, CanvasEvent } from '../../../shared/canvasStream';
import type { CanvasCommit, CanvasSyncMessage } from '../../../shared/canvasSync';
import type { CanvasStore } from '../storage/canvasStore';

/**
 * Live channel for one canvas. Same replay+subscribe shape as the chat
 * `AgentSession` (`agent/session.ts`) but deliberately NOT that class:
 *
 * - keyed by `canvasId`, in its own module-global map (no collision with chat)
 * - v1 keeps a capped ring and server-side taps for background job watchers
 * - v2 replays persisted commits and uses that journal's document revision
 * - the stream is long-lived: it never emits a terminal event and only closes
 *   when the client disconnects
 * - activity events are ephemeral and never advance the v2 document cursor
 */

const RING_CAP = 1000;
const HEARTBEAT_MS = 15_000;

type Subscriber = (envelope: CanvasEnvelope) => void;
type CommitSource = Pick<CanvasStore, 'subscribeCommits' | 'readCommitsAfter' | 'getCanvas'>;

/** All exit paths release subscriptions and timers, including a failed write. */
function ndjsonStream<T>(
  setup: (write: (message: T) => boolean, onCleanup: (fn: () => void) => void) => void,
  signal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  const cleanups: Array<() => void> = [];
  let closed = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    for (const fn of cleanups.splice(0)) fn();
  };
  const onCleanup = (fn: () => void) => {
    if (closed) fn();
    else cleanups.push(fn);
  };
  const finish = (error?: unknown) => {
    if (closed) return;
    cleanup();
    if (error !== undefined) controller.error(error);
    else controller.close();
  };
  const body = new ReadableStream<Uint8Array>({
    start: (streamController) => {
      controller = streamController;
      const abort = () => finish();
      signal?.addEventListener('abort', abort, { once: true });
      onCleanup(() => signal?.removeEventListener('abort', abort));
      if (signal?.aborted) {
        finish();
        return;
      }
      const write = (message: T): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
          return true;
        } catch (error) {
          finish(error);
          return false;
        }
      };
      try { setup(write, onCleanup); } catch (error) { finish(error); }
    },
    cancel: cleanup,
  });
  return new Response(body, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
    },
  });
}

function isActivity(event: CanvasEvent): event is Extract<CanvasEvent,
  { type: 'graph_run' | 'proposal_created' | 'proposal_accepted' | 'proposal_rejected' | 'phase' }> {
  return event.type === 'graph_run' || event.type === 'phase' || event.type === 'proposal_created' ||
    event.type === 'proposal_accepted' || event.type === 'proposal_rejected';
}

export class CanvasChannel {
  private readonly epoch = `c_${nanoid()}`;
  private ring: CanvasEnvelope[] = [];
  private subscribers = new Set<Subscriber>();
  private lastRev = 0;
  private runningGraph: Extract<CanvasEvent, { type: 'graph_run' }> | null = null;

  constructor(private readonly canvasId: string) {}

  broadcast(rev: number, event: CanvasEvent): void {
    this.lastRev = Math.max(this.lastRev, rev);
    if (event.type === 'graph_run') this.runningGraph = event.running ? { ...event } : null;
    const envelope: CanvasEnvelope = { v: 1, canvasId: this.canvasId, rev, epoch: this.epoch, event };
    this.ring.push(envelope);
    if (this.ring.length > RING_CAP) this.ring.shift();
    for (const sub of this.subscribers) {
      try {
        sub(envelope);
      } catch (err) {
        console.error('[canvas] subscriber threw', err);
      }
    }
  }

  /** Server-side tap (jobWatch) — same fan-out the SSE stream uses, no replay. */
  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  stream(after: number, signal?: AbortSignal): Response {
    return ndjsonStream<CanvasEnvelope>((write, onCleanup) => {
      for (const envelope of this.ring) {
        if (envelope.rev > after && !write(envelope)) return;
      }
      onCleanup(this.subscribe((envelope) => { write(envelope); }));
      const heartbeat = setInterval(() => {
        write({ v: 1, canvasId: this.canvasId, rev: this.lastRev, epoch: this.epoch, event: { type: 'heartbeat' } });
      }, HEARTBEAT_MS);
      onCleanup(() => clearInterval(heartbeat));
    }, signal);
  }

  /** Durable transaction batches are the only source of v2 document changes. */
  streamCommits(store: CommitSource, after: number, signal?: AbortSignal): Response {
    return ndjsonStream<CanvasSyncMessage>((write, onCleanup) => {
      const base = { v: 2 as const, canvasId: this.canvasId, epoch: this.epoch };
      let cursor = after;
      let replaying = true;
      const pending: CanvasCommit[] = [];
      const sendCommit = (commit: CanvasCommit) => {
        if (commit.revision <= cursor) return;
        if (write({ ...base, kind: 'commit', commit })) cursor = commit.revision;
      };
      const replay = () => {
        const result = store.readCommitsAfter(this.canvasId, cursor);
        if (result.resync) {
          cursor = result.revision;
          write({ ...base, kind: 'resync', revision: result.revision });
        } else {
          for (const commit of result.commits) sendCommit(commit);
        }
      };
      onCleanup(store.subscribeCommits((commit) => {
        if (commit.canvasId !== this.canvasId) return;
        if (replaying) pending.push(commit);
        else if (commit.revision > cursor + 1) replay();
        else sendCommit(commit);
      }));
      onCleanup(this.subscribe(({ event }) => {
        if (isActivity(event)) write({ ...base, kind: 'activity', event });
      }));
      // Subscribe first so a commit at the replay boundary cannot be lost.
      replay();
      replaying = false;
      for (const commit of pending) sendCommit(commit);
      // Keep Stop available when reconnecting to a run that is still alive in this process.
      if (this.runningGraph) write({ ...base, kind: 'activity', event: this.runningGraph });
      const heartbeat = setInterval(() => {
        const revision = store.getCanvas(this.canvasId)?.liveRevision ?? cursor;
        write({ ...base, kind: 'heartbeat', revision });
      }, HEARTBEAT_MS);
      onCleanup(() => clearInterval(heartbeat));
    }, signal);
  }
}

const channels = new Map<string, CanvasChannel>();

export function getCanvasChannel(canvasId: string): CanvasChannel {
  let channel = channels.get(canvasId);
  if (!channel) {
    channel = new CanvasChannel(canvasId);
    channels.set(canvasId, channel);
  }
  return channel;
}
