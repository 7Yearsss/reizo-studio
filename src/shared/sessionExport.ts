import type { ChatMessage, Session } from './chat';
import { redactSecrets } from './redactSecrets';

export interface ShareRedactionOptions {
  workspacePath?: string | null;
}

export interface RedactionStats {
  secrets: number;
  paths: number;
  emails: number;
}

const HOME_PATH = /(?:[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+|\/Users\/[^/\s"'`]+|\/home\/[^/\s"'`]+)/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Make text safe to paste into an issue: secrets, workspace/home paths and emails are replaced. */
export function redactForShare(text: string, options: ShareRedactionOptions = {}): { text: string; stats: RedactionStats } {
  const stats: RedactionStats = { secrets: 0, paths: 0, emails: 0 };
  let out = text;
  const withoutSecrets = redactSecrets(out);
  if (withoutSecrets !== out) stats.secrets = (withoutSecrets.match(/\[REDACTED:/g) ?? []).length;
  out = withoutSecrets;
  if (options.workspacePath) {
    const trimmed = options.workspacePath.replace(/[\\/]+$/, '');
    const separators = trimmed.split(/[\\/]+/).map(escapeRegExp).join('[\\\\/]+');
    out = out.replace(new RegExp(separators, 'gi'), () => { stats.paths += 1; return '<workspace>'; });
  }
  out = out.replace(HOME_PATH, () => { stats.paths += 1; return '<home>'; });
  out = out.replace(EMAIL, () => { stats.emails += 1; return '<email>'; });
  return { text: out, stats };
}

export type ExportDetail = 'structure' | 'full';

function sum(a: RedactionStats, b: RedactionStats): RedactionStats {
  return { secrets: a.secrets + b.secrets, paths: a.paths + b.paths, emails: a.emails + b.emails };
}

/**
 * Redacted, shareable copy of a session. `structure` (for troubleshooting)
 * replaces user/assistant text with a size placeholder and keeps tool traffic;
 * `full` (for sharing) keeps the text, redacted.
 */
export function buildSessionExport(session: Session, detail: ExportDetail): { messages: ChatMessage[]; title: string; stats: RedactionStats } {
  let stats: RedactionStats = { secrets: 0, paths: 0, emails: 0 };
  const redact = (value: string) => {
    const r = redactForShare(value, { workspacePath: session.workspacePath });
    stats = sum(stats, r.stats);
    return r.text;
  };
  const messages = session.messages.filter((m) => !m.rewindAt).map((m): ChatMessage => {
    const isProse = m.role === 'user' || m.role === 'assistant';
    const content = detail === 'structure' && isProse ? `[${m.role} text omitted, ${m.content.length} chars]` : redact(m.content);
    const parts = m.parts ? (JSON.parse(redact(JSON.stringify(m.parts))) as ChatMessage['parts']) : undefined;
    const { reasoning: _reasoning, reasoningSegments: _segments, ...rest } = m;
    return { ...rest, content, ...(parts ? { parts } : {}) };
  });
  return { messages, title: redact(session.title), stats };
}

export function sessionToMarkdown(title: string, messages: ChatMessage[]): string {
  const lines = [`# ${title}`, ''];
  for (const m of messages) {
    if (m.role === 'user' || m.role === 'assistant') lines.push(`## ${m.role}`, '', m.content, '');
    else lines.push(`## ${m.role}`, '', '```', m.content, '```', '');
    for (const part of m.parts ?? []) lines.push(`- tool \`${(part as { name?: string }).name ?? 'call'}\``);
    if (m.parts?.length) lines.push('');
  }
  return lines.join('\n');
}
