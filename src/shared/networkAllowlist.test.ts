import { describe, expect, it } from 'vitest';
import { BUILTIN_ALLOWED_HOSTS, hostAllowed, isPrivateAddress, parseHostRule, parseHostRules } from './networkAllowlist';

const rules = parseHostRules([...BUILTIN_ALLOWED_HOSTS, 'api.example.com', '*.corp.example', '203.0.113.0/24']);

describe('hostAllowed', () => {
  it('allows named hosts, wildcard subdomains and CIDR members only', () => {
    expect(hostAllowed('registry.npmjs.org', rules)).toBe(true);
    expect(hostAllowed('API.Example.com.', rules)).toBe(true);
    expect(hostAllowed('git.corp.example', rules)).toBe(true);
    expect(hostAllowed('corp.example', rules)).toBe(false);
    expect(hostAllowed('evilcorp.example', rules)).toBe(false);
    expect(hostAllowed('203.0.113.77', rules)).toBe(true);
    expect(hostAllowed('203.0.114.1', rules)).toBe(false);
    expect(hostAllowed('attacker.com', rules)).toBe(false);
  });
  it('refuses private targets unless opted in, including a public name that resolved to one', () => {
    const open = parseHostRules(['*.internal.test', '10.0.0.0/8', 'localhost']);
    expect(hostAllowed('10.1.2.3', open)).toBe(false);
    expect(hostAllowed('10.1.2.3', open, { allowPrivate: true })).toBe(true);
    expect(hostAllowed('db.internal.test', open, { address: '127.0.0.1' })).toBe(false);
    expect(hostAllowed('localhost', open)).toBe(false);
  });
  it('recognises private ranges', () => {
    for (const a of ['127.0.0.1', '192.168.1.5', '172.20.0.1', '169.254.169.254', '::1', 'fe80::1', '::ffff:10.0.0.1']) expect(isPrivateAddress(a)).toBe(true);
    for (const a of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(isPrivateAddress(a)).toBe(false);
  });
  it('drops malformed rules', () => {
    for (const bad of ['', 'a b', 'http://x.com', '*.', '10.0.0.0/40', 'x.com:443']) expect(parseHostRule(bad)).toBeNull();
  });
});
