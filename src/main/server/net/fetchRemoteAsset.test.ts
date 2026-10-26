import { describe, expect, it } from 'vitest';
import { fetchRemoteAsset, RemoteFetchError } from './fetchRemoteAsset';

const publicDns = async () => ['93.184.216.34'];
const respond = (body: string, init: ResponseInit = {}) => (async () => new Response(body, init)) as unknown as typeof fetch;

describe('fetchRemoteAsset', () => {
  it('downloads from a public host', async () => {
    const out = await fetchRemoteAsset('https://cdn.example.com/a.mp4', { resolve: publicDns, fetchImpl: respond('hello') });
    expect(out.toString()).toBe('hello');
  });

  it('refuses loopback literals without fetching', async () => {
    let called = false;
    const fetchImpl = (async () => { called = true; return new Response('x'); }) as unknown as typeof fetch;
    await expect(fetchRemoteAsset('http://127.0.0.1:47100/api/settings', { fetchImpl })).rejects.toBeInstanceOf(RemoteFetchError);
    expect(called).toBe(false);
  });

  it('refuses hostnames that resolve to private addresses', async () => {
    await expect(fetchRemoteAsset('https://evil.example.com/a', { resolve: async () => ['10.0.0.5'], fetchImpl: respond('x') })).rejects.toThrow(/private/);
  });

  it('revalidates redirect targets', async () => {
    const fetchImpl = (async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } })) as unknown as typeof fetch;
    await expect(fetchRemoteAsset('https://cdn.example.com/a', { resolve: publicDns, fetchImpl })).rejects.toThrow(/Refused/);
  });

  it('stops at the size cap', async () => {
    await expect(fetchRemoteAsset('https://cdn.example.com/a', { resolve: publicDns, fetchImpl: respond('0123456789'), maxBytes: 4 })).rejects.toThrow(/exceeds/);
  });
});
