import type { ReplyPhase } from '../../shared/stream';

/** Text is only "replying" while tokens are still arriving. */
export const TEXT_ACTIVE_MS = 1_800;
/** No useful stream event — say so instead of pretending we are writing. */
export const QUIET_MS = 8_000;
/** Long enough that "waiting" should feel like a stall, not a pause. */
export const STALE_MS = 45_000;

export function liveReplyPhase(input: {
  sending: boolean;
  waitingOnUser?: boolean;
  activeToolCount?: number;
  lastTextAt?: number;
  now?: number;
}): ReplyPhase | undefined {
  if (!input.sending) return undefined;
  if (input.waitingOnUser) return 'waiting';
  if ((input.activeToolCount ?? 0) > 0) return 'tools';
  const now = input.now ?? Date.now();
  if (input.lastTextAt && now - input.lastTextAt < TEXT_ACTIVE_MS) return 'replying';
  return 'thinking';
}

export function liveReplySilence(input: {
  lastProgressAt?: number;
  now?: number;
}): 'live' | 'quiet' | 'stale' {
  if (!input.lastProgressAt) return 'live';
  const gap = (input.now ?? Date.now()) - input.lastProgressAt;
  if (gap >= STALE_MS) return 'stale';
  if (gap >= QUIET_MS) return 'quiet';
  return 'live';
}

export function liveReplyWaitLabel(input: {
  silence: 'live' | 'quiet' | 'stale';
  waitedMs: number;
}): string | undefined {
  if (input.silence === 'stale') {
    return `模型还没有返回内容，已等待 ${formatTurnElapsed(input.waitedMs)}`;
  }
  if (input.silence === 'quiet') return '正在等待模型返回';
  return undefined;
}

export function formatTurnElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}:${String(rest).padStart(2, '0')}`;
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
