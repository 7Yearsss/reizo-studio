import { describe, expect, it } from 'vitest';
import { applyRunCeiling, effectiveRunMode, READ_ONLY_RUN_TOOLS } from './runCeiling';

const tools = { read_file: {}, grep: {}, write_file: {}, edit_file: {}, run_command: {}, mcp__x__do: {}, computer: {}, create_schedule: {}, generate_image: {}, brand_new_tool: {} };

describe('run ceiling', () => {
  it('read-only keeps only listed read tools; everything else (including new tools and MCP) is withheld', () => {
    expect(Object.keys(applyRunCeiling(tools, 'readonly')).sort()).toEqual(['grep', 'read_file']);
  });
  it('other ceilings and none leave the toolset alone', () => {
    for (const ceiling of ['workspace', 'inherit', undefined] as const) expect(applyRunCeiling(tools, ceiling)).toBe(tools);
  });
  it('never lets a read-only run reach a write, shell or self-extension tool', () => {
    for (const name of ['write_file', 'edit_file', 'run_command', 'computer', 'create_schedule', 'delete_schedule', 'memory_write', 'generate_image']) {
      expect(READ_ONLY_RUN_TOOLS.has(name), name).toBe(false);
    }
  });
  it('global full never raises a ceiling', () => {
    expect(effectiveRunMode('full', 'readonly')).toBe('ask');
    expect(effectiveRunMode('full', 'workspace')).toBe('workspace');
    expect(effectiveRunMode('full', 'inherit')).toBe('full');
    expect(effectiveRunMode('ask', 'workspace')).toBe('ask');
    expect(effectiveRunMode('full', undefined)).toBe('full');
  });
});

describe('effectiveRunMode never loosens the global mode', () => {
  const rank = { ask: 0, workspace: 1, full: 2 } as const;
  for (const global of ['ask', 'workspace', 'full'] as const) {
    for (const ceiling of ['readonly', 'workspace', 'inherit', undefined] as const) {
      it(`${global} + ${String(ceiling)}`, () => {
        expect(rank[effectiveRunMode(global, ceiling)]).toBeLessThanOrEqual(rank[global]);
      });
    }
  }
});
