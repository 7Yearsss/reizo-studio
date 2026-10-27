import http from 'node:http';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { hostAllowed, type HostRule } from '../shared/networkAllowlist';

export const NETWORK_BLOCKED_MARK = '[reizo-network-blocked]';

export interface EgressProxyOptions {
  rules: () => readonly HostRule[];
  allowPrivate?: () => boolean;
  /** Called once per refused request, with the host the command tried to reach. */
  onBlocked?: (host: string) => void;
}

export interface EgressProxy { port: number; url: string; close(): Promise<void> }

/**
 * A loopback HTTP / CONNECT proxy that only forwards to allowed hosts. Programs that honour HTTP(S)_PROXY (curl, npm,
 * pip, git, most SDKs) go through it; a program that ignores the variables is not constrained — this is a guard
 * against accidents and prompt-injected exfiltration through ordinary tools, not an OS-level sandbox.
 */
export async function startEgressProxy(options: EgressProxyOptions): Promise<EgressProxy> {
  async function check(host: string): Promise<{ ok: true; address: string } | { ok: false }> {
    try {
      const address = net.isIP(host) ? host : (await lookup(host)).address;
      const ok = hostAllowed(host, options.rules(), { allowPrivate: options.allowPrivate?.(), address });
      if (!ok) options.onBlocked?.(host);
      return ok ? { ok: true, address } : { ok: false };
    } catch {
      options.onBlocked?.(host);
      return { ok: false };
    }
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      let target: URL;
      try { target = new URL(req.url ?? ''); } catch { res.writeHead(400).end('bad request'); return; }
      if (target.protocol !== 'http:') { res.writeHead(405).end('use CONNECT for https'); return; }
      const verdict = await check(target.hostname);
      if (!verdict.ok) { res.writeHead(403, { 'content-type': 'text/plain' }).end(`${NETWORK_BLOCKED_MARK} ${target.hostname}`); return; }
      const upstream = http.request({ host: verdict.address, port: Number(target.port) || 80, path: `${target.pathname}${target.search}`, method: req.method, headers: { ...req.headers, host: target.host } }, (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(upstream);
    })();
  });

  server.on('connect', (req, socket, head) => {
    void (async () => {
      const [host, portText] = (req.url ?? '').split(/:(?=\d+$)/);
      const verdict = await check((host ?? '').replace(/^\[|\]$/g, ''));
      if (!verdict.ok) { socket.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\n${NETWORK_BLOCKED_MARK} ${host}`); return; }
      const upstream = net.connect(Number(portText) || 443, verdict.address, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
    })();
  });

  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
