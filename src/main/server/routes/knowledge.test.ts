import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKnowledgeTools } from '../agent/knowledgeTools';
import { createKnowledgeStore } from '../storage/knowledgeStore';
import { createKnowledgeRouter } from './knowledge';

describe('knowledge base', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'reizo-kb-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  const post = (router: ReturnType<typeof createKnowledgeRouter>, name: string, text: string) =>
    router.request('/', { method: 'POST', body: JSON.stringify({ name, text }) });

  it('imports documents, finds them with their file name, replaces by name, and removes', async () => {
    const store = createKnowledgeStore(root);
    const router = createKnowledgeRouter(store);
    await post(router, '退款政策.md', '商品签收后七天内可以申请退款，需保持包装完好。');
    await post(router, '发货说明.md', '下单后48小时内发货，默认使用顺丰快递。');
    expect(((await (await router.request('/')).json()) as { documents: unknown[] }).documents).toHaveLength(2);

    const tool = createKnowledgeTools({ store }).knowledge_search;
    const out = (await tool.execute!({ query: '多久可以退款' }, { toolCallId: 't', messages: [], context: undefined })) as { hits: Array<{ source: string }> };
    expect(out.hits[0].source).toBe('退款政策.md');

    await post(router, '退款政策.md', '退款期限改为十四天。');
    const list = ((await (await router.request('/')).json()) as { documents: Array<{ id: string; name: string }> }).documents;
    expect(list).toHaveLength(2);
    const changed = (await tool.execute!({ query: '十四天' }, { toolCallId: 't', messages: [], context: undefined })) as { hits: Array<{ text: string }> };
    expect(changed.hits[0].text).toContain('十四天');

    const gone = list.find((d) => d.name === '发货说明.md')!;
    expect((await router.request(`/${gone.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await router.request(`/${gone.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('rejects empty text, never stores a key from a document, and cannot be pointed at other files', async () => {
    const store = createKnowledgeStore(root);
    const router = createKnowledgeRouter(store);
    expect((await post(router, 'x.md', '   ')).status).toBe(400);
    await post(router, 'env.md', 'api setup: key is sk-abcdefghijklmnopqrstuvwxyz0123456789 for the shop');
    const hits = await store.search('sk-abcdefghijklmnopqrstuvwxyz0123456789 shop');
    expect(JSON.stringify(hits)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect((await router.request('/..%2Fsecret', { method: 'DELETE' })).status).toBe(404);
  });
});
