/** Only explicit provider endpoints may receive credentials; response URLs cannot choose a new origin. */
export function providerUrl(value: string): URL {
  const url = new URL(value);
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.hash || url.search) throw new Error('Invalid video provider endpoint');
  return url;
}

export function falRemoteContextValid(taskId: string, context?: Record<string, unknown>): boolean {
  try {
    if (!taskId?.trim() || typeof context?.baseUrl !== 'string' || typeof context.statusUrl !== 'string' || typeof context.responseUrl !== 'string') return false;
    const configured = providerUrl(context.baseUrl);
    const status = providerUrl(context.statusUrl);
    const response = providerUrl(context.responseUrl);
    if (configured.origin !== status.origin || configured.origin !== response.origin) return false;
    const suffix = `/requests/${encodeURIComponent(taskId)}`;
    const index = status.pathname.lastIndexOf(suffix);
    if (index <= 0 || status.pathname.slice(index) !== `${suffix}/status`) return false;
    const root = status.pathname.slice(0, index);
    // fal may canonicalize a versioned submit endpoint to its application root.
    if (configured.pathname !== root && !configured.pathname.startsWith(`${root}/`)) return false;
    return response.pathname === `${root}${suffix}` || response.pathname === `${root}${suffix}/response`;
  } catch { return false; }
}

export function klingRemoteContextValid(taskId: string, context?: Record<string, unknown>): boolean {
  try {
    if (!taskId?.trim() || typeof context?.baseUrl !== 'string') return false;
    providerUrl(context.baseUrl);
    return context.queryPath === '/v1/videos/text2video' || context.queryPath === '/v1/videos/image2video';
  } catch { return false; }
}
