import { describe, expect, it } from 'vitest';
import { deepLinkFromArgv, parseDeepLink } from './deepLink';

describe('parseDeepLink', () => {
  it('understands a skill install link', () => {
    expect(parseDeepLink('reizo://skill/install?namespace=acme&slug=weekly-report&version=1.2.0')).toEqual({ kind: 'install-skill', namespace: 'acme', slug: 'weekly-report', version: '1.2.0' });
    expect(parseDeepLink('reizo://skill/install?namespace=acme&slug=x')).toEqual({ kind: 'install-skill', namespace: 'acme', slug: 'x' });
  });
  it('drops anything it does not recognise', () => {
    for (const bad of [
      'https://skill/install?namespace=a&slug=b',
      'reizo://settings/reset',
      'reizo://skill/install?namespace=a',
      'reizo://skill/install?namespace=../x&slug=b',
      'reizo://skill/install?namespace=a&slug=b&version=1 2',
      'not a url',
      `reizo://skill/install?namespace=a&slug=${'x'.repeat(200)}`,
    ]) expect(parseDeepLink(bad)).toBeNull();
  });
  it('finds a link among command-line arguments', () => {
    expect(deepLinkFromArgv(['app.exe', '--flag', 'reizo://skill/install?namespace=a&slug=b'])).toBe('reizo://skill/install?namespace=a&slug=b');
    expect(deepLinkFromArgv(['app.exe'])).toBeNull();
  });
});
