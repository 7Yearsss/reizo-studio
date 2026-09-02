import type { CanvasEnvelope, CanvasEvent } from '../../../shared/canvasStream';
import { encodeCanvasEnvelope } from '../../../shared/canvasStream';

/**
 * Live channel for one canvas. Same replay+subscribe shape as the chat
 * `AgentSession` (`agent/session.ts`) but deliberately NOT that class:
 *
 * - keyed by `canvasId`, in its own module-global map (no collision with chat)
 * - the ring buffer is never cleared, only capped — a canvas has no "turn"
 * - the stream is long-lived: it never emits a terminal event and only closes
 *   when the client disconnects
 * - `rev` is authored by `canvasStore` (persisted per write) and passed in,
 *   not an in-memory counter, so an app restart resumes cleanly
 */

const RING_CAP = 1000;
const HEARTBEAT_MS = 15_000;

type Subscriber = (envelope: CanvasEnvelope) => void;

class CanvasChannel {
  private readonly epoch = `c_${Date.now().toString(36)}`;
  private ring: CanvasEnvelope[] = [];
  private subscribers = new Set<Subscriber>();
  private lastRev = 0;

  constructor(private readonly canvasId: string) {}

  broadcast(rev: number, event: CanvasEvent): void {
    this.lastRev = Math.max(this.lastRev, rev);
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

  stream(after: number): Response {
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeat: NodeJS.Timeout | null = null;

    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let closed = false;
        const write = (envelope: CanvasEnvelope) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(encodeCanvasEnvelope(envelope)));
          } catch {
            closed = true;
          }
        };

        for (const envelope of this.ring) {
          if (envelope.rev > after) write(envelope);
        }

        const sub: Subscriber = (envelope) => write(envelope);
        this.subscribers.add(sub);
        unsubscribe = () => {
          this.subscribers.delete(sub);
          unsubscribe = null;
        };

        heartbeat = setInterval(() => {
          write({
            v: 1,
            canvasId: this.canvasId,
            rev: this.lastRev,
            epoch: this.epoch,
            event: { type: 'heartbeat' },
          });
        }, HEARTBEAT_MS);
      },
      cancel: () => {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
      },
    });

    return new Response(body, {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-cache',
      },
    });
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
