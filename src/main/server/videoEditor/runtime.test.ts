import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadEditorRuntime } from './runtime';

const roots: string[] = [];
const original = process.env.REIZO_VIDEO_EDITOR_RUNTIME;
afterEach(async () => {
  if (original === undefined) delete process.env.REIZO_VIDEO_EDITOR_RUNTIME;
  else process.env.REIZO_VIDEO_EDITOR_RUNTIME = original;
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function manifest(change: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'reizo-editor-runtime-'));
  roots.push(root);
  const file = path.join(root, 'runtime.json');
  await writeFile(file, JSON.stringify({ kind: 'packaged', entry: 'server.mjs', node: 'node.exe', browserExecutable: 'browser/chrome.exe', renderBundle: 'render-bundle', renderBundleId: 'a'.repeat(64), integrationVersion: 2, ...change }));
  return { root, file };
}
describe('installed editor runtime', () => {
  it('resolves every executable and render path relative to the relocated manifest', async () => {
    const { root, file } = await manifest();
    process.env.REIZO_VIDEO_EDITOR_RUNTIME = file;
    expect(await loadEditorRuntime()).toMatchObject({ source: root, entry: path.join(root, 'server.mjs'), node: path.join(root, 'node.exe'), renderBundle: path.join(root, 'render-bundle'), packaged: true });
  });
  it('rejects resources outside the installation', async () => {
    for (const entry of ['../checkout/server.mjs', path.resolve('checkout/server.mjs')]) {
      const { file } = await manifest({ entry });
      await expect(loadEditorRuntime(file)).rejects.toThrow(/资源/);
    }
  });
  it('cannot silently fall back to a development manifest when installed resources are absent', async () => {
    const { root, file } = await manifest({ kind: 'development', source: process.cwd() });
    process.env.REIZO_VIDEO_EDITOR_RUNTIME = file;
    await expect(loadEditorRuntime()).rejects.toThrow('必须使用编译后的资源');
    process.env.REIZO_VIDEO_EDITOR_RUNTIME = path.join(root, 'missing.json');
    await expect(loadEditorRuntime()).rejects.toThrow('重新安装');
  });
});
