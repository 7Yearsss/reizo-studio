import { createOpenAI } from '@ai-sdk/openai';

/**
 * Provider factory — mirrors the shape of winlume's
 * src/lib/agent/provider/ai-sdk.ts, but takes the key directly instead of
 * resolving it from a DB-backed org billing token
 * (src/lib/agent/provider/studio-token.ts), since desktop has no
 * organization/billing concept.
 */
export function createOpenAiModel(options: { apiKey: string; modelId: string; baseUrl?: string }) {
  const openai = createOpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl || undefined,
  });
  return openai(options.modelId);
}
