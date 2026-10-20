import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSkillsTriggerIndex, validateSkill, type Skill } from './skills';

describe('skills validator and progressive disclosure index', () => {
  it('validates skill naming, description, line count, and referenced paths', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'skill-val-'));
    try {
      await mkdir(path.join(dir, 'scripts'), { recursive: true });
      await writeFile(path.join(dir, 'scripts', 'check.py'), 'print(1)', 'utf8');

      const good: Skill = {
        id: 'excel-audit',
        name: 'Excel Audit',
        description: 'Use when auditing or building financial Excel workbooks.',
        body: 'Run `scripts/check.py` to verify.',
        source: 'user',
        dir,
      };
      expect(await validateSkill(good)).toEqual([]);

      const bad: Skill = {
        id: 'bad id!',
        name: 'Bad',
        description: 'short',
        body: `Run \`scripts/missing.py\`\n${Array.from({ length: 505 }, () => 'line').join('\n')}`,
        source: 'user',
        dir,
      };
      const issues = await validateSkill(bad);
      expect(issues.some((i) => i.includes('invalid skill id'))).toBe(true);
      expect(issues.some((i) => i.includes('missing a meaningful description'))).toBe(true);
      expect(issues.some((i) => i.includes('exceeds 500-line cap'))).toBe(true);
      expect(issues.some((i) => i.includes('scripts/missing.py'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('builds a compact trigger index without dumping skill bodies', () => {
    const skills: Skill[] = [
      {
        id: 'pptx-deck',
        name: 'PPTX Deck',
        description: 'Use when creating executive slide decks.',
        body: 'VERY LONG BODY THAT SHOULD NOT APPEAR',
        source: 'bundled',
        dir: '/tmp',
      },
    ];
    const index = buildSkillsTriggerIndex(skills);
    expect(index).toContain('pptx-deck (PPTX Deck): Use when creating executive slide decks.');
    expect(index).not.toContain('VERY LONG BODY');
  });
});
