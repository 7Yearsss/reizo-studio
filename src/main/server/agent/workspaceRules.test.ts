import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatRules, MAX_RULE_FILES, readRuleSources, WORKSPACE_RULES_MAX_CHARS } from './workspaceRules';

describe('workspace rules', () => {
  let root: string;
  let ws: string;
  let user: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'reizo-rules-'));
    ws = path.join(root, 'ws'); user = path.join(root, 'user');
    await mkdir(path.join(ws, '.reizo', 'rules'), { recursive: true });
    await mkdir(user, { recursive: true });
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('reads user rules, then workspace RULES.md, then rules/*.md alphabetically', async () => {
    await writeFile(path.join(user, 'RULES.md'), '回答简短', 'utf8');
    await writeFile(path.join(ws, '.reizo', 'RULES.md'), '用中文', 'utf8');
    await writeFile(path.join(ws, '.reizo', 'rules', 'b.md'), 'B', 'utf8');
    await writeFile(path.join(ws, '.reizo', 'rules', 'a.md'), 'A', 'utf8');
    await writeFile(path.join(ws, 'AGENTS.md'), '不应读取（已有 RULES.md）', 'utf8');
    const sources = await readRuleSources({ workspacePath: ws, userRulesDir: user });
    expect(sources.map((s) => s.text)).toEqual(['回答简短', '用中文', 'A', 'B']);
  });

  it('falls back to AGENTS.md then CLAUDE.md', async () => {
    await writeFile(path.join(ws, 'CLAUDE.md'), 'claude', 'utf8');
    expect((await readRuleSources({ workspacePath: ws })).map((s) => s.text)).toEqual(['claude']);
    await writeFile(path.join(ws, 'AGENTS.md'), 'agents', 'utf8');
    expect((await readRuleSources({ workspacePath: ws })).map((s) => s.text)).toEqual(['agents']);
  });

  it('caps size and file count, and redacts secrets when formatting', async () => {
    await writeFile(path.join(ws, '.reizo', 'RULES.md'), 'x'.repeat(WORKSPACE_RULES_MAX_CHARS + 500), 'utf8');
    for (let i = 0; i < MAX_RULE_FILES + 5; i++) await writeFile(path.join(ws, '.reizo', 'rules', `r${String(i).padStart(2, '0')}.md`), 'r', 'utf8');
    const sources = await readRuleSources({ workspacePath: ws });
    expect(sources[0].text).toHaveLength(WORKSPACE_RULES_MAX_CHARS);
    expect(sources).toHaveLength(1 + MAX_RULE_FILES);
    expect(formatRules([{ label: 'k', text: 'key sk-' + 'a'.repeat(30) }])).not.toContain('a'.repeat(30));
  });

  it('refuses a symlink that points outside the workspace', async () => {
    const secret = path.join(root, 'secret.md');
    await writeFile(secret, '外部机密', 'utf8');
    try { await symlink(secret, path.join(ws, '.reizo', 'RULES.md')); } catch { return; }
    expect(await readRuleSources({ workspacePath: ws })).toEqual([]);
  });

  it('returns nothing when there are no rules', async () => {
    expect(formatRules(await readRuleSources({ workspacePath: ws }))).toBe('');
    expect(await readRuleSources({})).toEqual([]);
  });
});
