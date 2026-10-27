import { Hono } from 'hono';
import { extractKnowledgeText, UnsupportedKnowledgeFile } from '../agent/knowledgeExtract';
import { KnowledgeError, type KnowledgeStore } from '../storage/knowledgeStore';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** The user's knowledge base: list, add (text already extracted by the client) and remove documents, and try a search. */
export function createKnowledgeRouter(store: KnowledgeStore) {
  const router = new Hono();
  router.get('/', async (c) => c.json({ documents: await store.list() }));
  router.post('/', async (c) => {
    const body = (await c.req.json().catch((): null => null)) as { name?: unknown; text?: unknown } | null;
    if (typeof body?.name !== 'string' || typeof body.text !== 'string') return c.json({ error: '需要 name 和 text' }, 400);
    try { return c.json({ document: await store.add({ name: body.name, text: body.text }) }); }
    catch (error) {
      if (error instanceof KnowledgeError) return c.json({ error: error.message }, 400);
      throw error;
    }
  });
  // A file as raw bytes (?name=report.docx): text is pulled out here, so Word / Excel / PowerPoint can be imported.
  router.post('/file', async (c) => {
    const name = (c.req.query('name') ?? '').trim();
    if (!name) return c.json({ error: '需要文件名' }, 400);
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > MAX_UPLOAD_BYTES) return c.json({ error: '文件超过 25 MB' }, 413);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > MAX_UPLOAD_BYTES) return c.json({ error: '文件超过 25 MB' }, 413);
    try {
      const text = await extractKnowledgeText(name, bytes);
      if (text.includes(String.fromCharCode(0))) return c.json({ error: `「${name}」不是文本文件` }, 400);
      return c.json({ document: await store.add({ name, text }) });
    } catch (error) {
      if (error instanceof UnsupportedKnowledgeFile || error instanceof KnowledgeError) return c.json({ error: error.message }, 400);
      throw error;
    }
  });
  router.delete('/:id', async (c) => ((await store.remove(c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: '没有这份资料' }, 404)));
  router.get('/search', async (c) => c.json({ hits: await store.search(c.req.query('q') ?? '', 8) }));
  return router;
}
