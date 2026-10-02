import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { readCanvasAsset, stageCanvasAssets } from './assets';

it('publishes frozen bytes, cleans only cancelled files and keeps legacy reads confined to the asset root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reizo-files-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'reizo-files-outside-'));
  try {
    const dir = path.join(root, 'canvas', 'scene');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'legacy.png'), 'legacy bytes');
    const bytes = Buffer.from('new bytes');
    const pending = stageCanvasAssets(root, 'scene', [{ name: 'legacy.png', bytes, kind: 'image', mimeType: 'image/png' }]);
    bytes.fill(0);
    const published = await pending;
    expect(published.files[0].contentHash).toBe(createHash('sha256').update('new bytes').digest('hex'));
    expect((await readCanvasAsset(root, published.files[0].path)).toString()).toBe('new bytes');
    published.keep(); await published.discard();
    const abort = new AbortController();
    const cancelled = await stageCanvasAssets(root, 'scene', [{ name: 'cancelled.png', bytes: Buffer.from('discard'), kind: 'image', mimeType: 'image/png' }], abort.signal);
    abort.abort(); await cancelled.discard();
    expect((await readCanvasAsset(root, 'scene/legacy.png')).toString()).toBe('legacy bytes');
    expect((await readdir(dir)).sort()).toEqual(['legacy.png', path.basename(published.files[0].path)].sort());
    await expect(readCanvasAsset(root, '../outside.png')).rejects.toThrow();
    await writeFile(path.join(outside, 'outside.png'), 'outside bytes');
    await symlink(outside, path.join(root, 'canvas', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(readCanvasAsset(root, 'escape/outside.png')).rejects.toThrow();
    await expect(stageCanvasAssets(root, 'escape', [{ name: 'new.png', bytes: Buffer.from('no write'), kind: 'image', mimeType: 'image/png' }])).rejects.toThrow();
    expect(await readdir(outside)).toEqual(['outside.png']);
  } finally {
    for (const dir of [root, outside]) if (path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir())) await rm(dir, { recursive: true, force: true });
  }
});
