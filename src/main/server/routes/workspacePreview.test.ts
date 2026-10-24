import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspacePreviewRouter } from './workspacePreview';
import type { SettingsStore } from '../storage/settingsStore';

describe('workspace previews', () => {
  let temp: string, root: string;
  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'reizo-file-preview-'));
    root = path.join(temp, 'workspace'); await mkdir(root);
    await writeFile(path.join(root, '说明.md'), '# 预览\n\n**完成**');
    await writeFile(path.join(root, 'clip.mp4'), '0123456789');
    await writeFile(path.join(temp, 'outside.md'), 'private');
  });
  afterEach(async () => { await rm(temp, { recursive: true, force: true }); });
  const router = () => createWorkspacePreviewRouter({ get: async () => ({ workspacePath: root }) } as Pick<SettingsStore, 'get'>);
  it('previews text and classifies media without treating it as UTF-8', async () => {
    const app = router();
    const text = await app.request(`/preview?path=${encodeURIComponent('说明.md')}`);
    expect(await text.json()).toMatchObject({ kind: 'text', content: '# 预览\n\n**完成**', truncated: false });
    expect(await (await app.request('/preview?path=clip.mp4')).json()).toEqual({ kind: 'video', path: 'clip.mp4' });
  });
  it('supports byte ranges for video playback and rejects invalid ranges', async () => {
    const app = router();
    const response = await app.request('/media?path=clip.mp4', { headers: { range: 'bytes=2-5' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await response.text()).toBe('2345');
    expect(await (await app.request('/media?path=clip.mp4', { headers: { range: 'bytes=-3' } })).text()).toBe('789');
    expect((await app.request('/media?path=clip.mp4', { headers: { range: 'bytes=10-15' } })).status).toBe(416);
  });
  it('rejects traversal, absolute outside paths and directory links outside the workspace', async () => {
    const app = router();
    for (const file of ['../outside.md', path.join(temp, 'outside.md')]) {
      expect((await app.request(`/preview?path=${encodeURIComponent(file)}`)).status).toBe(400);
    }
    await symlink(temp, path.join(root, 'escape'), 'junction');
    expect((await app.request('/preview?path=escape/outside.md')).status).toBe(400);
    expect((await app.request('/media?path=escape/outside.md')).status).toBe(404);
  });
  it('does not serve active HTML through the media endpoint', async () => {
    await writeFile(path.join(root, 'page.html'), '<script>alert(1)</script>');
    expect((await router().request('/media?path=page.html')).status).toBe(415);
  });
});
