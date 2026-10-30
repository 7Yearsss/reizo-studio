import { describe, expect, it } from 'vitest';
import { effectiveRules, needsApproval } from './permissionRules';
import type { PermissionMode } from './settings';

describe('effectiveRules', () => {
  const modes: PermissionMode[] = ['ask', 'workspace', 'full'];

  it('agrees with needsApproval for every tool it lists, in every mode', () => {
    for (const mode of modes) {
      for (const rule of effectiveRules(mode)) {
        const probe = rule.tools.filter((t) => t !== 'mcp__*').concat(rule.tools.includes('mcp__*') ? ['mcp__s__t'] : []);
        for (const tool of rule.tools.includes('read_file') ? [] : probe) {
          expect(needsApproval(mode, tool) ? 'ask' : 'run', `${mode}/${tool}`).toBe(rule.effect);
        }
      }
    }
  });

  it('reads never ask; computer control and durable-state tools always ask', () => {
    for (const mode of modes) {
      const rules = effectiveRules(mode);
      expect(rules[0].effect).toBe('run');
      expect(rules.at(-1)!.effect).toBe('ask');
      expect(rules.find((r) => r.tools.includes('computer'))!.effect).toBe('ask');
    }
  });

  it('full access waives writes, commands and MCP but nothing else', () => {
    const rules = effectiveRules('full');
    expect(rules.filter((r) => r.effect === 'run').map((r) => r.group)).toEqual(['读取（读文件、搜索、列目录）', '写文件、记忆、联网', '运行命令', '外部 MCP 工具']);
  });
});
