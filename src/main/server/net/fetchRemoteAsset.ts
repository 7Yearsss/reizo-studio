import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPrivateAddress, rejectRemoteUrl } from '../../../shared/remoteUrlSafety';

export const DEFAULT_MAX_ASSET_BYTES = 512 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export class RemoteFetchError extends Error {}

export interface FetchRemoteAssetOptions {
  signal?: AbortSignal;
  maxBytes?: number;
  /** Test seam: resolve a hostname to addresses. */
  resolve?: (host: string) => Promise<string[]>;
  fetchImpl?: typeof fetch;
}

async function resolveAll(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((r) => r.address);
}

async function assertPublicHost(url: URL, resolve: (host: string) => Promise<string[]>): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : await resolve(host);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new RemoteFetchError(`Refused to download from a private or unresolvable address (${url.hostname})`);
  }
}

/**
 * Download a provider-returned asset URL safely: http(s) only, no credentials,
 * no private/loopback targets (checked on every redirect hop), redirects
 * capped and revalidated, response size capped. DNS is checked before
 * connecting, not pinned, so a rebinding attacker with a tiny TTL is reduced
 * but not eliminated.
 */
export interface RemoteResponse { body: Buffer; contentType: string; finalUrl: string }

export async function fetchRemote(rawUrl: string, options: FetchRemoteAssetOptions = {}): Promise<RemoteResponse> {
  const resolve = options.resolve ?? resolveAll;
  const doFetch = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_ASSET_BYTES;
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const rejection = rejectRemoteUrl(current);
    if (rejection) throw new RemoteFetchError(`Refused to download asset: ${rejection}`);
    const url = new URL(current);
    await assertPublicHost(url, resolve);
    const response = await doFetch(url, { signal: options.signal, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new RemoteFetchError(`Redirect without location (${response.status})`);
      await response.body?.cancel().catch((): void => undefined);
      current = new URL(location, url).href;
      continue;
    }
    if (!response.ok) throw new RemoteFetchError(`Download failed (${response.status})`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch((): void => undefined);
      throw new RemoteFetchError(`Asset exceeds ${maxBytes} bytes`);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    if (!reader) return { body: Buffer.alloc(0), contentType: response.headers.get('content-type') ?? '', finalUrl: url.href };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch((): void => undefined);
        throw new RemoteFetchError(`Asset exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
    return { body: Buffer.concat(chunks), contentType: response.headers.get('content-type') ?? '', finalUrl: url.href };
  }
  throw new RemoteFetchError('Too many redirects');
}

export async function fetchRemoteAsset(rawUrl: string, options: FetchRemoteAssetOptions = {}): Promise<Buffer> {
  return (await fetchRemote(rawUrl, options)).body;
}
