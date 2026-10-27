import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_EGRESS } from '../shared/egressSettings';
import { applyEgress, blockedSince, egressEnv, stopEgress } from './egressControl';

afterEach(async () => { await stopEgress(); });

function viaProxy(proxyUrl: string, target: string): Promise<number> {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: proxy.hostname, port: Number(proxy.port), path: target, headers: { host: new URL(target).host } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end();
  });
}

describe('egress control', () => {
  it('reports only the hosts refused after a given moment', async () => {
    await applyEgress({ ...DEFAULT_EGRESS, enabled: true });
    const proxyUrl = egressEnv().HTTP_PROXY;
    await viaProxy(proxyUrl, 'http://203.0.113.5/before');
    const since = Date.now() + 1;
    await new Promise((r) => { setTimeout(r, 5); });
    expect(blockedSince(since)).toEqual([]);
    expect(await viaProxy(proxyUrl, 'http://203.0.113.9/after')).toBe(403);
    expect(blockedSince(since)).toEqual(['203.0.113.9']);
  });
});
