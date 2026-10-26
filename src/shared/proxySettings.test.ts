import { describe, expect, it } from 'vitest';
import { explainProxyFailure, normalizeProxy, parseProxyUrl, proxyEnv, proxyFromResolved, shouldBypass } from './proxySettings';

describe('proxy settings', () => {
  it('accepts http(s) proxies with or without a scheme, rejects socks and junk', () => {
    expect(parseProxyUrl('127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
    expect(parseProxyUrl('http://user:pw@proxy.corp:8080/')).toBe('http://user:pw@proxy.corp:8080');
    expect(parseProxyUrl('socks5://127.0.0.1:1080')).toBeNull();
    expect(parseProxyUrl('')).toBeNull();
    expect(parseProxyUrl('not a url ::')).toBeNull();
  });

  it('reads the system proxy answer: first usable HTTP proxy, DIRECT means none, SOCKS is skipped', () => {
    expect(proxyFromResolved('PROXY 127.0.0.1:7890; DIRECT')).toBe('http://127.0.0.1:7890');
    expect(proxyFromResolved('DIRECT')).toBeNull();
    expect(proxyFromResolved('SOCKS5 127.0.0.1:1080; PROXY p:3128')).toBe('http://p:3128');
    expect(proxyFromResolved('')).toBeNull();
  });

  it('normalizes stored values defensively', () => {
    expect(normalizeProxy(null)).toEqual({ mode: 'direct' });
    expect(normalizeProxy({ mode: 'bogus' })).toEqual({ mode: 'direct' });
    expect(normalizeProxy({ mode: 'custom', url: ' 127.0.0.1:1 ', bypass: ' a.com ' })).toEqual({ mode: 'custom', url: '127.0.0.1:1', bypass: 'a.com' });
  });

  it('gives child processes the proxy variables and always bypasses loopback', () => {
    const env = proxyEnv('http://p:1', '.corp.example.com');
    expect(env.HTTPS_PROXY).toBe('http://p:1');
    expect(env.https_proxy).toBe('http://p:1');
    expect(env.NO_PROXY).toContain('127.0.0.1');
    expect(env.NO_PROXY).toContain('.corp.example.com');
    expect(proxyEnv(null)).toEqual({});
  });

  it('bypass matches hosts and suffixes, loopback always', () => {
    expect(shouldBypass('localhost')).toBe(true);
    expect(shouldBypass('intranet.corp.example.com', '.corp.example.com')).toBe(true);
    expect(shouldBypass('api.openai.com', '.corp.example.com')).toBe(false);
    expect(shouldBypass('x.test', 'x.test')).toBe(true);
    expect(shouldBypass('sub.x.test', 'x.test')).toBe(true);
  });

  it('explains failures in separate plain sentences', () => {
    const msgs = [explainProxyFailure('', 407), explainProxyFailure('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), explainProxyFailure('connect ECONNREFUSED 127.0.0.1:7890'), explainProxyFailure('getaddrinfo ENOTFOUND px'), explainProxyFailure('timed out')];
    expect(new Set(msgs).size).toBe(5);
    expect(msgs[0]).toContain('407');
  });
});
