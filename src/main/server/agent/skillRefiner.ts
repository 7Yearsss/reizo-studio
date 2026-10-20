import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChatMessage } from '../../../shared/chat';
import { buildFileDiffPreview, type FileDiffPreview } from '../../../shared/stream';
import { validateSkill, type Skill } from '../../skills';
import { assertMemorySafe } from '../../workspaceMemoryDir';
import { prepareIsolatedProposerDir } from './harnessProposer';

/**
 * Reizo Studio "Skill Self-Optimization Layer" (Harness² B3 + B4 + D4 + D6):
 * 1. Collects trajectory & tool/delivery feedback from a finished session that used a Skill.
 * 2. Proposes targeted refinements + domain/canvas Guardrails for `SKILL.md` (with `FileDiffPreview` for `@pierre/diffs`).
 * 3. Upon user confirmation, validates (`validateSkill` + `assertMemorySafe`) and writes the evolved
 *    `SKILL.md` + `EXPERIENCE.md` into the local user skill library (`<dataRoot>/skills/<id>/`).
 */

export interface SkillRefinementProposal {
  skillId: string;
  skillName: string;
  keptBase: boolean;
  rationale: string;
  addedGuardrails: string[];
  before: string;
  after: string;
  preview: FileDiffPreview;
  experienceEntry: {
    cue: string;
    lesson: string;
    evidence: string;
    confidence: 'high' | 'medium';
  } | null;
}

export function extractSessionTrajectoryForSkill(messages: ChatMessage[]): {
  trajectoryText: string;
  observedIssues: string[];
  userCorrections: string[];
} {
  const lines: string[] = [];
  const observedIssues: string[] = [];
  const userCorrections: string[] = [];

  messages.forEach((m, idx) => {
    if (m.role === 'user') {
      lines.push(`[USER ${idx + 1}] ${m.content.slice(0, 500)}`);
      if (idx > 0 && /不对|重做|漏了|报错|不对劲/.test(m.content)) {
        userCorrections.push(m.content.trim().slice(0, 240));
      }
      return;
    }
    if (m.role === 'assistant') {
      for (const part of m.parts ?? []) {
        const argsStr = JSON.stringify(part.args ?? {}).slice(0, 240);
        lines.push(`[ACTION] ${part.name}(${argsStr})`);
        if (part.error) {
          lines.push(`[ERROR] ${part.error.slice(0, 300)}`);
          observedIssues.push(`${part.name}: ${part.error.slice(0, 200)}`);
        } else if (part.result) {
          lines.push(`[OBSERVATION] ${part.result.slice(0, 400)}`);
          if (/"issues"\s*:\s*\[[^\]]+\]|"warnings"\s*:\s*\[[^\]]+\]/i.test(part.result)) {
            observedIssues.push(`${part.name} reported warnings/issues: ${part.result.slice(0, 220)}`);
          }
        }
      }
      if (m.content) {
        lines.push(`[ASSISTANT] ${m.content.slice(0, 400)}`);
      }
    }
  });

  return {
    trajectoryText: lines.join('\n'),
    observedIssues,
    userCorrections,
  };
}

export function serializeSkillMarkdown(skill: {
  name: string;
  description: string;
  prompt?: string;
  cover?: string;
  category?: string;
  body: string;
}): string {
  const frontmatter = [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    ...(skill.prompt ? [`prompt: ${skill.prompt}`] : []),
    ...(skill.cover ? [`cover: ${skill.cover}`] : []),
    ...(skill.category ? [`category: ${skill.category}`] : []),
    '---',
  ].join('\n');
  return `${frontmatter}\n\n${skill.body.trim()}\n`;
}

const REFINE_SYSTEM_PROMPT = `You are the Reizo Studio Skill Self-Optimizer (Harness² Propose-Probe-Compose engine).
Given a skill's current SKILL.md body and the execution trajectory of a user session that ran this skill:
1. Diagnose concrete friction points from tool errors, delivery/audit warnings, or user mid-turn corrections.
2. Propose 1-3 concise, high-leverage Guardrails or workflow rules (e.g., for e-commerce/canvas skills: "出图前必须先确认产品主体清晰", "Listing 文案必须包含核心卖点"; for Office skills: formula/layout checks).
3. If the session ran smoothly with zero issues or corrections, return {"keptBase": true}.
Reply with ONLY a JSON object:
{
  "keptBase": false,
  "rationale": "one sentence citing the trajectory moment",
  "addedGuardrails": ["rule 1", "rule 2"],
  "cue": "when this skill is used on ...",
  "lesson": "actionable rule learned",
  "evidence": "observed tool/user feedback in this session"
}`;

