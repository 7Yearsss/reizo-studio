import { describe, expect, it } from 'vitest';
import { compareVersions, judgeUpdate, parseUpdateFeed } from './updateCheck';

describe('updates', () => {
  it('compares versions, treating a pre-release as older than its release', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.1.0-main.2', '0.1.0')).toBe(-1);
    expect(compareVersions('abc', '1.0.0')).toBeNull();
  });
  it('accepts only an https feed with a real version', () => {
    expect(parseUpdateFeed({ version: '0.2.0', url: 'https://example.com/r' })).toEqual({ version: '0.2.0', url: 'https://example.com/r' });
    expect(parseUpdateFeed({ version: '0.2.0', url: 'http://example.com/r' })).toBeNull();
    expect(parseUpdateFeed({ version: 'latest', url: 'https://example.com' })).toBeNull();
    expect(parseUpdateFeed({ version: '0.2.0', url: 'javascript:alert(1)' })).toBeNull();
  });
  it('never says up to date without a feed, or when the feed failed', () => {
    expect(judgeUpdate('0.1.1', null, false).status).toBe('disabled');
    expect(judgeUpdate('0.1.1', null, true, 'timeout').status).toBe('error');
    expect(judgeUpdate('0.1.1', parseUpdateFeed({ version: '0.1.1', url: 'https://x.io' }), true).status).toBe('latest');
    expect(judgeUpdate('0.1.1', parseUpdateFeed({ version: '0.2.0', url: 'https://x.io', notes: 'n' }), true)).toMatchObject({ status: 'available', latest: '0.2.0', notes: 'n' });
  });
});

describe('GitHub releases as the feed', () => {
  const release = { tag_name: 'v0.1.1-main.14', html_url: 'https://github.com/7Yearsss/reizo-studio-downloads/releases/tag/v0.1.1-main.14', body: '修复若干问题', draft: false, prerelease: false };
  it('reads a release object and orders main.N builds numerically', () => {
    expect(parseUpdateFeed(release)).toEqual({ version: '0.1.1-main.14', url: release.html_url, notes: '修复若干问题' });
    expect(compareVersions('0.1.1-main.12', '0.1.1-main.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.1-main.9', '0.1.1-main.12')).toBeLessThan(0);
    expect(compareVersions('0.1.1', '0.1.1-main.99')).toBeGreaterThan(0);
    expect(compareVersions('0.1.1-main.14', '0.1.1-main.14')).toBe(0);
  });
  it('ignores drafts and pre-releases, and says "available" only for a newer build', () => {
    expect(parseUpdateFeed({ ...release, prerelease: true })).toBeNull();
    expect(parseUpdateFeed({ ...release, draft: true })).toBeNull();
    expect(judgeUpdate('0.1.1-main.12', parseUpdateFeed(release), true).status).toBe('available');
    expect(judgeUpdate('0.1.1-main.14', parseUpdateFeed(release), true).status).toBe('latest');
    expect(judgeUpdate('0.1.1-main.20', parseUpdateFeed(release), true).status).toBe('latest');
  });
});
