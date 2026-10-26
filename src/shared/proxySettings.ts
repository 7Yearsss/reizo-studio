export type ProxyMode = 'direct' | 'system' | 'custom';

export interface ProxySettings {
  mode: ProxyMode;
  /** For `custom`: http://host:port (credentials allowed). */
  url?: string;
  /** Comma-separated hosts that skip the proxy. */
  bypass?: string;
}

export const DEFAULT_PROXY: ProxySettings = { mode: 'direct' };

/** A usable proxy URL (http/https only; SOCKS is not supported by the HTTP client), or null. */
export function parseProxyUrl(value: string | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** Parse what Chromium's resolveProxy returns ("PROXY a:1; DIRECT") into the first usable HTTP proxy, or null for direct. */
export function proxyFromResolved(resolved: string): string | null {
  for (const part of resolved.split(';')) {
    const [kind, target] = part.trim().split(/\s+/);
    if (!kind) continue;
    const upper = kind.toUpperCase();
    if (upper === 'DIRECT') return null;
    if ((upper === 'PROXY' || upper === 'HTTP' || upper === 'HTTPS') && target) return parseProxyUrl(target);
    // SOCKS entries cannot be used here; try the next candidate.
  }
  return null;
}

export function normalizeProxy(value: unknown): ProxySettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PROXY };
  const v = value as Record<string, unknown>;
  const mode: ProxyMode = v.mode === 'system' || v.mode === 'custom' ? v.mode : 'direct';
  const url = typeof v.url === 'string' ? v.url.trim().slice(0, 300) : undefined;
  const bypass = typeof v.bypass === 'string' ? v.bypass.trim().slice(0, 500) : undefined;
  return { mode, ...(url ? { url } : {}), ...(bypass ? { bypass } : {}) };
}

/** Environment for child processes (`npm`, `git`, `curl`…) so they use the same proxy as the app. */
export function proxyEnv(proxyUrl: string | null, bypass?: string): Record<string, string> {
  if (!proxyUrl) return {};
  const env: Record<string, string> = { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl };
  const list = ['localhost', '127.0.0.1', '::1', ...(bypass ? bypass.split(',').map((s) => s.trim()).filter(Boolean) : [])].join(',');
  env.NO_PROXY = list;
  env.no_proxy = list;
  return env;
}

/** Whether `host` is on the bypass list (exact host, or a suffix like `.corp.example.com`; loopback always bypasses). */
export function shouldBypass(host: string, bypass?: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') return true;
  return (bypass ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).some((rule) => (rule.startsWith('.') ? h.endsWith(rule) || h === rule.slice(1) : h === rule || h.endsWith(`.${rule}`)));
}

/** Plain-language reading of a failed request when a proxy is involved. */
export function explainProxyFailure(error: string, status?: number): string {
  const text = error.toLowerCase();
  if (status === 407 || /407|proxy authentication/.test(text)) return '代理需要用户名和密码，或填写的认证信息不对（407）';
  if (/unable_to_verify|self.signed|cert|tls|ssl/.test(text)) return '证书校验失败：网络里的代理 / 安全软件替换了证书，需要把它的根证书装进系统';
  if (/econnrefused/.test(text)) return '代理地址连不上（连接被拒绝）：检查代理软件是否在运行、端口是否正确';
  if (/enotfound|getaddrinfo/.test(text)) return '域名解析失败：检查代理地址拼写，或网络本身是否可用';
  if (/timeout|timed out|etimedout/.test(text)) return '连接超时：代理或目标网络不可达';
  return '连接失败：检查代理地址与网络';
}
