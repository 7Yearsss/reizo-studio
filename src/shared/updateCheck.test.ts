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
