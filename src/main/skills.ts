import { readdir, readFile, stat } from 'node:fs/promises';
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

/**
 * Harness² A1: Progressive disclosure — builds a compact one-line-per-skill trigger index
 * (`name — description`) instead of dumping every skill body into the system prompt.
 */
export function buildSkillsTriggerIndex(skills: Skill[], maxChars = 2_400): string {
  if (!skills.length) return '';
  const lines: string[] = [];
  let used = 0;
  for (const s of skills) {
    if (!s.description) continue;
    const line = `- ${s.id} (${s.name}): ${s.description.replace(/\s+/g, ' ').slice(0, 160)}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length
    ? `Available domain skills (progressive disclosure — follow matching domain rules when the request fits):\n${lines.join('\n')}`
    : '';
}

function parseFrontmatter(raw: string): { name?: string; description?: string; prompt?: string; cover?: string; category?: string; body: string } {
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
  return { name: fields.name, description: fields.description, prompt: fields.prompt, cover: fields.cover, category: fields.category, body };
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
          /* skip */
        }
      }
    }
    return skills;
  } catch {
    return [];
  }
}

export async function loadSkills(dirs: string[]): Promise<Skill[]> {
  const byId = new Map<string, Skill>();
  for (const dir of dirs) {
    const normalized = dir.replace(/\\/g, '/');
    const source: Skill['source'] = normalized.includes('/data/skills') || normalized.includes('/data/plugins/') ? 'user' : 'bundled';
    const loaded = await loadDir(dir, source);
    for (const skill of loaded) byId.set(skill.id, skill);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
