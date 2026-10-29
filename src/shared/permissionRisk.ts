export type RiskTag = 'destructive' | 'irreversible' | 'network';

export const RISK_LABEL: Record<RiskTag, string> = {
  destructive: '可能删除或覆盖文件',
  irreversible: '操作不可撤销',
  network: '会访问网络',
};

const DESTRUCTIVE = /\b(rm\s+-[a-z]*[rf]|rmdir|del\s|erase\s|Remove-Item|rd\s+\/s|mv\s|move\s|format\s|truncate\b|dd\s+if=|git\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--|restore\b)|drop\s+(table|database)|delete\s+from)\b/i;
const IRREVERSIBLE = /\b(git\s+push\b.*(--force|-f\b)|git\s+push\b|npm\s+publish|chmod\s+-R|chown\s+-R|shutdown|reboot|kill(all)?\s|taskkill|mkfs|diskpart|drop\s+(table|database))\b/i;
const NETWORK = /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|ssh|scp|sftp|ftp|nc|ncat|git\s+(clone|fetch|pull|push)|npm\s+(install|i|publish)|pip\s+install|pnpm\s+(add|install)|yarn\s+add)\b|https?:\/\//i;

/** Text a tool call would run or send, flattened for scanning. */
function callText(args: Record<string, unknown>): string {
  return Object.values(args)
    .map((value) => (typeof value === 'string' ? value : ''))
    .join('\n');
}

/** Cheap, conservative risk tags for an approval card. Never a verdict — only a nudge to read the command. */
export function assessRisk(tool: string, args: Record<string, unknown>): RiskTag[] {
  const tags = new Set<RiskTag>();
  if (tool === 'http_fetch' || tool === 'web_search' || /^mcp__/.test(tool)) tags.add('network');
  if (tool === 'run_command' || tool === 'bash' || tool === 'shell') {
    const text = callText(args);
    if (DESTRUCTIVE.test(text)) tags.add('destructive');
    if (IRREVERSIBLE.test(text)) tags.add('irreversible');
    if (NETWORK.test(text)) tags.add('network');
  }
  return (['destructive', 'irreversible', 'network'] as RiskTag[]).filter((tag) => tags.has(tag));
}

// Zero-width, bidi-control and other invisible code points that can disguise what a command does.
const HIDDEN = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD]/g;

export function hasHiddenChars(text: string): boolean {
  HIDDEN.lastIndex = 0;
  return HIDDEN.test(text);
}

/** Make invisible characters visible: a zero-width space (U+200B) becomes the text <U+200B>. */
export function revealHiddenChars(text: string): string {
  return text.replace(HIDDEN, (ch) => `<U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>`);
}
