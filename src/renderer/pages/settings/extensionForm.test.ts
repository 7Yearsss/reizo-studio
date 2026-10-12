import { describe, expect, it } from 'vitest';
import { describeHook, describeMcpEntry, formatKeyValueLines, maskSecrets, parseArgLines, parseKeyValueLines } from './extensionForm';

describe('key/value lines', () => {
  it('parses env lines and keeps "=" inside values', () => {
    expect(parseKeyValueLines('A=1\n\n B = x=y \nbroken\n=novalue', '=')).toEqual({ A: '1', B: 'x=y' });
  });
  it('parses header lines and keeps ":" inside values', () => {
    expect(parseKeyValueLines('Authorization: Bearer abc\nX-Url: https://a.b/c', ':')).toEqual({ Authorization: 'Bearer abc', 'X-Url': 'https://a.b/c' });
  });
  it('returns undefined when nothing parses, and round-trips through format', () => {
    expect(parseKeyValueLines('  \n', '=')).toBeUndefined();
    const record = { A: '1', B: '2' };
    expect(parseKeyValueLines(formatKeyValueLines(record, '='), '=')).toEqual(record);
    expect(parseKeyValueLines(formatKeyValueLines({ H: 'v' }, ':'), ':')).toEqual({ H: 'v' });
  });
});

describe('parseArgLines', () => {
  it('keeps one argument per line, spaces included', () => {
    expect(parseArgLines('-y\n  some-server \n\n--root=C:\\My Files')).toEqual(['-y', 'some-server', '--root=C:\\My Files']);
  });
});

describe('maskSecrets', () => {
  it('hides likely secrets only', () => {
    expect(maskSecrets({ API_KEY: 'sk-1', Authorization: 'Bearer x', REGION: 'us' })).toEqual({ API_KEY: '••••••', Authorization: '••••••', REGION: 'us' });
    expect(maskSecrets(undefined)).toBeUndefined();
  });
});

describe('descriptions', () => {
  it('summarises a server and a hook in one line', () => {
    expect(describeMcpEntry({ name: 'a', transport: 'stdio', command: 'npx', args: ['-y', 'srv'] })).toBe('npx -y srv');
    expect(describeMcpEntry({ name: 'a', transport: 'http', url: 'https://x/y' })).toBe('https://x/y');
    expect(describeHook({ event: 'PreToolUse', matcher: 'write_file', command: 'x' })).toBe('调用工具前 · 工具匹配 write_file');
    expect(describeHook({ event: 'PostToolUse', command: 'x' })).toBe('调用工具后 · 所有工具');
  });
});
