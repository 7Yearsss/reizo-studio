export interface LocalEndpoint { providerId: string; name: string; baseUrl: string }

/** Where local model servers listen by default. Both speak the OpenAI-compatible API under /v1. */
export const LOCAL_ENDPOINTS: readonly LocalEndpoint[] = [
  { providerId: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
  { providerId: 'lmstudio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
];

/** Local servers do not check keys, but the app treats "has a key" as "configured", so a fixed placeholder stands in. */
export const LOCAL_PLACEHOLDER_KEY = 'local';

const EMBEDDING = /(^|[-_/:])(embed|embedding|rerank|bge|nomic-embed|text-embedding)([-_/:]|$)/i;

/** Model ids from an OpenAI-style `/models` answer; embedding and reranker models are left out (they cannot chat). */
export function parseLocalModels(json: unknown): Array<{ id: string; name: string }> {
  const list = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(list)) return [];
  return list
    .map((m) => (m as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && !EMBEDDING.test(id))
    .map((id) => ({ id, name: id }));
}

export interface LocalDiscovery { providerId: string; name: string; baseUrl: string; reachable: boolean; models: Array<{ id: string; name: string }>; message?: string }

export const NOT_DETECTED = (name: string): string => `未检测到本地服务（${name}）：请先启动它，并确认它在默认端口监听。`;
