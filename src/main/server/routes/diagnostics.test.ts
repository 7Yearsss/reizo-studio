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
  it('self-check reports a writable data folder, a broken mcp.json and a missing provider key as separate rows', async () => {
    await writeFile(path.join(root, 'mcp.json'), '{ not json');
    const router = createDiagnosticsRouter({ dataRoot: root, settingsStore: { get: async () => ({ activeProviderId: 'openai', providers: {} }) } as never, skillsDirs: [] });
    const body = (await (await router.request('/check')).json()) as { status: string; results: Array<{ id: string; status: string; detail: string }> };
    const byId = Object.fromEntries(body.results.map((r) => [r.id, r]));
    expect(byId['data-dir'].status).toBe('ok');
    expect(byId.mcp.status).toBe('fail');
    expect(byId.provider.status).toBe('fail');
    expect(byId.provider.detail).toContain('API Key');
    expect(byId.skills.status).toBe('ok');
    expect(body.status).toBe('fail');
  });
  it('serves one conversation recorded turns, scrubbed, and cannot be pointed at another file', async () => {
    await mkdir(path.join(root, 'traces'), { recursive: true });
    await writeFile(path.join(root, 'traces', 'abc.jsonl'), `${JSON.stringify({ sessionId: 'abc', durationMs: 5, tools: [{ name: 'run_command', ok: false, error: 'bad sk-abcdefghijklmnopqrstuvwxyz0123456789' }] })}\n`);
    await writeFile(path.join(root, 'secret.jsonl'), `${JSON.stringify({ leaked: true })}\n`);
    const router = createDiagnosticsRouter({ dataRoot: root, settingsStore: {} as never });
    const body = (await (await router.request('/traces/abc')).json()) as { traces: Array<{ tools: Array<{ error: string }> }> };
    expect(body.traces).toHaveLength(1);
    expect(body.traces[0].tools[0].error).not.toContain('sk-abcdefgh');
    const sneaky = (await (await router.request('/traces/..%2Fsecret')).json()) as { traces: unknown[] };
    expect(sneaky.traces).toEqual([]);
  });
});
