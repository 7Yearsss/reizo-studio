import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSkills, validateSkill } from './skills';

describe('bundled init skill', () => {
  it('loads and validates', async () => {
    const skills = await loadSkills([path.resolve(__dirname, '../../skills')]);
    const init = skills.find((s) => s.id === 'init');
    expect(init).toBeDefined();
    expect(init!.body).toContain('.reizo/RULES.md');
    expect(await validateSkill(init!)).toEqual([]);
  });
});
