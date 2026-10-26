import { checkToolCall, toolIsOffered, type ToolRule } from '../../../shared/skillToolPolicy';

/** Plumbing the agent needs whatever a skill allows; they cannot act on the machine or the network. */
const ALWAYS_AVAILABLE = new Set(['ask_user', 'todo_write']);

type Executable = { execute?: (input: never, options: never) => unknown };

/**
 * Limit a running skill to the tools (and, for commands and paths, the arguments) it declared in
 * `allowed-tools`. Unlisted tools are not offered at all; listed ones are checked again on every call.
 */
export function applySkillToolPolicy<T extends Record<string, unknown>>(tools: T, rules: ToolRule[] | undefined): T {
  if (!rules) return tools;
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(tools)) {
    if (ALWAYS_AVAILABLE.has(name)) { out[name] = value; continue; }
    if (!toolIsOffered(rules, name)) continue;
    const original = (value as Executable)?.execute;
    if (typeof original !== 'function') { out[name] = value; continue; }
    out[name] = {
      ...(value as object),
      execute: (input: Record<string, unknown>, options: never) => {
        const verdict = checkToolCall(rules, name, input ?? {});
        if (!verdict.allowed) throw new Error(verdict.reason ?? '当前技能不允许这次调用');
        return (original as (i: unknown, o: unknown) => unknown)(input, options);
      },
    };
  }
  return out as T;
}
