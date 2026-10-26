import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createTranslationsRouter } from './translations';

describe('message translation routes', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'reizo-trans-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  async function setup(reply = '你好，世界') {
    const sessionStore = createSqliteSessionStore(openDb(':memory:'));
    const session = await sessionStore.create('t', null, null);
    await sessionStore.appendMessage(session.id, { id: 'm1', role: 'assistant', content: 'Hello, world sk-abcdefghijklmnopqrstuvwxyz0123456789', createdAt: new Date().toISOString() });
    const prompts: string[] = [];
    const router = createTranslationsRouter({ dataRoot: root, sessionStore, rewriteText: async (_s, p) => { prompts.push(p); return reply; } });
    return { router, session, prompts };
  }
  const post = (router: ReturnType<typeof createTranslationsRouter>, sid: string, mid: string, lang: unknown) =>
    router.request(`/${sid}/messages/${mid}/translate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang }) });

  it('translates once, keeps it for later loads, never sends a secret to the model, and can remove it', async () => {
    const { router, session, prompts } = await setup();
    const res = await post(router, session.id, 'm1', 'zh');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { translation: { text: string } }).translation.text).toBe('你好，世界');
    expect(prompts[0]).not.toContain('sk-abcdefgh');

    const stored = (await (await router.request(`/${session.id}/translations`)).json()) as { translations: Record<string, Record<string, { text: string }>> };
    expect(stored.translations.m1.zh.text).toBe('你好，世界');

    expect((await router.request(`/${session.id}/messages/m1/translations/zh`, { method: 'DELETE' })).status).toBe(204);
    const after = (await (await router.request(`/${session.id}/translations`)).json()) as { translations: Record<string, unknown> };
    expect(after.translations.m1).toBeUndefined();
  });

  it('rejects an unknown language, an unknown message and an empty model answer', async () => {
    const { router, session } = await setup();
    expect((await post(router, session.id, 'm1', 'klingon')).status).toBe(400);
    expect((await post(router, session.id, 'nope', 'zh')).status).toBe(404);
    const empty = await setup('   ');
    expect((await post(empty.router, empty.session.id, 'm1', 'zh')).status).toBe(502);
  });
});
