import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { parseHostRules } from '../shared/networkAllowlist';
import { NETWORK_BLOCKED_MARK, startEgressProxy, type EgressProxy } from './egressProxy';

let proxy: EgressProxy | undefined;
let origin: http.Server | undefined;
afterEach(async () => { await proxy?.close(); origin?.close(); proxy = undefined; origin = undefined; });

async function startOrigin(): Promise<number> {
  origin = http.createServer((_req, res) => res.end('hello from origin'));
  await new Promise<void>((resolve) => origin!.listen(0, '127.0.0.1', resolve));
  return (origin.address() as AddressInfo).port;
}

function viaProxy(port: number, target: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, headers: { host: new URL(target).host } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('egress proxy', () => {
  it('forwards an allowed host and refuses everything else, naming the host', async () => {
    const originPort = await startOrigin();
    const blocked: string[] = [];
    proxy = await startEgressProxy({ rules: () => parseHostRules(['127.0.0.1']), allowPrivate: () => true, onBlocked: (h) => blocked.push(h) });
    expect(await viaProxy(proxy.port, `http://127.0.0.1:${originPort}/x`)).toEqual({ status: 200, body: 'hello from origin' });
    const denied = await viaProxy(proxy.port, 'http://203.0.113.9/x');
    expect(denied.status).toBe(403);
    expect(denied.body).toBe(`${NETWORK_BLOCKED_MARK} 203.0.113.9`);
    expect(blocked).toEqual(['203.0.113.9']);
  });

  it('refuses a private target by default even when a rule names it', async () => {
    const originPort = await startOrigin();
    proxy = await startEgressProxy({ rules: () => parseHostRules(['127.0.0.1']) });
    expect((await viaProxy(proxy.port, `http://127.0.0.1:${originPort}/`)).status).toBe(403);
  });

  it('answers CONNECT to a blocked host with 403 and never opens the tunnel', async () => {
    proxy = await startEgressProxy({ rules: () => parseHostRules(['registry.npmjs.org']) });
    const reply = await new Promise<string>((resolve) => {
      const socket = net.connect(proxy!.port, '127.0.0.1', () => socket.write('CONNECT 203.0.113.9:443 HTTP/1.1\r\nHost: 203.0.113.9:443\r\n\r\n'));
      let data = '';
      socket.on('data', (c) => { data += c; });
      socket.on('close', () => resolve(data));
    });
    expect(reply).toContain('403');
    expect(reply).toContain(NETWORK_BLOCKED_MARK);
  });
});
