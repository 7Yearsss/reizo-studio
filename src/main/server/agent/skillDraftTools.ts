import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import type { PermissionMode } from '../../../shared/settings';
import { hasSecret } from '../../../shared/redactSecrets';
import { scanContent } from '../../../shared/contentGuard';
import { findSimilarSkills, renderSkillMarkdown, skillIdFromName, validateSkillDraft, type SkillDraft } from '../../../shared/skillDraft';
import type { Skill } from '../../skills';
import { writeTextAtomic } from '../storage/atomicFile';
import { ApprovalRequiredError, requestPermission } from './permissions';

export const PROPOSE_SKILL_TOOL = 'propose_skill';

interface Options {
  dataRoot: string;
  /** Every skill currently loaded, bundled and user. */
  getSkills: () => Skill[] | Promise<Skill[]>;
  sessionId?: string;
  permissionMode?: PermissionMode;
  /** Set when running a call the user already approved on its card. */
  skipApproval?: boolean;
}

const input = z.object({
  name: z.string().describe('Short skill name.'),
  description: z.string().describe('One sentence: what the skill does.'),
  body: z.string().describe('The reusable steps, in Markdown, written for a future run (no one-off details).'),
  trigger: z.string().optional().describe('One line: when the model should start it by itself.'),
  doNotTrigger: z.string().optional().describe('Look-alike requests that must not start it.'),
  updateId: z.string().optional().describe('Id of an existing USER skill to update instead of creating a new one.'),
});

type Input = z.infer<typeof input>;

/**
 * Turns a finished task into a skill draft. Nothing is saved until the user approves the card (every time; it is on the
 * always-ask list because a saved skill steers future runs). A draft that overlaps an existing skill is refused with a
 * pointer to update that one, and drafts holding anything secret-shaped are refused outright.
 */
export function createSkillDraftTools(options: Options) {
  async function check(args: Input): Promise<{ id: string; draft: SkillDraft } | { error: string; similar?: Array<{ id: string; name: string; source: string }> }> {
    const skills = await options.getSkills();
    const draft: SkillDraft = { name: args.name, description: args.description, body: args.body, trigger: args.trigger, doNotTrigger: args.doNotTrigger };
    const id = args.updateId ?? skillIdFromName(args.name);
    const problems = validateSkillDraft(draft, id);
    if (problems.length) return { error: problems.join('；') };
    if (hasSecret(`${draft.name}\n${draft.description}\n${draft.body}`)) return { error: '草稿里含有疑似密钥 / 令牌的内容，请去掉后再提议' };
    const finding = scanContent([draft.name, draft.description, draft.body, draft.trigger ?? '', draft.doNotTrigger ?? ''].join('\n'));
    if (finding) return { error: `草稿被内容安全检查拒绝（${finding.reason}），请去掉后再提议` };
    if (args.updateId) {
      const target = skills.find((s) => s.id === args.updateId);
      if (!target || target.source !== 'user') return { error: '只能更新你自己的技能；内置技能请另起新技能' };
    } else {
      const similar = findSimilarSkills(draft, id, skills);
      if (similar.length) return { error: '已有相近的技能，请用 updateId 更新它，而不是新建重复的', similar: similar.map((s) => ({ id: s.id, name: s.name, source: s.source })) };
    }
    return { id, draft };
  }

  async function save(id: string, draft: SkillDraft): Promise<string> {
    const dir = path.join(options.dataRoot, 'skills', id);
    await mkdir(dir, { recursive: true });
    await writeTextAtomic(path.join(dir, 'SKILL.md'), renderSkillMarkdown(draft));
    return dir;
  }

  return {
    [PROPOSE_SKILL_TOOL]: tool({
      description: 'Propose saving a reusable workflow from this conversation as a skill. The user reviews and approves the draft before anything is saved. Do not propose one-off tasks, anything tied to this run\'s specific values, or what an existing skill already covers (pass updateId to improve one of the user\'s own skills instead).',
      inputSchema: input,
      execute: async (args, toolOptions) => {
        const checked = await check(args);
        if ('error' in checked) return { ok: false, ...checked };
        if (!options.skipApproval) {
          if (!options.sessionId || !toolOptions?.toolCallId) throw new Error('保存技能需要用户确认，当前上下文无法发起确认');
          const allowed = await requestPermission({ sessionId: options.sessionId, toolCallId: toolOptions.toolCallId, name: PROPOSE_SKILL_TOOL, args: { ...args }, mode: options.permissionMode ?? 'ask' });
          if (!allowed) throw new ApprovalRequiredError({ toolCallId: toolOptions.toolCallId, name: PROPOSE_SKILL_TOOL, args: { ...args }, kind: 'permission' });
        }
        await save(checked.id, checked.draft);
        return { ok: true, id: checked.id, updated: Boolean(args.updateId) };
      },
    }),
  };
}

/** Runs a draft the user just approved on its card. */
export async function runApprovedSkillDraft(options: Omit<Options, 'skipApproval'>, args: Record<string, unknown>, toolCallId: string): Promise<{ result?: string; error?: string }> {
  const parsed = input.safeParse(args);
  if (!parsed.success) return { error: '技能草稿格式不正确' };
  try {
    const tools = createSkillDraftTools({ ...options, skipApproval: true });
    const out = await (tools[PROPOSE_SKILL_TOOL].execute as (a: Input, o: { toolCallId: string }) => Promise<unknown>)(parsed.data, { toolCallId });
    return { result: JSON.stringify(out) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
