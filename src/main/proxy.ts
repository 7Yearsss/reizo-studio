import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';
import { proxyEnv, proxyFromResolved, parseProxyUrl, shouldBypass, type ProxySettings } from '../shared/proxySettings';

/**
 * Makes the app's own HTTP (Node fetch: model providers, plugin catalog, remote MCP) honour the proxy the user chose,
 * and gives child processes the same proxy through environment variables. "system" asks Chromium what the OS
 * says for a representative HTTPS URL, so a Clash-style system proxy (no TUN) works without typing anything.
 */

let activeProxy: string | null = null;
let activeBypass: string | undefined;

export function currentProxyEnv(): Record<string, string> {
  return proxyEnv(activeProxy, activeBypass);
}

export function currentProxyUrl(): string | null {
  return activeProxy;
}

type Dispatch = Agent['dispatch'];

/** Direct for bypassed hosts, through the proxy for everything else. */
function routingDispatcher(proxyUrl: string, bypass: string | undefined) {
  const direct = new Agent();
  const proxied = new ProxyAgent(proxyUrl);
  return {
    dispatch(options: Parameters<Dispatch>[0], handler: Parameters<Dispatch>[1]) {
      let host = '';
      try { host = new URL(String(options.origin)).hostname; } catch { /* fall through to the proxy */ }
      return (host && shouldBypass(host, bypass) ? direct : proxied).dispatch(options, handler);
    },
    close: async () => { await Promise.all([direct.close(), proxied.close()]); },
    destroy: async () => { await Promise.all([direct.destroy(), proxied.destroy()]); },
  };
}

/** Apply `settings`. `resolveSystem` returns Chromium's answer for a URL ("PROXY host:port; DIRECT"). */
export async function applyProxy(settings: ProxySettings, resolveSystem?: (url: string) => Promise<string>): Promise<{ effective: string | null; error?: string }> {
  let target: string | null = null;
  let error: string | undefined;
  if (settings.mode === 'custom') {
    target = parseProxyUrl(settings.url);
    if (!target) error = '代理地址格式不对，应类似 http://127.0.0.1:7890';
  } else if (settings.mode === 'system') {
    try { target = proxyFromResolved(await (resolveSystem?.('https://api.openai.com') ?? Promise.resolve('DIRECT'))); }
    catch { error = '读取系统代理失败，已改为直连'; }
  }
  activeProxy = target;
  activeBypass = settings.bypass;
  // Hand the global dispatcher back to a plain agent when there is no proxy, so turning it off really turns it off.
  setGlobalDispatcher(target ? (routingDispatcher(target, settings.bypass) as never) : new Agent());
  return { effective: target, ...(error ? { error } : {}) };
}
