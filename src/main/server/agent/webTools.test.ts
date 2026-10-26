import { afterEach, describe, expect, it } from 'vitest';
import { answerPermission, consumeInteractions, resetPermissionsForTests } from './permissions';
import { createWebTools, fetchPage, FETCH_MAX_CHARS } from './webTools';

afterEach(() => resetPermissionsForTests());

const publicDns = async () => ['93.184.216.34'];
const page = (body: string, type = 'text/html; charset=utf-8', status = 200) => (async () => new Response(body, { status, headers: { 'content-type': type } })) as unknown as typeof fetch;

describe('http_fetch', () => {
  it('returns readable text framed as untrusted content', async () => {
    const out = await fetchPage('https://example.com/a', undefined, page('<html><title>报价</title><body><script>x()</script><p>总价 100 元</p></body></html>'), publicDns);
    expect(out).toContain('<web_page url="https://example.com/a">');
    expect(out).toContain('untrusted content');
    expect(out).toContain('总价 100 元');
    expect(out).not.toContain('x()');
  });

  it('truncates a huge page and says so', async () => {
    const out = await fetchPage('https://example.com/big', undefined, page('字'.repeat(FETCH_MAX_CHARS + 500), 'text/plain'), publicDns);
    expect(out).toContain('已截断');
    expect(out.length).toBeLessThan(FETCH_MAX_CHARS + 600);
  });

  it('refuses cloud metadata, loopback and private-resolving hosts, and credentials in the URL', async () => {
    const never = (async () => { throw new Error('must not be called'); }) as unknown as typeof fetch;
    for (const url of ['http://169.254.169.254/latest/meta-data', 'http://metadata.google.internal/', 'http://100.100.100.200/', 'http://127.0.0.1:47100/api/settings', 'https://user:pw@example.com/']) {
      await expect(fetchPage(url, undefined, never, publicDns), url).rejects.toThrow('Refused');
    }
    await expect(fetchPage('https://intranet.example.com/', undefined, never, async () => ['10.0.0.8'])).rejects.toThrow('private');
  });

  it('refuses binary content types and surfaces HTTP errors', async () => {
    await expect(fetchPage('https://example.com/a.zip', undefined, page('PK', 'application/zip'), publicDns)).rejects.toThrow('Not a readable page');
    await expect(fetchPage('https://example.com/x', undefined, page('no', 'text/html', 404), publicDns)).rejects.toThrow('404');
  });

  it('asks the user first in ask mode, and fetches nothing until approved', async () => {
    const { tools, executeApproved } = createWebTools({ sessionId: 's', permissionMode: 'ask' });
    await expect((tools.http_fetch.execute as any)({ url: 'https://example.com/' }, { toolCallId: 'w1' })).rejects.toThrow('__REIZO_INTERACTION_REQUIRED__');
    answerPermission('w1', 'deny');
    expect(consumeInteractions('s')[0].decision).toBe('deny');
    expect(typeof executeApproved).toBe('function');
  });
});
