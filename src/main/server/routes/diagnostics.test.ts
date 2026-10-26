import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDiagnosticsRouter } from './diagnostics';

const KEY = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';

describe('diagnostics bundle', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'reizo-diag-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('carries versions and recent traces but no key, password or image bytes', async () => {
    await mkdir(path.join(root, 'traces'));
    const trace = { sessionId: 's1', model: 'gpt-4o', tools: [{ name: 'browser_fill', input: { password: 'hunter2hunter2' }, output: `leaked ${KEY} data:image/png;base64,${'B'.repeat(3000)}` }] };
    await writeFile(path.join(root, 'traces', 's1.jsonl'), `${JSON.stringify(trace)}\nnot json\n`);
    const router = createDiagnosticsRouter({ dataRoot: root, settingsStore: { getPublic: async () => ({ activeProviderId: 'openai', providers: [{ id: 'openai', apiKey: KEY, hasKey: true }] }) } as never });

    const res = await router.request('/bundle');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('hunter2hunter2');
    expect(text).not.toContain('B'.repeat(200));
    expect(text).toContain('[image:');
    const body = JSON.parse(text) as { runtime: { platform: string }; traces: Array<{ sessionId: string }>; settings: { activeProviderId: string } };
    expect(body.runtime.platform).toBe(process.platform);
    expect(body.traces.map((t) => t.sessionId)).toEqual(['s1']);
    expect(body.settings.activeProviderId).toBe('openai');
  });

  it('works with no traces yet', async () => {
    const router = createDiagnosticsRouter({ dataRoot: root, settingsStore: { getPublic: async () => ({}) } as never });
    const body = (await (await router.request('/bundle')).json()) as { traces: unknown[] };
    expect(body.traces).toEqual([]);
  });
});
