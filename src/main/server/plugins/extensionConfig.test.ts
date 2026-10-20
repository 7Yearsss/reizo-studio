import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpServerEntry } from '../../../shared/extensionConfig';
import { checkNodeEnvironment, readHookEntries, readMcpEntries, resetNodeEnvironmentCacheForTests, testMcpEntry, validateHookEntries, validateMcpEntries, writeHookEntries, writeMcpEntries } from './extensionConfig';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'extcfg-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const stdio = (name: string, extra: Partial<McpServerEntry> = {}): McpServerEntry => ({ name, transport: 'stdio', command: 'node', args: ['s.js'], ...extra });

describe('MCP entries', () => {
  it('round-trips stdio and http servers, including disabled ones and secrets', async () => {
    const entries: McpServerEntry[] = [
      stdio('files', { env: { TOKEN: 'abc' }, disabled: true }),
      { name: 'docs', transport: 'sse', url: 'https://example.com/sse', headers: { Authorization: 'Bearer x' } },
    ];
    await writeMcpEntries(root, entries);
    expect(await readMcpEntries(root)).toEqual([
      { name: 'files', transport: 'stdio', command: 'node', args: ['s.js'], env: { TOKEN: 'abc' }, disabled: true },
      { name: 'docs', transport: 'sse', url: 'https://example.com/sse', headers: { Authorization: 'Bearer x' } },
    ]);
  });

  it('keeps the previous file as a .bak when saving', async () => {
    await writeFile(path.join(root, 'mcp.json'), '{"mcpServers":{"old":{"command":"x"}}}');
    await writeMcpEntries(root, [stdio('new')]);
    expect(await readFile(path.join(root, 'mcp.json.bak'), 'utf8')).toContain('"old"');
  });

  it('rejects bad names, duplicates, missing commands and non-http urls with a readable message', () => {
    expect(() => validateMcpEntries([stdio('bad name')])).toThrow('不合法');
    expect(() => validateMcpEntries([stdio('a'), stdio('a')])).toThrow('重复');
    expect(() => validateMcpEntries([stdio('a', { command: ' ' })])).toThrow('启动命令');
    expect(() => validateMcpEntries([{ name: 'a', transport: 'http', url: 'file:///x' }])).toThrow('http://');
  });

  it('reads nothing from a missing or broken file', async () => {
    expect(await readMcpEntries(root)).toEqual([]);
    await writeFile(path.join(root, 'mcp.json'), 'nope');
    expect(await readMcpEntries(root)).toEqual([]);
  });

  it('test reports a failing server instead of throwing, and does not write a baseline', async () => {
    const result = await testMcpEntry(root, stdio('broken', { command: 'definitely-not-a-real-binary-xyz', args: [] }));
    expect(result.ok).toBe(false);
    expect(result.messages.join(' ')).toContain('unavailable');
    await expect(readFile(path.join(root, 'mcp-baseline.json'))).rejects.toThrow();
    expect((await testMcpEntry(root, stdio('x', { command: '' }))).messages[0]).toContain('启动命令');
  }, 30_000);
});

describe('hook entries', () => {
  it('round-trips and omits empty matcher / timeout', async () => {
    await writeHookEntries(root, [{ event: 'PreToolUse', matcher: ' write_file|edit_file ', command: ' node guard.js ', timeoutMs: 5000 }, { event: 'PostToolUse', matcher: '', command: 'echo done' }]);
    expect(JSON.parse(await readFile(path.join(root, 'hooks.json'), 'utf8')).hooks).toEqual([
      { event: 'PreToolUse', matcher: 'write_file|edit_file', command: 'node guard.js', timeoutMs: 5000 },
      { event: 'PostToolUse', command: 'echo done' },
    ]);
    const back = await readHookEntries(root);
    expect(back.map((h) => h.event)).toEqual(['PreToolUse', 'PostToolUse']);
  });

  it('reads a Claude-style nested file the user dropped in, and backs it up before rewriting', async () => {
    await writeFile(path.join(root, 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo hi' }] }] } }));
    expect(await readHookEntries(root)).toMatchObject([{ event: 'PreToolUse', matcher: 'write_file', command: 'echo hi' }]);
    await writeHookEntries(root, [{ event: 'PreToolUse', command: 'echo changed' }]);
    expect(await readFile(path.join(root, 'hooks.json.bak'), 'utf8')).toContain('"Write"');
  });

  it('rejects empty commands and invalid regexes', () => {
    expect(() => validateHookEntries([{ event: 'PreToolUse', command: '  ' }])).toThrow('命令');
    expect(() => validateHookEntries([{ event: 'PreToolUse', matcher: '(', command: 'x' }])).toThrow('正则');
  });
});

describe('checkNodeEnvironment', () => {
  beforeEach(() => { resetNodeEnvironmentCacheForTests(); });

  it('detects available Node.js environment when runner succeeds', async () => {
    const mockRunner = async () => ({ stdout: 'v22.13.0\n' });
    const status = await checkNodeEnvironment(mockRunner);
    expect(status).toEqual({ available: true, version: 'v22.13.0' });
  });

  it('handles missing Node.js gracefully without throwing', async () => {
    const failingRunner = async () => { throw new Error('spawn node ENOENT'); };
    const status = await checkNodeEnvironment(failingRunner);
    expect(status).toEqual({ available: false });
  });

  it('returns real environment info using the default runner', async () => {
    const status = await checkNodeEnvironment();
    expect(typeof status.available).toBe('boolean');
    if (status.available) {
      expect(status.version).toMatch(/^v\d+/);
    }
  });
});
