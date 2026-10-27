import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { egressEnv, stopEgress } from '../../egressControl';
import { createNetworkRouter } from './network';

describe('network isolation settings', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'reizo-egress-')); });
  afterEach(async () => { await stopEgress(); await rm(root, { recursive: true, force: true }); });

  it('stays off by default, turns the proxy on when enabled, and keeps added hosts', async () => {
    const router = createNetworkRouter({ dataRoot: root, resolveSystem: async () => 'DIRECT' });
    expect(egressEnv()).toEqual({});
    const put = await router.request('/egress', { method: 'PUT', body: JSON.stringify({ enabled: true, allow: ['api.example.com'] }) });
    expect(put.status).toBe(200);
    expect(egressEnv().HTTPS_PROXY).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(egressEnv().NO_PROXY).toBe('');

    const added = (await (await router.request('/egress/allow', { method: 'POST', body: JSON.stringify({ host: 'cdn.example.com' }) })).json()) as { settings: { allow: string[] } };
    expect(added.settings.allow).toEqual(['api.example.com', 'cdn.example.com']);
    const junk = (await (await router.request('/egress/allow', { method: 'POST', body: JSON.stringify({ host: 'x y' }) })).json()) as { settings: { allow: string[] } };
    expect(junk.settings.allow).toEqual(['api.example.com', 'cdn.example.com']);

    await router.request('/egress', { method: 'PUT', body: JSON.stringify({ enabled: false }) });
    expect(egressEnv()).toEqual({});
  });
});
