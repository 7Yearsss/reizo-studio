import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  source: 'bundled' | 'user';
}

function parseFrontmatter(raw: string): { name?: string; description?: string; body: string } {
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
  return { name: fields.name, description: fields.description, body };
}

async function loadSkillFile(file: string, source: Skill['source']): Promise<Skill | null> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = parseFrontmatter(raw);
    const id =
      path.basename(file).toLowerCase() === 'skill.md'
        ? path.basename(path.dirname(file))
        : path.basename(file).replace(/\.md$/i, '');
    return {
      id,
      name: parsed.name || id,
      description: parsed.description || '',
      body: parsed.body,
      source,
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
    const source: Skill['source'] = dir.replace(/\\/g, '/').includes('/data/skills') ? 'user' : 'bundled';
    const loaded = await loadDir(dir, source);
    for (const skill of loaded) byId.set(skill.id, skill);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
