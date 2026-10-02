import type { CanvasStore } from '../storage/canvasStore';
import { canvasWorkSignal } from './workLifecycle';

export interface GenerationSchedulerOptions {
  globalLimit?: number;
  providerLimit?: number;
  signal?: AbortSignal;
}

export class GenerationSchedulerClosedError extends Error {
  readonly status = 503;
  constructor() { super('Generation scheduler is shutting down'); }
}

type Release = () => void;
interface WaitingPermit {
  providerId: string;
  signal?: AbortSignal;
  resolve: (release: Release) => void;
  reject: (error: unknown) => void;
  onAbort: () => void;
  release?: Release;
  state: 'waiting' | 'active' | 'released';
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Generation request cancelled', 'AbortError');
}

/** Repository-scoped paid generation admission, shared across canvases and media types. */
export function createGenerationScheduler(options: GenerationSchedulerOptions = {}) {
  const globalLimit = options.globalLimit ?? 8;
  const providerLimit = options.providerLimit ?? 4;
  if (!Number.isSafeInteger(globalLimit) || globalLimit < 1 || !Number.isSafeInteger(providerLimit) || providerLimit < 1) {
    throw new RangeError('Generation limits must be positive integers');
  }
  const waiting: WaitingPermit[] = [];
  const active = new Set<WaitingPermit>();
  const byProvider = new Map<string, number>();
  const stopped = new AbortController();
  let closed = false;

  function drain(): void {
    while (!closed && active.size < globalLimit) {
      // Preserve FIFO among eligible requests, allowing another provider to use free capacity.
      const index = waiting.findIndex((entry) => !entry.signal?.aborted && (byProvider.get(entry.providerId) ?? 0) < providerLimit);
      if (index < 0) return;
      const entry = waiting.splice(index, 1)[0];
      entry.state = 'active';
      active.add(entry);
      byProvider.set(entry.providerId, (byProvider.get(entry.providerId) ?? 0) + 1);
      const release = () => {
        if (entry.state !== 'active') return;
        entry.state = 'released';
        entry.signal?.removeEventListener('abort', entry.onAbort);
        active.delete(entry);
        const remaining = (byProvider.get(entry.providerId) ?? 1) - 1;
        if (remaining === 0) byProvider.delete(entry.providerId);
        else byProvider.set(entry.providerId, remaining);
        drain();
      };
      entry.release = release;
      entry.resolve(release);
    }
  }

  function acquire(providerId: string, signal?: AbortSignal): Promise<Release> {
    if (closed) return Promise.reject(new GenerationSchedulerClosedError());
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise((resolve, reject) => {
      const entry: WaitingPermit = { providerId, signal, resolve, reject, state: 'waiting', onAbort: () => undefined };
      entry.onAbort = () => {
        if (entry.state === 'active') { entry.release?.(); return; }
        if (entry.state !== 'waiting') return;
        entry.state = 'released';
        signal?.removeEventListener('abort', entry.onAbort);
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal ? abortError(signal) : new DOMException('Generation request cancelled', 'AbortError'));
        drain();
      };
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      waiting.push(entry);
      drain();
    });
  }

  async function run<T>(providerId: string, execute: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const combined = signal ? AbortSignal.any([signal, stopped.signal]) : stopped.signal;
    const release = await acquire(providerId, combined);
    let onAbort!: () => void;
    try {
      combined.throwIfAborted();
      const cancelled = new Promise<T>((_resolve, reject) => { onAbort = () => reject(abortError(combined)); });
      combined.addEventListener('abort', onAbort, { once: true });
      const work = Promise.resolve().then(() => { combined.throwIfAborted(); return execute(combined); });
      const result = await Promise.race([work, cancelled]);
      combined.throwIfAborted();
      return result;
    } finally {
      if (onAbort) combined.removeEventListener('abort', onAbort);
      release();
    }
  }

  function shutdown(): void {
    if (closed) return;
    closed = true;
    options.signal?.removeEventListener('abort', shutdown);
    const error = new GenerationSchedulerClosedError();
    for (const entry of waiting.splice(0)) {
      entry.state = 'released';
      entry.signal?.removeEventListener('abort', entry.onAbort);
      entry.reject(error);
    }
    stopped.abort(error); // run() releases callers even if a provider ignores cancellation.
    for (const entry of [...active]) entry.release?.();
  }

  if (options.signal?.aborted) shutdown();
  else options.signal?.addEventListener('abort', shutdown, { once: true });
  return { acquire, run, shutdown, isAccepting: () => !closed };
}

export type GenerationScheduler = ReturnType<typeof createGenerationScheduler>;
const schedulers = new WeakMap<CanvasStore, GenerationScheduler>();

/** Limits may be injected before first use in tests; all subsequent calls reuse that instance. */
export function generationSchedulerFor(store: CanvasStore, limits: Omit<GenerationSchedulerOptions, 'signal'> = {}): GenerationScheduler {
  let scheduler = schedulers.get(store);
  if (!scheduler) {
    scheduler = createGenerationScheduler({ ...limits, signal: canvasWorkSignal(store) });
    schedulers.set(store, scheduler);
  }
  return scheduler;
}
