import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSkillsTriggerIndex, loadSkills, validateSkill, type Skill } from './skills';

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

  it('keeps bundled assets when a user overlay only replaces the skill text', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'skill-overlay-'));
    try {
      const bundled = path.join(root, 'bundled', 'cover-image');
      const user = path.join(root, 'data', 'skills', 'cover-image');
      await mkdir(path.join(bundled, 'assets'), { recursive: true });
      await writeFile(path.join(bundled, 'assets', 'style.jpg'), 'img', 'utf8');
      const bundledMd = '---\nname: Cover\ndescription: Make a cover image for a post.\n---\n\nUse the bundled samples.\n';
      await writeFile(path.join(bundled, 'SKILL.md'), bundledMd, 'utf8');
      await mkdir(user, { recursive: true });
      await writeFile(
        path.join(user, 'SKILL.md'),
        '---\nname: Cover\ndescription: Make a cover image for a post.\n---\n\nUse the bundled samples.\n\n## guard\n',
        'utf8',
      );
      await writeFile(path.join(user, 'EXPERIENCE.md'), 'lesson one', 'utf8');

      const [skill] = await loadSkills([path.join(root, 'bundled'), path.join(root, 'data', 'skills')]);
      expect(skill?.id).toBe('cover-image');
      expect(skill?.dir).toBe(bundled);
      expect(skill?.body).toContain('## guard');
      expect(skill?.experience).toBe('lesson one');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
