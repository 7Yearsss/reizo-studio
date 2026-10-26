import { Hono } from 'hono';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { SessionStore } from '../../../shared/chat';
import { MAX_TRANSLATE_CHARS, parseTranslateLang, parseTranslationMap, translateSystemPrompt, type TranslationMap } from '../../../shared/translation';
import { redactSecrets } from '../../../shared/redactSecrets';
import { writeTextAtomic } from '../storage/atomicFile';
import type { RewriteText } from '../agent/compaction';

const fileOf = (dataRoot: string, sessionId: string) => path.join(dataRoot, 'translations', `${sessionId.replace(/[^\w-]/g, '_')}.json`);

async function load(dataRoot: string, sessionId: string): Promise<TranslationMap> {
  try { return parseTranslationMap(JSON.parse(await readFile(fileOf(dataRoot, sessionId), 'utf8'))); } catch { return {}; }
}

/** Message translations: asked for explicitly, written back once, shown under the original after a reload. */
export function createTranslationsRouter(options: { dataRoot: string; sessionStore: SessionStore; rewriteText: RewriteText }) {
  const router = new Hono();

  router.get('/:id/translations', async (c) => c.json({ translations: await load(options.dataRoot, c.req.param('id')) }));

  router.post('/:id/messages/:mid/translate', async (c) => {
    const sessionId = c.req.param('id');
    const messageId = c.req.param('mid');
    const body = (await c.req.json().catch((): null => null)) as { lang?: unknown } | null;
    const lang = parseTranslateLang(body?.lang);
    if (!lang) return c.json({ error: '不支持的目标语言' }, 400);
    const session = await options.sessionStore.get(sessionId);
    const message = session?.messages.find((m) => m.id === messageId);
    if (!session || !message) return c.json({ error: '找不到这条消息' }, 404);
    const source = redactSecrets(message.content).trim();
    if (!source) return c.json({ error: '这条消息没有可翻译的文字' }, 400);
    if (source.length > MAX_TRANSLATE_CHARS) return c.json({ error: `内容太长（超过 ${MAX_TRANSLATE_CHARS} 字），请分段翻译` }, 413);
    try {
      const text = (await options.rewriteText(translateSystemPrompt(lang), source)).trim();
      if (!text) return c.json({ error: '模型没有返回译文' }, 502);
      const map = await load(options.dataRoot, sessionId);
      (map[messageId] ??= {})[lang] = { text, at: new Date().toISOString() };
      await writeTextAtomic(fileOf(options.dataRoot, sessionId), JSON.stringify(map));
      return c.json({ translation: map[messageId][lang] });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  });

  router.delete('/:id/messages/:mid/translations/:lang', async (c) => {
    const lang = parseTranslateLang(c.req.param('lang'));
    if (!lang) return c.json({ error: '不支持的目标语言' }, 400);
    const sessionId = c.req.param('id');
    const map = await load(options.dataRoot, sessionId);
    const entry = map[c.req.param('mid')];
    if (entry) {
      delete entry[lang];
      await writeTextAtomic(fileOf(options.dataRoot, sessionId), JSON.stringify(map));
    }
    return c.body(null, 204);
  });

  return router;
}
