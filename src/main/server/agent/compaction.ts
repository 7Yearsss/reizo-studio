import { nanoid } from 'nanoid';
import type { ChatMessage, SessionStore } from '../../../shared/chat';
import { isCompactBoundary, makeBoundary, messagesForModel, parseBoundary, summarizableRange } from '../../../shared/compactBoundary';
import { compactLevel, createCompactBreaker, keepRecentTurnsFor } from '../../../shared/autoCompact';
import { estimateMessagesTokens } from './budgetTracker';
import { isSessionTurnLive } from './session';
import { redactSecrets } from '../../../shared/redactSecrets';

export type RewriteText = (system: string, prompt: string, signal?: AbortSignal) => Promise<string>;

const PER_MESSAGE_CHARS = 4_000;
const TRANSCRIPT_CHARS = 60_000;

export const SUMMARY_SYSTEM = [
  'You compress the earlier part of a conversation between a user and an AI work assistant into a briefing the assistant will rely on instead of the original messages.',
  'Write in the same language the user used. Be factual: never invent anything that is not in the transcript, and say so plainly if something was left unfinished or unclear.',
  'Cover, as short bullet lists under these headings (omit an empty heading): 目标 / Goal; 已完成与结论 / Done and conclusions; 重要事实、数字、文件与产物（名称/路径/ID）/ Facts, figures, files and artifacts; 用户的偏好与约束 / Preferences and constraints; 未完成与待办 / Open items.',
  'Keep every identifier the assistant would need to continue (file paths, artifact names, node titles, numbers). Do not include pleasantries. At most about 600 words.',
].join('\n');

function renderMessage(message: ChatMessage): string {
  if (isCompactBoundary(message)) {
    const payload = parseBoundary(message);
    return `Earlier summary:\n${payload?.summaryText ?? ''}`;
  }
  // The synthetic summary row (role user) carries its text in content.
  const body = message.content.trim().slice(0, PER_MESSAGE_CHARS);
  const tools = (message.parts ?? []).map((part) => part.name).filter(Boolean);
  const toolLine = tools.length ? `\n[tools used: ${[...new Set(tools)].join(', ')}]` : '';
  const who = message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : message.role;
  return `${who}: ${body}${toolLine}`;
}

/** The text handed to the summariser; secrets are masked and the total is capped (newest content wins). */
export function buildTranscript(messages: ChatMessage[]): string {
  const lines = messages.map(renderMessage).filter((line) => line.trim());
  let transcript = redactSecrets(lines.join('\n\n'));
  if (transcript.length > TRANSCRIPT_CHARS) transcript = '…' + transcript.slice(transcript.length - TRANSCRIPT_CHARS);
  return transcript;
}

export interface CompactResult {
  compacted: boolean;
  /** How many messages the summary replaces for the model (the transcript on screen is unchanged). */
  summarized: number;
  reason?: 'nothing_to_compact' | 'empty_summary';
}

/**
 * Summarise the older part of a session with the configured model and append a boundary row. Messages are
 * never edited or removed: only what the model is sent changes.
 */
export async function compactSession(options: {
  sessionStore: SessionStore;
  sessionId: string;
  rewriteText: RewriteText;
  keepRecentTurns: number;
  source: 'manual' | 'auto';
  signal?: AbortSignal;
}): Promise<CompactResult> {
  const session = await options.sessionStore.get(options.sessionId);
  if (!session) throw new Error('Session not found');
  const range = summarizableRange(session.messages, options.keepRecentTurns);
  if (!range) return { compacted: false, summarized: 0, reason: 'nothing_to_compact' };
  const summary = (await options.rewriteText(SUMMARY_SYSTEM, `Conversation to compress:\n\n${buildTranscript(range.messages)}`, options.signal)).trim();
  if (!summary) return { compacted: false, summarized: 0, reason: 'empty_summary' };
  await options.sessionStore.appendMessage(
    options.sessionId,
    makeBoundary({ summaryText: summary, summarizedToId: range.toId, source: options.source }, nanoid()),
  );
  return { compacted: true, summarized: range.messages.length };
}

/** Rough token cost of what the model would be sent for this session (tool results are clipped before sending). */
export function estimateSessionTokens(messages: ChatMessage[]): number {
  return estimateMessagesTokens(
    messagesForModel(messages).map((m) => ({
      role: m.role,
      content: m.content + (m.parts ?? []).map((p) => String(p.result ?? '').slice(0, 2_000)).join(''),
    })),
  );
}

/**
 * Before a turn: if the conversation has grown past ~75% of the context window, summarise the older part
 * first so the turn does not run into the limit. Best effort — any failure leaves the session as it was and
 * the turn proceeds; a breaker stops it from retrying a model that keeps failing.
 */
export function createAutoCompactor(options: { sessionStore: SessionStore; rewriteText: RewriteText; windowTokens?: number; /** The context window of the model the next turn will use, when known. */ getWindowTokens?: () => Promise<number | undefined> }) {
  const breakers = new Map<string, ReturnType<typeof createCompactBreaker>>();
  return async function autoCompactBeforeTurn(sessionId: string): Promise<CompactResult | null> {
    if (isSessionTurnLive(sessionId)) return null;
    const session = await options.sessionStore.get(sessionId);
    if (!session) return null;
    const windowTokens = (await options.getWindowTokens?.().catch((): undefined => undefined)) ?? options.windowTokens;
    const level = compactLevel(estimateSessionTokens(session.messages), windowTokens);
    if (level !== 'compact' && level !== 'urgent') return null;
    const breaker = breakers.get(sessionId) ?? createCompactBreaker();
    breakers.set(sessionId, breaker);
    if (!breaker.canAttempt()) return null;
    try {
      const result = await compactSession({
        sessionStore: options.sessionStore, sessionId, rewriteText: options.rewriteText,
        keepRecentTurns: keepRecentTurnsFor(level), source: 'auto',
      });
      breaker.recordSuccess();
      return result;
    } catch (error) {
      breaker.recordFailure(error);
      console.warn('[compaction] automatic compaction failed; continuing without it', error instanceof Error ? error.message : error);
      return null;
    }
  };
}
