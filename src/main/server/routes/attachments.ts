import { Hono } from 'hono';
import { extractKnowledgeText, UnsupportedKnowledgeFile } from '../agent/knowledgeExtract';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 500_000;

/** `POST /extract?name=report.pdf` — raw file bytes in, plain text out, so a PDF can be attached to a message. Nothing is stored. */
export function createAttachmentsRouter() {
  const router = new Hono();
  router.post('/extract', async (c) => {
    const name = (c.req.query('name') ?? '').trim().slice(0, 200);
    if (!name) return c.json({ error: '需要文件名' }, 400);
    if (Number(c.req.header('content-length') ?? 0) > MAX_UPLOAD_BYTES) return c.json({ error: '文件超过 25 MB' }, 413);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > MAX_UPLOAD_BYTES) return c.json({ error: '文件超过 25 MB' }, 413);
    try {
      const text = await extractKnowledgeText(name, bytes);
      if (!text.trim()) return c.json({ error: `「${name}」里没有可读的文字` }, 400);
      if (text.includes(String.fromCharCode(0))) return c.json({ error: `「${name}」不是文本文件` }, 400);
      return c.json({ name, text: text.slice(0, MAX_TEXT_CHARS), truncated: text.length > MAX_TEXT_CHARS });
    } catch (error) {
      if (error instanceof UnsupportedKnowledgeFile) return c.json({ error: error.message }, 400);
      throw error;
    }
  });
  return router;
}
