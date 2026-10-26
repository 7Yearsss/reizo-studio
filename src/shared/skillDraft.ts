export interface SkillDraft {
  name: string;
  description: string;
  body: string;
  trigger?: string;
  doNotTrigger?: string;
}

export interface ExistingSkillInfo { id: string; name: string; description: string; source: 'bundled' | 'user' }

const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;
export const MAX_DRAFT_BODY_LINES = 200;

/** A folder-safe id from a skill name: ASCII letters/digits and dashes; names with no ASCII fall back to "skill". */
export function skillIdFromName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || 'skill';
}

/** Problems that stop a draft from being saved; empty means it is fine. */
export function validateSkillDraft(draft: SkillDraft, id: string): string[] {
  const problems: string[] = [];
  if (!ID_RE.test(id)) problems.push('技能 id 只能用字母、数字、短横线和下划线');
  if (!draft.name.trim()) problems.push('缺少名称');
  if (!draft.description.trim()) problems.push('缺少一句话描述');
  if (draft.body.trim().length < 40) problems.push('正文太短，没有可复用的步骤');
  if (draft.body.split('\n').length > MAX_DRAFT_BODY_LINES) problems.push(`正文超过 ${MAX_DRAFT_BODY_LINES} 行，请精简`);
  return problems;
}

const tokens = (text: string): Set<string> => {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const word of lower.match(/[a-z0-9]{3,}/g) ?? []) out.add(word);
  for (const run of lower.match(/[一-鿿]+/g) ?? []) for (let i = 0; i + 1 < run.length; i += 1) out.add(run.slice(i, i + 2));
  return out;
};

/** Existing skills that cover roughly the same ground (same id, or heavy overlap of name and description). */
export function findSimilarSkills(draft: SkillDraft, id: string, existing: readonly ExistingSkillInfo[]): ExistingSkillInfo[] {
  const mine = tokens(`${draft.name} ${draft.description}`);
  return existing.filter((skill) => {
    if (skill.id === id) return true;
    const theirs = tokens(`${skill.name} ${skill.description}`);
    if (mine.size === 0 || theirs.size === 0) return false;
    let shared = 0;
    for (const t of mine) if (theirs.has(t)) shared += 1;
    return shared / Math.min(mine.size, theirs.size) >= 0.5;
  });
}

const line = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** The SKILL.md text. Frontmatter values are flattened to one line so a draft cannot smuggle in extra fields. */
export function renderSkillMarkdown(draft: SkillDraft): string {
  const head = [
    '---',
    `name: ${line(draft.name)}`,
    `description: ${line(draft.description)}`,
    draft.trigger ? `trigger: ${line(draft.trigger)}` : '',
    draft.doNotTrigger ? `do-not-trigger: ${line(draft.doNotTrigger)}` : '',
    '---',
  ].filter(Boolean);
  return `${head.join('\n')}\n\n${draft.body.trim()}\n`;
}
