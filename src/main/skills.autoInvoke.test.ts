import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { autoInvokableSkills, buildSkillsTriggerIndex, loadSkills } from './skills';
import { createSkillTools, USE_SKILL_TOOL } from './server/agent/skillTools';

const dir = path.resolve(__dirname, '../../skills');

describe('skill auto-invocation catalog', () => {
  it('lists bundled skills with TRIGGER / DO NOT TRIGGER, and keeps contract skills manual', async () => {
    const skills = await loadSkills([dir]);
    const catalog = buildSkillsTriggerIndex(skills);
    expect(catalog).toContain('- social-pack');
    expect(catalog).toMatch(/social-pack[\s\S]*?TRIGGER: 用户要为小红书/);
    expect(catalog).toMatch(/DO NOT TRIGGER: 只是问社媒套图能不能做/);
    for (const manual of ['cover-image', 'brand-kit', 'deck-maker', 'ecommerce-listing']) expect(catalog).not.toContain(`- ${manual} `);
    expect(catalog).toContain('a question about what you can do is answered in text');
  });

  it('every listed skill has a do-not-trigger line (default covers capability questions)', async () => {
    const catalog = buildSkillsTriggerIndex(await loadSkills([dir]));
    const entries = catalog.split('\n').filter((l) => l.startsWith('- ')).length;
    expect(catalog.match(/DO NOT TRIGGER:/g)?.length).toBe(entries);
  });

  it('disable-auto-invoke skills are withheld from the catalog and the tool', async () => {
    const skills = await loadSkills([dir]);
    const manual = { ...skills.find((s) => s.id === 'explain')!, autoInvoke: false };
    expect(autoInvokableSkills([manual])).toEqual([]);
    expect(buildSkillsTriggerIndex([manual])).toBe('');
    expect(createSkillTools({ skills: [manual] })).toEqual({});
  });

  it('use_skill returns the instructions, and refuses unknown or contract skills', async () => {
    const skills = await loadSkills([dir]);
    const tools = createSkillTools({ skills });
    const run = (id: string) => (tools[USE_SKILL_TOOL].execute as any)({ id }, {}) as Promise<{ ok: boolean; instructions?: string; error?: string }>;
    const ok = await run('social-pack');
    expect(ok.ok).toBe(true);
    expect(ok.instructions).toContain('Follow these instructions');
    expect((await run('cover-image')).ok).toBe(false);
    expect((await run('nope')).ok).toBe(false);
  });
});
