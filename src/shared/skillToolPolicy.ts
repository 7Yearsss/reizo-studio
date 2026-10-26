/**
 * A skill can limit what the agent may do while it runs (`allowed-tools:` in the skill's frontmatter).
 * Four forms, comma separated:
 *   read_file                 exact tool name
 *   mcp__github__*            wildcard on the tool name
 *   run_command(git *)        tool + pattern for its command
 *   write_file(/src/**)       tool + glob for its path
 */
export interface ToolRule {
  /** Tool name, or a prefix ending in `*`. */
  name: string;
  /** Pattern the tool's command / path must match; absent = any arguments. */
  argPattern?: string;
}

/** Split on commas that are not inside parentheses. */
function splitRules(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of source) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function parseAllowedTools(source: string | undefined): ToolRule[] | undefined {
  if (!source || !source.trim()) return undefined;
  const rules: ToolRule[] = [];
  for (const part of splitRules(source)) {
    const match = /^([A-Za-z0-9_*-]+)(?:\((.*)\))?$/.exec(part);
    if (!match) continue;
    rules.push({ name: match[1], ...(match[2] !== undefined && match[2].trim() ? { argPattern: match[2].trim() } : {}) });
  }
  return rules.length ? rules : undefined;
}

const escapeRegExp = (value: string) => value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** `*` = anything except `/` for paths, anything for commands; `**` = anything including `/`. */
export function globMatches(pattern: string, value: string, isPath: boolean): boolean {
  const star = isPath ? '[^/]*' : '.*';
  // Translate token by token so `**` and `*` never interfere with each other.
  const source = escapeRegExp(pattern).replace(/\*\*|\*/g, (token) => (token === '**' ? '.*' : star));
  return new RegExp(`^${source}$`).test(value);
}

function nameMatches(ruleName: string, toolName: string): boolean {
  return ruleName.endsWith('*') ? toolName.startsWith(ruleName.slice(0, -1)) : ruleName === toolName;
}

const PATH_ARG_TOOLS = new Set(['write_file', 'edit_file', 'read_file', 'list_dir']);

function argumentOf(toolName: string, args: Record<string, unknown>): string | null {
  if (toolName === 'run_command') return typeof args.command === 'string' ? args.command.trim() : null;
  if (PATH_ARG_TOOLS.has(toolName)) return typeof args.path === 'string' ? args.path.replace(/\\/g, '/') : null;
  return null;
}

/** Can this tool be offered at all? True if any rule names it (argument limits are checked per call). */
export function toolIsOffered(rules: ToolRule[], toolName: string): boolean {
  return rules.some((rule) => nameMatches(rule.name, toolName));
}

export interface ToolVerdict { allowed: boolean; reason?: string }

/**
 * Is this specific call allowed? Any matching rule without an argument limit allows it; otherwise the call's
 * command/path must match one of the limits. A call whose argument cannot be read is refused.
 */
export function checkToolCall(rules: ToolRule[], toolName: string, args: Record<string, unknown>): ToolVerdict {
  const matching = rules.filter((rule) => nameMatches(rule.name, toolName));
  if (matching.length === 0) return { allowed: false, reason: `当前技能不允许使用工具 ${toolName}` };
  if (matching.some((rule) => !rule.argPattern)) return { allowed: true };
  const value = argumentOf(toolName, args);
  if (value === null) return { allowed: false, reason: `当前技能只允许 ${toolName} 在限定范围内使用，无法确认这次调用的范围` };
  const isPath = toolName !== 'run_command';
  // A compound shell line could smuggle a second command past a prefix pattern, so it must match as a whole.
  if (toolName === 'run_command' && /[;&|`$<>\n]/.test(value)) {
    return { allowed: false, reason: '当前技能限制了可执行的命令，含管道/串联的复合命令不被允许' };
  }
  if (matching.some((rule) => globMatches(rule.argPattern!, value, isPath))) return { allowed: true };
  return { allowed: false, reason: `当前技能只允许 ${matching.map((r) => `${toolName}(${r.argPattern})`).join('、')}，「${value.slice(0, 80)}」不在范围内` };
}
