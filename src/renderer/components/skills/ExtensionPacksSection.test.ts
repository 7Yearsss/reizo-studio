import { describe, expect, it } from 'vitest';
import type { PluginSummary } from '../../../shared/plugins';
import { enableConfirmText } from './ExtensionPacksSection';

const base: PluginSummary = { id: 'p', name: 'Pack', format: 'claude', enabled: false, skills: ['a'], mcpServers: [], hooks: [], warnings: [] };

describe('enableConfirmText', () => {
  it('needs no confirmation for a skills-only pack', () => {
    expect(enableConfirmText(base)).toBeNull();
  });
  it('lists every program, service and hook command the pack would run', () => {
    const text = enableConfirmText({
      ...base,
      mcpServers: [{ name: 'p-tools', kind: 'stdio', target: 'node server.js' }, { name: 'p-docs', kind: 'http', target: 'https://example.com/mcp' }],
      hooks: [{ event: 'PreToolUse', matcher: 'write_file', command: 'node guard.js' }, { event: 'PostToolUse', command: 'echo done' }],
    });
    expect(text).toContain('启动本地程序：node server.js');
    expect(text).toContain('连接外部服务：https://example.com/mcp');
    expect(text).toContain('工具调用前运行命令（write_file）：node guard.js');
    expect(text).toContain('工具调用后运行命令：echo done');
  });
});
