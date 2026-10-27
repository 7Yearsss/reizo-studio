import { describe, expect, it } from 'vitest';
import { browserRequestAllowed, browserUrlProblem } from './browserUrl';

describe('browserUrlProblem', () => {
  it('allows ordinary public pages', () => {
    for (const ok of ['https://example.com/a?b=1', 'http://news.example.co.uk', 'https://203.0.113.5/x']) expect(browserUrlProblem(ok)).toBeNull();
  });
  it('refuses this machine, private networks, other schemes and credentials', () => {
    for (const bad of [
      'http://localhost:3000', 'http://127.0.0.1/', 'http://192.168.1.1/admin', 'http://10.0.0.5', 'http://169.254.169.254/latest/meta-data',
      'http://[::1]/', 'http://printer.local/', 'http://intranet/', 'http://db.internal/',
      'file:///etc/passwd', 'ftp://example.com/x', 'javascript:alert(1)', 'https://user:pw@example.com/', 'not a url', `https://example.com/${'a'.repeat(2100)}`,
    ]) expect(browserUrlProblem(bad)).not.toBeNull();
  });
});

describe('browserRequestAllowed', () => {
  it('lets a page load public resources and inline data, but not reach inward', () => {
    expect(browserRequestAllowed('https://cdn.example.com/app.js')).toBe(true);
    expect(browserRequestAllowed('data:image/png;base64,AAAA')).toBe(true);
    expect(browserRequestAllowed('http://127.0.0.1:47100/api/settings')).toBe(false);
    expect(browserRequestAllowed('file:///c:/secret.txt')).toBe(false);
  });
});
