import { readdir, readFile, stat } from 'node:fs/promises';
import { parseAllowedTools } from '../shared/skillToolPolicy';
import path from 'node:path';
import { skillContractSchema, type SkillContract } from '../shared/skillContract';

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  /** Optional prompt template prefilled into the composer when the skill is picked. */
  prompt?: string;
  /** Optional cover image inside `assets/` — shown as the skill card thumbnail. */
  cover?: string;
  /** Optional category slug used to group skills on the plugins page. */
  category?: string;
  /** When the model should pick this skill by itself (one line). */
  trigger?: string;
  /** Look-alike requests that must NOT start it, e.g. questions about what it can do. */
  doNotTrigger?: string;
  /** `disable-auto-invoke: true` — only the user may start it. */
  autoInvoke?: boolean;
  /** `allowed-tools:` — the only tools (and command/path scopes) this skill may use while it runs. */
  allowedTools?: import('../shared/skillToolPolicy').ToolRule[];
  /** `max-turns:` — step limit for a turn that runs this skill (default is the global limit). */
  maxTurns?: number;
  source: 'bundled' | 'user';
  /** Directory the skill file lives in — used to serve `skill-asset:` URLs. */
  dir: string;
  contract?: SkillContract;
  contractError?: string;
  /** Optional cross-task experience library (`EXPERIENCE.md`) accumulated by Harness² skill refinement. */
  experience?: string;
}

const MAX_SKILL_LINES = 500;
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/i;

/**
 * Harness² D6: Deterministic validator for a loaded Skill.
 * Checks naming, non-empty description, line-count cap (<= 500 lines),
 * contract validity, and existence of referenced relative paths (`scripts/...`, `references/...`, `assets/...`).
 */
