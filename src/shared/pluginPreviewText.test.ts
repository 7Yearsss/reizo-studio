import { describe, expect, it } from 'vitest';
import type { PluginPreview } from './plugins';
import { previewConfirmText } from './pluginPreviewText';

const preview = (over: Partial<PluginPreview> = {}): PluginPreview => ({
  sourceDir: 'D:/packs/demo',
  digest: 'abc',
  summary: {
    id: 'demo', name: 'Demo', version: '1.2.0', format: 'claude', skills: ['writer', 'checker'],
    mcpServers: [{ name: 'demo-db', kind: 'stdio', target: 'node server.js --token' }, { name: 'demo-web', kind: 'http', target: 'https://api.example.com/mcp' }],
    hooks: [{ event: 'PreToolUse', matcher: 'run_command', command: 'python guard.py' }],
    warnings: ['This plugin defines sub-agents (agents/), which Reizo does not support yet.'],
  },
  ...over,
});

describe('previewConfirmText', () => {
  it('spells out every program, address and hook before anything is installed', () => {
    const text = previewConfirmText(preview());
    expect(text).toContain('导入后默认不启用');
    expect(text).toContain('来源：D:/packs/demo');
    expect(text).toContain('启动本地程序：node server.js --token');
    expect(text).toContain('连接外部服务：https://api.example.com/mcp');
    expect(text).toContain('在工具调用前运行命令（run_command）：python guard.py');
    expect(text).toContain('2 个技能：writer、checker');
    expect(text).toContain('注意：');
  });
  it('says plainly when it is an update, or already installed unchanged', () => {
    expect(previewConfirmText(preview({ existing: { version: '1.0.0', sameContent: false } }))).toContain('替换它');
    expect(previewConfirmText(preview({ existing: { version: '1.2.0', sameContent: true } }))).toContain('无需重复导入');
  });
});