export async function proposeSkillRefinement(opts: {
  dataRoot: string;
  skill: Skill;
  messages: ChatMessage[];
  rewriteText?: (system: string, prompt: string) => Promise<string>;
}): Promise<SkillRefinementProposal> {
  const stagingDir = await prepareIsolatedProposerDir(opts.dataRoot, `skill-refine-${opts.skill.id}`);
  const { trajectoryText, observedIssues, userCorrections } = extractSessionTrajectoryForSkill(opts.messages);
  const before = serializeSkillMarkdown(opts.skill);

  let rationale = '';
  let addedGuardrails: string[] = [];
  let cue = '';
  let lesson = '';
  let evidence = '';

  if (opts.rewriteText && (observedIssues.length > 0 || userCorrections.length > 0)) {
    try {
      const reply = await opts.rewriteText(
        REFINE_SYSTEM_PROMPT,
        `Current Skill (${opts.skill.id} - ${opts.skill.name}):\n${opts.skill.body}\n\nSession Trajectory:\n${trajectoryText}`,
      );
      const match = reply.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as {
          keptBase?: boolean;
          rationale?: string;
          addedGuardrails?: string[];
          cue?: string;
          lesson?: string;
          evidence?: string;
        };
        if (!parsed.keptBase && Array.isArray(parsed.addedGuardrails) && parsed.addedGuardrails.length > 0) {
          rationale = parsed.rationale ?? '根据本次会话执行轨迹自动提炼的技能改进规则';
          addedGuardrails = parsed.addedGuardrails;
          cue = parsed.cue ?? `执行技能「${opts.skill.name}」时`;
          lesson = parsed.lesson ?? addedGuardrails.join('；');
          evidence = parsed.evidence ?? [...observedIssues, ...userCorrections].slice(0, 2).join('；');
        }
      }
    } catch {
      /* fallback to deterministic trajectory synthesis below */
    }
  }

  if (addedGuardrails.length === 0 && (observedIssues.length > 0 || userCorrections.length > 0)) {
    const joined = [...observedIssues, ...userCorrections].join(' ');
    if (/主体|商品|电商|套图|海报|白底|卖点|listing/i.test(joined + ' ' + opts.skill.name + ' ' + opts.skill.body)) {
      pushGuardrail(addedGuardrails, '出图前必须先确认产品主体清晰、比例与参考素材一致，避免主体变形或缺失。', opts.skill.body);
      pushGuardrail(addedGuardrails, '生成电商套图或 Listing 文案时，必须明确包含核心卖点并在 check_delivery 前核验尺寸画幅。', opts.skill.body);
    }
    if (userCorrections.length > 0) {
      pushGuardrail(addedGuardrails, '用户中途纠正过输出时，先对照纠正点改结果，再继续往下做。', opts.skill.body);
    }
    for (const iss of observedIssues.slice(0, 2)) {
      pushGuardrail(addedGuardrails, `交付前自检（源自工具告警）：避免 ${iss}`, opts.skill.body);
    }
    rationale = `基于本次会话中的 ${observedIssues.length} 处工具/交付告警与 ${userCorrections.length} 处用户修正提炼。`;
    cue = `当运行技能「${opts.skill.name}」处理同类任务时`;
    lesson = addedGuardrails.join(' ');
    evidence = [...userCorrections, ...observedIssues].slice(0, 2).join(' | ');
  }

  if (addedGuardrails.length === 0) {
    return {
      skillId: opts.skill.id,
      skillName: opts.skill.name,
      keptBase: true,
      rationale: '本次会话执行顺畅，无需修改现有技能规程（KEEP_BASE）。',
      addedGuardrails: [],
      before,
      after: before,
      preview: buildFileDiffPreview(`skills/${opts.skill.id}/SKILL.md`, before, before),
      experienceEntry: null,
    };
  }

  const guardrailBlock = [
    '## 自动沉淀护栏 (Harness² Guardrails)',
    ...addedGuardrails.map((g) => `- ${g}`),
  ].join('\n');

  const nextBody = opts.skill.body.includes('## 自动沉淀护栏')
    ? `${opts.skill.body.trim()}\n${addedGuardrails.map((g) => `- ${g}`).join('\n')}`
    : `${opts.skill.body.trim()}\n\n${guardrailBlock}`;

  const after = serializeSkillMarkdown({ ...opts.skill, body: nextBody });
  await writeFile(path.join(stagingDir, 'SKILL.md'), after, 'utf8');

  return {
    skillId: opts.skill.id,
    skillName: opts.skill.name,
    keptBase: false,
    rationale,
    addedGuardrails,
    before,
    after,
    preview: buildFileDiffPreview(`skills/${opts.skill.id}/SKILL.md`, before, after),
    experienceEntry: {
      cue,
      lesson,
      evidence,
      confidence: 'high',
    },
  };
}

