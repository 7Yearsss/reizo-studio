export interface BackgroundRow { command: string; running: boolean; startedAt: number }

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分钟`;
}

/** The status chip text and the hover detail for the commands still running; null when none are. */
export function describeBackground(rows: readonly BackgroundRow[], now: number): { label: string; detail: string } | null {
  const running = rows.filter((r) => r.running);
  if (running.length === 0) return null;
  return {
    label: `${running.length} 个后台任务运行中`,
    detail: running.map((r) => `${r.command.length > 60 ? `${r.command.slice(0, 60)}…` : r.command}（${formatElapsed(now - r.startedAt)}）`).join('\n'),
  };
}
