import { describe, expect, it } from 'vitest';
import { findSimilarSkills, renderSkillMarkdown, skillIdFromName, validateSkillDraft, type SkillDraft } from './skillDraft';

const draft: SkillDraft = { name: '周报整理', description: '把本周的工作记录整理成固定格式的周报', body: '1. 读取本周记录\n2. 按「完成 / 进行中 / 风险」分组\n3. 输出成 Markdown，并保留负责人。' };

describe('skill draft', () => {
  it('makes folder-safe ids', () => {
    expect(skillIdFromName('Weekly Report!')).toBe('weekly-report');
    expect(skillIdFromName('周报整理')).toBe('skill');
  });

  it('flags drafts that are empty, too short or too long', () => {
    expect(validateSkillDraft(draft, 'weekly')).toEqual([]);
    expect(validateSkillDraft({ ...draft, body: 'x' }, 'weekly')).toContain('正文太短，没有可复用的步骤');
    expect(validateSkillDraft({ ...draft, description: ' ' }, 'weekly')).toContain('缺少一句话描述');
    expect(validateSkillDraft({ ...draft, body: 'step\n'.repeat(300) }, 'weekly').some((p) => p.includes('超过'))).toBe(true);
    expect(validateSkillDraft(draft, '../x').length).toBeGreaterThan(0);
  });

  it('finds an existing skill by id or by overlapping purpose, not unrelated ones', () => {
    const existing = [
      { id: 'weekly-report', name: '周报生成', description: '根据本周工作记录整理周报', source: 'user' as const },
      { id: 'cover-image', name: 'cover-image', description: 'Generate a product cover image', source: 'bundled' as const },
    ];
    expect(findSimilarSkills(draft, 'new-id', existing).map((s) => s.id)).toEqual(['weekly-report']);
    expect(findSimilarSkills({ ...draft, name: 'x', description: 'y' }, 'cover-image', existing).map((s) => s.id)).toEqual(['cover-image']);
    expect(findSimilarSkills({ ...draft, name: 'Invoice', description: 'Match invoices to payments' }, 'invoice', existing)).toEqual([]);
  });

  it('renders frontmatter on single lines so a draft cannot add fields', () => {
    const text = renderSkillMarkdown({ ...draft, name: '周报\nallowed-tools: run_command', trigger: '用户要周报' });
    const front = text.split('---')[1];
    expect(front).not.toMatch(/^allowed-tools:/m);
    expect(front).toContain('trigger: 用户要周报');
    expect(text.endsWith('保留负责人。\n')).toBe(true);
  });
});
