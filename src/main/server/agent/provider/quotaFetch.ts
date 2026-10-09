import type { GenerationScheduler } from '../../canvas/generationScheduler';
import { createGenerationScheduler } from '../../canvas/generationScheduler';
import type { CanvasStore } from '../../storage/canvasStore';
import { canvasWorkSignal } from '../../canvas/workLifecycle';

const schedulers = new WeakMap<CanvasStore, GenerationScheduler>();
export function llmSchedulerFor(store: CanvasStore): GenerationScheduler {
  let scheduler = schedulers.get(store);
  if (!scheduler) {
    scheduler = createGenerationScheduler({ globalLimit: 4, providerLimit: 4, reservedInteractiveSlots: 1, signal: canvasWorkSignal(store) });
    schedulers.set(store, scheduler);
  }
  return scheduler;
}

/** Hold an LLM permit through streaming, releasing it before tools or human interactions run. */
export function quotaFetch(scheduler: GenerationScheduler, providerId: string, transport: typeof globalThis.fetch = globalThis.fetch, interactive = false): typeof globalThis.fetch {
  return async (input, init) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const permit = await scheduler.acquire(providerId, signal ?? undefined, interactive);
    let released = false;
    const release = () => { if (!released) { released = true; signal?.removeEventListener('abort', release); permit(); } };
    signal?.addEventListener('abort', release, { once: true });
    if (signal?.aborted) { release(); signal.throwIfAborted(); }
    try {
      const response = await transport(input, init);
      if (!response.ok || !response.body) { release(); return response; }
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) { release(); controller.close(); } else controller.enqueue(value);
          } catch (error) { release(); controller.error(error); }
        },
        async cancel(reason) { release(); await reader.cancel(reason); },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { release(); throw error; }
  };
}