/**
 * Validate and persist a user-approved `SKILL.md` refinement + optional `EXPERIENCE.md` lesson
 * into `<dataRoot>/skills/<skillId>/`.
 */
export async function applySkillRefinement(opts: {
  dataRoot: string;
  skill: Skill;
  afterMarkdown: string;
  experienceEntry?: SkillRefinementProposal['experienceEntry'];
}): Promise<{ skillPath: string; experiencePath?: string }> {
  assertMemorySafe(opts.afterMarkdown);
  const targetDir = path.join(opts.dataRoot, 'skills', opts.skill.id);
  await mkdir(targetDir, { recursive: true });

  // Validate the skill body against the original directory so referenced assets/scripts
  // still resolve. Writing the overlay must not require those files to be copied first.
  const candidateSkill: Skill = {
    ...opts.skill,
    body: markdownBody(opts.afterMarkdown),
    source: 'user',
    dir: opts.skill.dir,
  };
  const issues = await validateSkill(candidateSkill);
  if (issues.length > 0) {
    throw new Error(`Refused invalid skill refinement: ${issues.join('; ')}`);
  }

  const skillPath = path.join(targetDir, 'SKILL.md');
  await writeFile(skillPath, opts.afterMarkdown, 'utf8');

  let experiencePath: string | undefined;
  if (opts.experienceEntry) {
    experiencePath = path.join(targetDir, 'EXPERIENCE.md');
    let existing = '';
    try {
      existing = await readFile(experiencePath, 'utf8');
    } catch {
      existing = `# ${opts.skill.name} — 跨任务经验库 (Harness² Experience Library)\n\n`;
    }
    const block = [
      `## ${new Date().toISOString().slice(0, 10)}`,
      `- **Cue**: ${opts.experienceEntry.cue}`,
      `- **Lesson**: ${opts.experienceEntry.lesson}`,
      `- **Evidence**: ${opts.experienceEntry.evidence}`,
      `- **Confidence**: ${opts.experienceEntry.confidence}`,
      '',
    ].join('\n');
    assertMemorySafe(block);
    await writeFile(experiencePath, `${existing.trimEnd()}\n\n${block}`, 'utf8');
  }

  return { skillPath, ...(experiencePath ? { experiencePath } : {}) };
}

/**
 * Automatic path: append one deduped lesson to `EXPERIENCE.md` when the latest
 * assistant message contains tool errors or delivery warnings. Never rewrites
 * `SKILL.md` — that overlay replaces the bundled skill and drops its assets.
 */
export async function recordSkillExperience(opts: {
  dataRoot: string;
  skill: Skill;
  messages: ChatMessage[];
}): Promise<boolean> {
  if (!/^[a-z0-9][a-z0-9-_]{0,63}$/i.test(opts.skill.id)) return false;
  const last = [...opts.messages].reverse().find((message) => message.role === 'assistant');
  if (!last) return false;
  const { observedIssues } = extractSessionTrajectoryForSkill([last]);
  if (observedIssues.length === 0) return false;
  const evidence = observedIssues.slice(0, 2).join('；').slice(0, 300);
  const targetDir = path.join(opts.dataRoot, 'skills', opts.skill.id);
  const experiencePath = path.join(targetDir, 'EXPERIENCE.md');
  let existing = '';
  try {
    existing = await readFile(experiencePath, 'utf8');
  } catch {
    existing = `# ${opts.skill.name} — 跨任务经验库 (Harness² Experience Library)\n`;
  }
  if (existing.includes(evidence) || existing.length > 8_000) return false;
  const block = [
    `## ${new Date().toISOString().slice(0, 10)}`,
    `- **Cue**: 技能「${opts.skill.name}」执行时工具返回告警`,
    '- **Lesson**: 结束前先处理这些告警，不要把告警当成已完成。',
    `- **Evidence**: ${evidence}`,
    '- **Confidence**: medium',
    '',
  ].join('\n');
  assertMemorySafe(`${existing}\n${block}`);
  await mkdir(targetDir, { recursive: true });
  await writeFile(experiencePath, `${existing.trimEnd()}\n\n${block}`, 'utf8');
  return true;
}

function markdownBody(markdown: string): string {
  const trimmed = markdown.replace(/^\uFEFF/, '').trim();
  if (!trimmed.startsWith('---')) return trimmed;
  const end = trimmed.indexOf('\n---', 3);
  if (end < 0) return trimmed;
  return trimmed.slice(end + 4).trim();
}

function pushGuardrail(list: string[], line: string, body: string): void {
  const text = line.trim();
  if (!text || list.includes(text) || body.includes(text)) return;
  list.push(text);
}