export async function validateSkill(skill: Skill): Promise<string[]> {
  const issues: string[] = [];
  if (!SKILL_NAME_RE.test(skill.id)) {
    issues.push(`invalid skill id "${skill.id}" (expected alphanumeric/hyphen/underscore, <=64 chars)`);
  }
  if (!skill.description || skill.description.trim().length < 8) {
    issues.push(`skill "${skill.id}" is missing a meaningful description`);
  }
  const lineCount = skill.body.split(/\r?\n/).length;
  if (lineCount > MAX_SKILL_LINES) {
    issues.push(`skill "${skill.id}" body is ${lineCount} lines (exceeds ${MAX_SKILL_LINES}-line cap)`);
  }
  if (skill.contractError) {
    issues.push(skill.contractError);
  }
  const refMatches = skill.body.matchAll(/(?:^|[\s`(])((?:scripts|references|assets)\/[A-Za-z0-9._/-]+)/g);
  const checked = new Set<string>();
  for (const m of refMatches) {
    const rel = m[1].replace(/[).,;:]+$/, '');
    if (checked.has(rel)) continue;
    checked.add(rel);
    try {
      await stat(path.join(skill.dir, rel));
    } catch {
      issues.push(`referenced path "${rel}" does not exist in ${skill.dir}`);
    }
  }
  return issues;
}

/** Skills the model may start by itself: not opted out, and not a delivery-contract skill (those need the picker to wire their tools). */
export function autoInvokableSkills(skills: Skill[]): Skill[] {
  return skills.filter((s) => s.description && s.autoInvoke !== false && !s.contract);
}

/**
 * Catalog of skills the model can start with `use_skill`. One entry per skill with an explicit
 * TRIGGER and DO NOT TRIGGER, so asking what a skill can do does not start it. The skill body
 * itself is delivered in the tool result, which keeps this prefix stable for prompt caching.
 */
export function buildSkillsTriggerIndex(skills: Skill[], maxChars = 7_000): string {
  const usable = autoInvokableSkills(skills);
  if (!usable.length) return '';
  const lines: string[] = [];
  let used = 0;
  for (const s of usable) {
    const line = [
      `- ${s.id} (${s.name}): ${s.description.replace(/\s+/g, ' ').slice(0, 100)}`,
      s.trigger ? `  TRIGGER: ${s.trigger.replace(/\s+/g, ' ')}` : '',
      `  DO NOT TRIGGER: ${(s.doNotTrigger ?? '').replace(/\s+/g, ' ') || '用户只是在问能不能做、怎么做、有哪些能力，或只想聊聊'}`,
    ].filter(Boolean).join('\n');
    if (used + line.length > maxChars) { lines.push(`(${usable.length - lines.length} more via use_skill)`); break; }
    lines.push(line);
    used += line.length + 1;
  }
  return [
    'Skills you can start yourself with the use_skill tool (pass the id). Start one only when the request clearly matches its TRIGGER and not its DO NOT TRIGGER; a question about what you can do is answered in text, not by starting a skill. When a skill instructions are returned, follow them for the rest of the task.',
    ...lines,
  ].join('\n');
}

function parseFrontmatter(raw: string): { name?: string; description?: string; prompt?: string; cover?: string; category?: string; trigger?: string; doNotTrigger?: string; disableAutoInvoke?: boolean; allowedTools?: string; maxTurns?: string; body: string } {
  if (!raw.startsWith('---')) return { body: raw.trim() };
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { body: raw.trim() };
  const matter = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trim();
  const fields: Record<string, string> = {};
  for (const line of matter.split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
  }
  return { name: fields.name, description: fields.description, prompt: fields.prompt, cover: fields.cover, category: fields.category, trigger: fields.trigger, doNotTrigger: fields['do-not-trigger'], disableAutoInvoke: /^true$/i.test(fields['disable-auto-invoke'] ?? ''), allowedTools: fields['allowed-tools'], maxTurns: fields['max-turns'], body };
}

async function loadSkillFile(file: string, source: Skill['source']): Promise<Skill | null> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = parseFrontmatter(raw);
    const id =
      path.basename(file).toLowerCase() === 'skill.md'
        ? path.basename(path.dirname(file))
        : path.basename(file).replace(/\.md$/i, '');
    let contract: SkillContract | undefined;
    let contractError: string | undefined;
    try { contract = skillContractSchema.parse(JSON.parse(await readFile(path.join(path.dirname(file), 'contract.json'), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') contractError = `技能交付约定无效: ${error instanceof Error ? error.message : String(error)}`; }
    let experience: string | undefined;
    if (path.basename(file).toLowerCase() === 'skill.md') {
      try {
        const expRaw = (await readFile(path.join(path.dirname(file), 'EXPERIENCE.md'), 'utf8')).trim();
        if (expRaw) experience = expRaw;
      } catch {
        /* no EXPERIENCE.md yet */
      }
    }
    return {
      id,
      name: parsed.name || id,
      description: parsed.description || '',
      prompt: parsed.prompt,
      cover: parsed.cover,
      category: parsed.category,
      ...(parsed.trigger ? { trigger: parsed.trigger } : {}),
      ...(parsed.doNotTrigger ? { doNotTrigger: parsed.doNotTrigger } : {}),
      autoInvoke: !parsed.disableAutoInvoke,
      ...(parseAllowedTools(parsed.allowedTools) ? { allowedTools: parseAllowedTools(parsed.allowedTools) } : {}),
      ...(Number.isInteger(Number(parsed.maxTurns)) && Number(parsed.maxTurns) > 0 ? { maxTurns: Number(parsed.maxTurns) } : {}),
      body: parsed.body,
      source,
      dir: path.dirname(file),
      contract, contractError,
      ...(experience ? { experience } : {}),
    };
  } catch {
    return null;
  }
}

async function loadDir(dir: string, source: Skill['source']): Promise<Skill[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const skills: Skill[] = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const skill = await loadSkillFile(path.join(dir, entry.name), source);
        if (skill) skills.push(skill);
      } else if (entry.isDirectory()) {
        const nested = path.join(dir, entry.name, 'SKILL.md');
        try {
          await stat(nested);
          const skill = await loadSkillFile(nested, source);
          if (skill) skills.push(skill);
        } catch {
          const experience = await readExperienceFile(path.join(dir, entry.name, 'EXPERIENCE.md'));
          if (!experience) continue;
          skills.push({
            id: entry.name,
            name: entry.name,
            description: '',
            body: '',
            source,
            dir: path.join(dir, entry.name),
            experience,
          });
        }
      }
    }
    return skills;
  } catch {
    return [];
  }
}

async function readExperienceFile(file: string): Promise<string | undefined> {
  try {
    const text = (await readFile(file, 'utf8')).trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

async function directoryHasAssets(dir: string): Promise<boolean> {
  try {
    return (await stat(path.join(dir, 'assets'))).isDirectory();
  } catch {
    return false;
  }
}

export async function loadSkills(dirs: string[]): Promise<Skill[]> {
  const byId = new Map<string, Skill>();
  for (const dir of dirs) {
    const normalized = dir.replace(/\\/g, '/');
    const source: Skill['source'] = normalized.includes('/data/skills') || normalized.includes('/data/plugins/') ? 'user' : 'bundled';
    const loaded = await loadDir(dir, source);
    for (const skill of loaded) {
      const prev = byId.get(skill.id);
      if (!prev) {
        if (skill.body) byId.set(skill.id, skill);
        continue;
      }
      // An experience-only overlay must not replace the bundled skill file or its asset directory.
      if (!skill.body) {
        if (skill.experience) byId.set(skill.id, { ...prev, experience: skill.experience });
        continue;
      }
      const keepPrevDir = prev.dir !== skill.dir && !(await directoryHasAssets(skill.dir));
      byId.set(skill.id, {
        ...prev,
        name: skill.name || prev.name,
        description: skill.description || prev.description,
        body: skill.body,
        prompt: skill.prompt ?? prev.prompt,
        cover: skill.cover ?? prev.cover,
        category: skill.category ?? prev.category,
        contract: skill.contract ?? prev.contract,
        contractError: skill.contractError ?? prev.contractError,
        experience: skill.experience ?? prev.experience,
        source: skill.source,
        dir: keepPrevDir ? prev.dir : skill.dir,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
