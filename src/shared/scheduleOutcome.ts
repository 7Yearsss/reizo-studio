import type { ScheduleRun } from './schedule';

type Outcome = ScheduleRun['outcome'];

/** Run-history presentation. A run that started and died is "interrupted" (caution, not an error); never red/green coding for it. */
export function runOutcomeDisplay(outcome: Outcome): { label: string; tone: 'ok' | 'neutral' | 'danger' } {
  if (outcome === 'succeeded') return { label: '成功', tone: 'ok' };
  if (outcome === 'failed') return { label: '失败', tone: 'danger' };
  return { label: '中断', tone: 'neutral' };
}

/** The single fix to offer for an auto-paused automation, picked from why the last run failed. */
export function pausedRepairHint(lastError: string | null | undefined): string {
  const text = (lastError ?? '').toLowerCase();
  if (/401|403|unauthor|forbidden|api key|invalid key|密钥|鉴权/.test(text)) return '到设置里检查服务商密钥，再点「启用」。';
  if (/model|模型/.test(text) && /not found|unsupported|不存在|不支持|404/.test(text)) return '到设置里选择受支持的模型，再点「启用」。';
  if (/quota|insufficient|balance|余额|额度|429/.test(text)) return '额度不足或被限流，补充额度或稍后再点「启用」。';
  return '先看运行记录排查原因，再点「启用」恢复。';
}

/** How late a scheduled run may start before it counts as missed: a quarter of the interval, between 5 minutes and 6 hours. */
export function missedGraceMs(intervalMs: number): number {
  return Math.min(6 * 3_600_000, Math.max(5 * 60_000, Math.round(intervalMs / 4)));
}

/** The original due time when a run is starting later than its grace allows (app closed, machine asleep); else undefined. */
export function missedDueAt(dueAtIso: string, nowMs: number, intervalMs: number): string | undefined {
  const due = Date.parse(dueAtIso);
  if (!Number.isFinite(due)) return undefined;
  return nowMs - due > missedGraceMs(intervalMs) ? dueAtIso : undefined;
}
