import { nanoid } from 'nanoid';
import { providerUsageMetrics, type UsageCategory, type UsageMetric } from '../../../../shared/usage';
import type { UsageStore } from '../../storage/usageStore';

const MAX_FRAME = 1024 * 1024;
/** Observe only bytes consumed by the caller; store final counters/IDs, never prompts or response text. */
export function usageFetch(store: UsageStore, context: { executionId?: string; jobId?: string; sessionId?: string; canvasId?: string; nodeId?: string;
  providerId: string; model: string; category: UsageCategory; accepting?: () => boolean }, transport: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const executionId = context.executionId ?? `request:${nanoid()}`;
    const reportId = nanoid();
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const active = () => context.accepting?.() !== false;
    if (active()) {
      store.ensure({ ...context, executionId });
      store.setReport(executionId, reportId, []);
    }
    const response = await transport(input, init);
    const header = response.headers.get('x-request-id');
    const headerRequestId = header && header.length <= 512 ? header : undefined;
    if (headerRequestId && active()) {
      try { store.setReport(executionId, reportId, [], { requestId: headerRequestId }); }
      catch { console.warn('[usage] Provider request ID could not be persisted', executionId); }
    }
    if (!response.ok || !response.body) return response;
    const reader = response.body.getReader(); const decoder = new TextDecoder();
    const sse = response.headers.get('content-type')?.includes('text/event-stream');
    let buffer = ''; let dropping = false; let completed = false; let truncated = false; let errorFrame = false;
    let outcome: 'completed' | 'incomplete' | 'failed' | undefined;
    let metrics: UsageMetric[] = []; let requestId = headerRequestId ?? undefined; let reportedModel: string | undefined;
    const inspect = (raw: string) => {
      const text = raw.trim();
      if (text === '[DONE]') { completed = true; outcome ??= 'completed'; return; }
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { return; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const value = parsed as Record<string, any>;
      const report = value.response && typeof value.response === 'object' && !Array.isArray(value.response) ? value.response : value;
      const terminalResponse = ['completed', 'incomplete', 'failed'].includes(report.status) &&
        (value.type === `response.${report.status}` || !sse && report.object === 'response');
      if (!terminalResponse && (value.error || value.type === 'error' || report.status === 'failed' || report.status === 'incomplete' || report.status === 'cancelled')) {
        errorFrame = true; outcome = 'failed'; metrics = []; completed = false; return;
      }
      if (report.usage && typeof report.usage === 'object' && (!value.type || terminalResponse)) {
        metrics = providerUsageMetrics(report.usage); // replacement, never sum cumulative frames
        requestId ??= typeof report.id === 'string' && report.id.length <= 512 ? report.id : undefined;
        reportedModel = typeof report.model === 'string' && report.model.length <= 512 ? report.model : reportedModel;
      }
      if (terminalResponse) {
        // A provider's incomplete/failed terminal response can include authoritative billed
        // counters. Preserve that basis as partial; a transport/error frame cannot supply them.
        completed = true; outcome = report.status;
        metrics = providerUsageMetrics(report.usage);
      } else if (!sse && !value.error && !report.status) { completed = true; outcome = 'completed'; }
    };
    const consume = (chunk: string, end = false) => {
      if (!sse) {
        if (!dropping && buffer.length + chunk.length <= MAX_FRAME) buffer += chunk;
        else { dropping = true; truncated = true; buffer = ''; }
        if (end && !dropping) inspect(buffer);
        return;
      }
      for (const piece of chunk.split(/(?<=\n)/)) {
        if (!dropping) {
          buffer += piece;
          if (buffer.length > MAX_FRAME) { buffer = ''; dropping = true; truncated = true; }
        }
        if (piece.endsWith('\n')) {
          if (!dropping && buffer.startsWith('data:')) inspect(buffer.slice(5));
          buffer = ''; dropping = false;
        }
      }
      if (end && !dropping && buffer.startsWith('data:')) inspect(buffer.slice(5));
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            consume(decoder.decode(), true);
            if (!truncated && active() && !signal?.aborted && (completed || errorFrame)) {
              try { store.setReport(executionId, reportId, completed && !errorFrame ? metrics : [], { requestId, reportedModel, outcome: errorFrame ? 'failed' : outcome }); }
              catch { console.warn('[usage] Final provider usage could not be persisted; execution remains unverified', executionId); }
            }
            buffer = ''; metrics = []; controller.close();
          } else { consume(decoder.decode(value, { stream: true })); controller.enqueue(value); }
        } catch (error) { buffer = ''; metrics = []; controller.error(error); }
      },
      async cancel(reason) { buffer = ''; metrics = []; await reader.cancel(reason); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
