import { describe, expect, it } from 'vitest';
import { LOCAL_ENDPOINTS, NOT_DETECTED, parseLocalModels } from './localModels';

describe('local models', () => {
  it('lists chat models and skips embedding / reranker ones', () => {
    const json = { data: [{ id: 'llama3.1:8b' }, { id: 'nomic-embed-text:latest' }, { id: 'qwen2.5-coder' }, { id: 'bge-m3' }, { id: 'mxbai-rerank-large' }, { id: 7 }, {}] };
    expect(parseLocalModels(json).map((m) => m.id)).toEqual(['llama3.1:8b', 'qwen2.5-coder']);
  });
  it('tolerates junk', () => {
    expect(parseLocalModels(null)).toEqual([]);
    expect(parseLocalModels({ data: 'x' })).toEqual([]);
  });
  it('knows both servers and says plainly when one is not running', () => {
    expect(LOCAL_ENDPOINTS.map((e) => e.providerId)).toEqual(['ollama', 'lmstudio']);
    expect(NOT_DETECTED('Ollama')).toContain('未检测到本地服务');
  });
});
