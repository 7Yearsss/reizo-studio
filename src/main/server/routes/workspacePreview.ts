import { Hono } from 'hono';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import type { SettingsStore } from '../storage/settingsStore';
import { resolveInsideWorkspace, toWorkspaceRelative } from '../../workspacePath';
import { readWorkspaceText } from '../../workspaceFs';
import { previewMedia, type WorkspacePreview } from '../../../shared/filePreview';

const TEXT_FILE = /\.(?:md|markdown|mdx|txt|html?|css|js|jsx|ts|tsx|json|jsonc|yaml|yml|toml|xml|svg|csv|py|sh|ps1|sql|log|ini|conf|gitignore)$/i;

/** Read-only previews share the same canonical workspace boundary as file tools. */
export function createWorkspacePreviewRouter(settings: Pick<SettingsStore, 'get'>) {
  const router = new Hono();
  router.get('/preview', async (c) => {
    try {
      const root = (await settings.get()).workspacePath;
      const candidate = c.req.query('path');
      if (!root || !candidate) return c.json({ error: '请先绑定工作区，并选择文件' }, 400);
      const abs = resolveInsideWorkspace(root, candidate);
      if (!(await stat(abs)).isFile()) return c.json({ error: '请选择文件' }, 400);
      const relative = toWorkspaceRelative(root, abs);
      const media = previewMedia(path.extname(abs).slice(1).toLowerCase());
      const preview: WorkspacePreview = media ? { kind: media.kind, path: relative }
        : TEXT_FILE.test(abs) ? { kind: 'text', ...await readWorkspaceText(root, relative), path: relative }
          : { kind: 'unsupported', path: relative };
      return c.json(preview, 200, { 'cache-control': 'no-store' });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : '无法预览文件' }, 400);
    }
  });
  router.get('/media', async (c) => {
    try {
      const root = (await settings.get()).workspacePath;
      const candidate = c.req.query('path');
      if (!root || !candidate) return c.json({ error: '未选择工作区文件' }, 400);
      const abs = resolveInsideWorkspace(root, candidate);
      const media = previewMedia(path.extname(abs).slice(1).toLowerCase());
      if (!media) return c.json({ error: '此格式不支持媒体预览' }, 415);
      const info = await stat(abs);
      if (!info.isFile()) return c.json({ error: '不是文件' }, 400);
      const headers = { 'content-type': media.mime, 'accept-ranges': 'bytes', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" };
      const range = c.req.header('range');
      let start = 0, end = info.size - 1;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return c.body(null, 416, { 'content-range': `bytes */${info.size}` });
        start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size)
          return c.body(null, 416, { 'content-range': `bytes */${info.size}` });
      }
      if (!info.size) return c.body(null, 200, { ...headers, 'content-length': '0' });
      const stream = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream<Uint8Array>;
      return new Response(stream, { status: range ? 206 : 200, headers: { ...headers,
        'content-length': String(end - start + 1), ...(range ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}) } });
    } catch {
      return c.json({ error: '文件不存在或不在当前工作区中' }, 404);
    }
  });
  return router;
}
