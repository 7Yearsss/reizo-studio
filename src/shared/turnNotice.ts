/** A reply shorter than this is not worth a system notification: the user is probably still looking at it. */
export const TURN_NOTICE_MIN_MS = 20_000;

export interface TurnDoneFacts { hidden: boolean; durationMs: number | undefined; outcome: string }

/** Notify only when the window is out of sight, the reply took a while, and it actually finished (or failed). */
export function shouldNotifyTurnDone(facts: TurnDoneFacts): boolean {
  if (!facts.hidden) return false;
  if (facts.outcome !== 'completed' && facts.outcome !== 'error') return false;
  return (facts.durationMs ?? 0) >= TURN_NOTICE_MIN_MS;
}

export function turnDoneNotice(sessionTitle: string, outcome: string): { title: string; body: string } {
  const name = sessionTitle.trim().slice(0, 40) || '对话';
  return outcome === 'error' ? { title: 'Reizo 回复失败', body: `「${name}」没有完成，回来看看原因` } : { title: 'Reizo 已完成', body: `「${name}」的回复已就绪` };
}
