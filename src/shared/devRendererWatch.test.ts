import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'vite';
import { expect, it, vi } from 'vitest';
import rendererConfig from '../../vite.renderer.config.mjs';

it('ignores backend, documentation and tests while retaining renderer and shared hot updates', async () => {
  const root = await realpath(await mkdtemp(path.resolve('.startup-watch-')));
  const files = ['docs/notes.md', 'src/main/index.ts', 'src/preload/preload.ts', 'src/renderer/view.test.tsx', 'src/renderer/view.tsx', 'src/shared/value.ts'];
  for (const file of files) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), 'before'); }
  const server = await createServer({ ...rendererConfig, configFile: false, root, plugins: [], optimizeDeps: { noDiscovery: true, include: [] }, server: { ...rendererConfig.server, port: 0, hmr: false, watch: { ...rendererConfig.server.watch, usePolling: true, interval: 50 } } });
  try {
    const ready = once(server.watcher, 'ready');
    await ready;
    const changes: string[] = [];
    server.watcher.on('change', file => changes.push(path.relative(root, file).replace(/\\/g, '/')));
    for (const file of files) await writeFile(path.join(root, file), 'after');
    await vi.waitFor(() => { expect(changes).toContain('src/renderer/view.tsx'); expect(changes).toContain('src/shared/value.ts'); }, { timeout: 4000 });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect([...new Set(changes)].sort()).toEqual(['src/renderer/view.tsx', 'src/shared/value.ts']);
  } finally {
    await server.close();
    if (path.dirname(root) === await realpath(process.cwd()) && path.basename(root).startsWith('.startup-watch-')) {
      await rm(root, { recursive: true, force: true });
    }
  }
}, 20000);
