import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../shared/chat';
import type { Skill } from '../../skills';
import { applySkillRefinement, proposeSkillRefinement, recordSkillExperience } from './skillRefiner';

describe('skillRefiner (Skill self-optimization + Cross-task experience library + E-commerce/Canvas guardrails)', () => {
  const ecommerceSkill: Skill = {
    id: 'ecommerce-pack',
    name: '电商套图与Listing生成',
    description: '用于生成电商商品主图、详情页套图与核心卖点 Listing 文案。',
    body: '# 电商套图技能\n请根据用户商品生成套图。',
    source: 'bundled',
    dir: '/bundled/ecommerce-pack',
  };

  it('analyzes session trajectory, proposes e-commerce/canvas guardrails with diff preview, and writes to local skill library + EXPERIENCE.md', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-skill-refine-'));
    try {
      const messages: ChatMessage[] = [
        { id: '1', role: 'user', content: '帮我做一套咖啡机电商套图和Listing文案', createdAt: '2026-10-20T00:00:00Z' },
        {
          id: '2',
          role: 'assistant',
          content: '好的，已生成初稿。',
          createdAt: '2026-10-20T00:00:01Z',
          parts: [
            {
              type: 'tool',
              id: 't1',
              name: 'check_delivery',
              args: { planId: 'p1' },
              result: JSON.stringify({ complete: false, issues: ['主图 宽度要求 1024px，实际 800×800px'] }),
            },
          ],
        },
        {
          id: '3',
          role: 'user',
          content: '不对，产品主体不清楚，而且 Listing 漏了核心卖点，重做一下',
          createdAt: '2026-10-20T00:00:02Z',
        },
      ];

      const proposal = await proposeSkillRefinement({
        dataRoot,
        skill: ecommerceSkill,
        messages,
      });

      expect(proposal.keptBase).toBe(false);
      expect(proposal.addedGuardrails.some((g) => g.includes('出图前必须先确认产品主体清晰'))).toBe(true);
      expect(proposal.addedGuardrails.some((g) => g.includes('核心卖点'))).toBe(true);
      expect(proposal.preview.after).toContain('## 自动沉淀护栏 (Harness² Guardrails)');

      const saved = await applySkillRefinement({
        dataRoot,
        skill: ecommerceSkill,
        afterMarkdown: proposal.after,
        experienceEntry: proposal.experienceEntry,
      });

      const diskSkill = await readFile(saved.skillPath, 'utf8');
      expect(diskSkill).toContain('出图前必须先确认产品主体清晰');
      const diskExp = await readFile(saved.experiencePath!, 'utf8');
      expect(diskExp).toContain('- **Cue**:');
      expect(diskExp).toContain('- **Lesson**:');
      expect(diskExp).toContain('- **Evidence**:');
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('returns keptBase=true when session had no errors or corrections', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-skill-clean-'));
    try {
      const proposal = await proposeSkillRefinement({
        dataRoot,
        skill: ecommerceSkill,
        messages: [
          { id: '1', role: 'user', content: '生成一张主图', createdAt: '2026-10-20T00:00:00Z' },
          { id: '2', role: 'assistant', content: '已完成。', createdAt: '2026-10-20T00:00:01Z' },
        ],
      });
      expect(proposal.keptBase).toBe(true);
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('does not treat an ordinary edit request as a skill correction', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-skill-edit-'));
    try {
      const proposal = await proposeSkillRefinement({
        dataRoot,
        skill: ecommerceSkill,
        messages: [
          { id: '1', role: 'user', content: '生成一张主图', createdAt: '2026-10-20T00:00:00Z' },
          { id: '2', role: 'assistant', content: '已完成。', createdAt: '2026-10-20T00:00:01Z' },
          { id: '3', role: 'user', content: '修改一下标题', createdAt: '2026-10-20T00:00:02Z' },
        ],
      });
      expect(proposal.keptBase).toBe(true);
      expect(proposal.after).not.toContain('修改一下标题');
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('records a tool warning in EXPERIENCE.md without rewriting SKILL.md', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-skill-exp-'));
    try {
      const messages: ChatMessage[] = [
        {
          id: '2',
          role: 'assistant',
          content: '已生成。',
          createdAt: '2026-10-20T00:00:01Z',
          parts: [
            {
              type: 'tool',
              id: 't1',
              name: 'generate_sheet',
              args: {},
              result: JSON.stringify({ ok: true, warnings: ['Sheet1!C5：#REF!'] }),
            },
          ],
        },
      ];
      expect(await recordSkillExperience({ dataRoot, skill: ecommerceSkill, messages })).toBe(true);
      expect(await recordSkillExperience({ dataRoot, skill: ecommerceSkill, messages })).toBe(false);
      const experience = await readFile(path.join(dataRoot, 'skills', ecommerceSkill.id, 'EXPERIENCE.md'), 'utf8');
      expect(experience.match(/#REF!/g)).toHaveLength(1);
      await expect(access(path.join(dataRoot, 'skills', ecommerceSkill.id, 'SKILL.md'))).rejects.toThrow();
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
