export type WorkOutcome = 'error' | 'interrupted' | 'completed' | null | undefined;

/** Collapsed work-group summary: "工作完成 · 12s · 5 步". Steps are tool calls; omitted when there were none. */
export function workSummaryLabel(input: { outcome: WorkOutcome; duration?: string; steps: number }): string {
  const head = input.outcome === 'error' ? '工作失败' : input.outcome === 'interrupted' ? '工作中断' : '工作完成';
  return [head, input.duration, input.steps > 0 ? `${input.steps} 步` : undefined].filter(Boolean).join(' · ');
}
