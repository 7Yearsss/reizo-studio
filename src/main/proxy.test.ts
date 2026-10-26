import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProxy, currentProxyEnv, currentProxyUrl } from './proxy';

const servers: Array<http.Server | net.Server> = [];
afterEach(async () => {
  await applyProxy({ mode: 'direct' });
  for (const s of servers.splice(0)) await new Promise<void>((resolve) => s.close(() => resolve()));
});

const listen = (server: http.Server): Promise<number> => new Promise((resolve) => { servers.push(server); server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)); });

/** A CONNECT proxy that sends every tunnel to one local target, whatever host was asked for. */
async function startProxy(targetPort: number, seen: string[]): Promise<number> {
  const proxy = http.createServer();
  proxy.on('connect', (req, clientSocket, head) => {
    seen.push(req.url ?? '');
    const upstream = net.connect(targetPort, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });
  return listen(proxy);
}

describe('applyProxy', () => {
  it('routes the app\'s fetch through a custom proxy, skips it for bypassed hosts, and turning it off restores direct', async () => {
    const target = http.createServer((_req, res) => { res.end('via-proxy'); });
    const targetPort = await listen(target);
    const seen: string[] = [];
    const proxyPort = await startProxy(targetPort, seen);

    const applied = await applyProxy({ mode: 'custom', url: `127.0.0.1:${proxyPort}` });
    expect(applied.effective).toBe(`http://127.0.0.1:${proxyPort}`);
    expect(currentProxyEnv().HTTPS_PROXY).toBe(`http://127.0.0.1:${proxyPort}`);
    const res = await fetch('http://app-proxy-check.test/');
    expect(await res.text()).toBe('via-proxy');
    expect(seen).toEqual(['app-proxy-check.test:80']);

    // Loopback never goes through the proxy.
    const local = await fetch(`http://127.0.0.1:${targetPort}/`);
    expect(await local.text()).toBe('via-proxy');
    expect(seen).toHaveLength(1);

    await applyProxy({ mode: 'direct' });
    expect(currentProxyUrl()).toBeNull();
    expect(currentProxyEnv()).toEqual({});
    // Direct again: the proxy is no longer asked (the request itself may fail or hang depending on DNS here).
    await fetch('http://app-proxy-check.test/', { signal: AbortSignal.timeout(1500) }).catch((): void => undefined);
    expect(seen).toHaveLength(1);
  }, 20000);

  it('the system mode uses what the OS answers; a bad custom address is reported, not applied', async () => {
    const system = await applyProxy({ mode: 'system' }, async () => 'PROXY 10.1.2.3:3128; DIRECT');
    expect(system.effective).toBe('http://10.1.2.3:3128');
    const none = await applyProxy({ mode: 'system' }, async () => 'DIRECT');
    expect(none.effective).toBeNull();
    const broken = await applyProxy({ mode: 'system' }, async () => { throw new Error('no electron'); });
    expect(broken.error).toBeTruthy();
    const bad = await applyProxy({ mode: 'custom', url: 'socks5://x:1' });
    expect(bad.effective).toBeNull();
    expect(bad.error).toContain('格式');
  });
});
