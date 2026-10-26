import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Skill } from '../../skills';
import { listSkillHistory, readSkillSnapshot } from './skillHistory';
import { applySkillRefinement } from './skillRefiner';

const frontmatter = (body: string) => `---\nname: demo\ndescription: a demo skill\n---\n${body}\n`;

describe('skill history', () => {
  let root: string;
  let skill: Skill;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'reizo-skill-history-'));
    const dir = path.join(root, 'bundled', 'demo');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'SKILL.md'), frontmatter('原始内容'), 'utf8');
    skill = { id: 'demo', name: 'demo', description: 'a demo skill', body: '原始内容', source: 'bundled', dir };
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('keeps the original, then each overwritten version, newest first with reasons', async () => {
    await applySkillRefinement({ dataRoot: root, skill, afterMarkdown: frontmatter('第一次优化'), reason: '第一次' });
    await applySkillRefinement({ dataRoot: root, skill, afterMarkdown: frontmatter('第二次优化'), reason: '第二次' });
    const skillDir = path.join(root, 'skills', 'demo');
    const history = await listSkillHistory(skillDir);
    expect(history.map((h) => h.reason)).toEqual(['第二次', '第一次']);
    expect(await readSkillSnapshot(skillDir, history[1].file)).toContain('原始内容');
    expect(await readSkillSnapshot(skillDir, history[0].file)).toContain('第一次优化');
  });

  it('restoring puts the old text back and keeps the replaced one', async () => {
    await applySkillRefinement({ dataRoot: root, skill, afterMarkdown: frontmatter('第一次优化') });
    const skillDir = path.join(root, 'skills', 'demo');
    const [snapshot] = await listSkillHistory(skillDir);
    const old = (await readSkillSnapshot(skillDir, snapshot.file))!;
    await applySkillRefinement({ dataRoot: root, skill, afterMarkdown: old, reason: '恢复前的版本' });
    expect(await readFile(path.join(skillDir, 'SKILL.md'), 'utf8')).toContain('原始内容');
    expect((await listSkillHistory(skillDir)).map((h) => h.reason)[0]).toBe('恢复前的版本');
  });

  it('refuses snapshot names that escape the history folder', async () => {
    expect(await readSkillSnapshot(path.join(root, 'skills', 'demo'), '../../secret.md')).toBeNull();
    expect(await readSkillSnapshot(path.join(root, 'skills', 'demo'), 'x.txt')).toBeNull();
  });
});
