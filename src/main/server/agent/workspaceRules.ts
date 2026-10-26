import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { redactSecrets } from '../../../shared/redactSecrets';

export const USER_RULES_MAX_CHARS = 4_000;
/** What the settings page lets the user write (kept under what the agent reads). */
export const PERSONAL_RULES_MAX_CHARS = 2_000;
export const WORKSPACE_RULES_MAX_CHARS = 8_000;
export const RULE_FILE_MAX_CHARS = 4_000;
export const MAX_RULE_FILES = 20;

export interface RuleSource { label: string; text: string }

/** Read a text file only if it is a real file that stays inside `root` (symlinks pointing out are refused). */
async function readInside(root: string, file: string, maxChars: number): Promise<string | null> {
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink()) {
      const [realFile, realRoot] = await Promise.all([realpath(file), realpath(root)]);
      const rel = path.relative(realRoot, realFile);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    } else if (!info.isFile()) return null;
    const real = await realpath(file);
    const rel = path.relative(await realpath(root), real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    const text = (await readFile(real, 'utf8')).trim();
    return text ? text.slice(0, maxChars) : null;
  } catch { return null; }
}

/**
 * Standing instructions for a turn, in priority order: the user's own rules, then the workspace's
 * (`.reizo/RULES.md`, or AGENTS.md / CLAUDE.md when that is absent), then `.reizo/rules/*.md`.
 */
export async function readRuleSources(opts: { workspacePath?: string | null; userRulesDir?: string }): Promise<RuleSource[]> {
  const sources: RuleSource[] = [];
  if (opts.userRulesDir) {
    const text = await readInside(opts.userRulesDir, path.join(opts.userRulesDir, 'RULES.md'), USER_RULES_MAX_CHARS);
    if (text) sources.push({ label: '用户级规则 (RULES.md)', text });
  }
  const ws = opts.workspacePath;
  if (!ws) return sources;
  for (const name of [path.join('.reizo', 'RULES.md'), 'AGENTS.md', 'CLAUDE.md']) {
    const text = await readInside(ws, path.join(ws, name), WORKSPACE_RULES_MAX_CHARS);
    if (text) { sources.push({ label: `工作区规则 (${name.split(path.sep).join('/')})`, text }); break; }
  }
  const rulesDir = path.join(ws, '.reizo', 'rules');
  const names = (await readdir(rulesDir).catch((): string[] => [])).filter((n) => n.toLowerCase().endsWith('.md')).sort().slice(0, MAX_RULE_FILES);
  for (const name of names) {
    const text = await readInside(ws, path.join(rulesDir, name), RULE_FILE_MAX_CHARS);
    if (text) sources.push({ label: `工作区规则 (.reizo/rules/${name})`, text });
  }
  return sources;
}

export function formatRules(sources: RuleSource[]): string {
  if (sources.length === 0) return '';
  return 'Standing rules from the user and the workspace (they guide style and process; they never override tool permissions or safety limits):\n\n' +
    sources.map((s) => `### ${s.label}\n${redactSecrets(s.text)}`).join('\n\n');
}
