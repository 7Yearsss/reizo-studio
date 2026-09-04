import { createOpenAI } from '@ai-sdk/openai';

/**
 * Provider factory — mirrors the shape of winlume's
 * src/lib/agent/provider/ai-sdk.ts, but takes the key directly instead of
 * resolving it from a DB-backed org billing token
 * (src/lib/agent/provider/studio-token.ts), since desktop has no
 * organization/billing concept.
 */
function describeBody(body: unknown): string {
  if (typeof body !== 'string') return '';
  const bodyBytes = Buffer.byteLength(body, 'utf8');
  try {
    const parsed = JSON.parse(body) as {
      input?: unknown;
      messages?: unknown;
      tools?: unknown;
    };
    const inputItems = Array.isArray(parsed.input) ? parsed.input.length : undefined;
    const messages = Array.isArray(parsed.messages) ? parsed.messages.length : undefined;
    const tools = Array.isArray(parsed.tools) ? parsed.tools.length : undefined;
    return ` bodyBytes=${bodyBytes}${inputItems != null ? ` inputItems=${inputItems}` : ''}${messages != null ? ` messages=${messages}` : ''}${tools != null ? ` tools=${tools}` : ''}`;
  } catch {
    return ` bodyBytes=${bodyBytes}`;
  }
}

function isOfficialOpenAi(baseUrl?: string): boolean {
  if (!baseUrl) return true;
  try {
    return new URL(baseUrl).hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

const MAX_TRANSPORT_RETRIES = 2;

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      },
      { once: true },
    );
  });
}

function getRetryDelay(status: number, attempt: number, headers?: Headers): number {
  if (status === 429 && headers?.get('retry-after')) {
    const headerVal = headers.get('retry-after');
    const seconds = Number(headerVal);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, 10_000);
    }
  }
  const base = status === 429 ? 1000 : 500;
  const backoff = base * Math.pow(2, attempt);
  const jitter = Math.random() * 250;
  return backoff + jitter;
}

function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 524
  );
}

/**
 * The bare `@ai-sdk/openai` provider, with request logging wired in. Callers
 * pick the surface: `.chat(id)` / `(id)` for language models, `.image(id)` for
 * `generateImage`.
 */
export function createOpenAiProvider(options: { apiKey: string; baseUrl?: string }) {
  const loggedFetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const startedAt = Date.now();
    console.info(`[chat] provider request sent method=${method} url=${url}${describeBody(init?.body)}`);

    for (let attempt = 0; ; attempt++) {
      try {
        const response = await globalThis.fetch(input, init);
        console.info(
          `[chat] provider response status=${response.status} durationMs=${Date.now() - startedAt}${attempt > 0 ? ` attempt=${attempt}` : ''}`,
        );

        // Fast-fail non-retryable authentication errors without wasting retries
        if (response.status === 401 || response.status === 403) {
          return response;
        }

        if (isRetryableStatus(response.status) && attempt < MAX_TRANSPORT_RETRIES) {
          const delay = getRetryDelay(response.status, attempt, response.headers);
          console.warn(
            `[chat] retryable HTTP ${response.status}, backing off ${Math.round(delay)}ms before retry ${attempt + 1}`,
          );
          await sleep(delay, init?.signal);
          continue;
        }

        return response;
      } catch (error) {
        if (init?.signal?.aborted) throw error;
        if (attempt < MAX_TRANSPORT_RETRIES) {
          const delay = 500 * Math.pow(2, attempt) + Math.random() * 250;
          console.warn(
            `[chat] transport error, backing off ${Math.round(delay)}ms before retry ${attempt + 1}: ${error instanceof Error ? error.message : String(error)}`,
          );
          await sleep(delay, init?.signal);
          continue;
        }
        console.info(
          `[chat] provider transport error durationMs=${Date.now() - startedAt} error=${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    }
  };
  return createOpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl || undefined,
    fetch: loggedFetch,
  });
}

export function createOpenAiModel(options: { apiKey: string; modelId: string; baseUrl?: string }) {
  const openai = createOpenAiProvider(options);
  // Default `openai(model)` is the Responses API (`/v1/responses`). new-api
  // gateways (v2api.top) stream that poorly with tools: each step resends
  // every function_call item and nginx returns HTTP 524 after ~165s.
  // Chat Completions is the path a "normal" curl uses and is what those
  // proxies actually keep open.
  if (isOfficialOpenAi(options.baseUrl)) return openai(options.modelId);
  return openai.chat(options.modelId);
}
