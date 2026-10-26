const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const pad = (n: number): string => String(n).padStart(2, '0');

export interface PromptVarContext { now: Date; workspaceName?: string; projectName?: string }

/** `2026-10-27（周二）`, in the machine's local time. */
export function formatToday(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}（${WEEKDAYS[now.getDay()]}）`;
}

/** The line that tells the model what day it is; without it "本周", "昨天", "今年" are guesses. */
export function currentDateLine(now: Date): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  return `Current date: ${formatToday(now)} ${pad(now.getHours())}:${pad(now.getMinutes())} (${tz}). Use it for anything relative to "today", "this week", "last month".`;
}

/**
 * Fill `{{date}}`, `{{weekday}}`, `{{time}}`, `{{workspace}}` and `{{project}}` in text the user wrote for the prompt
 * (rules, project instructions, expert instructions). Unknown variables are left exactly as written.
 */
export function expandPromptVars(text: string, ctx: PromptVarContext): string {
  const values: Record<string, string | undefined> = {
    date: `${ctx.now.getFullYear()}-${pad(ctx.now.getMonth() + 1)}-${pad(ctx.now.getDate())}`,
    weekday: WEEKDAYS[ctx.now.getDay()],
    time: `${pad(ctx.now.getHours())}:${pad(ctx.now.getMinutes())}`,
    workspace: ctx.workspaceName,
    project: ctx.projectName,
  };
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => values[key.toLowerCase()] ?? match);
}
