export interface ActiveWork {
  /** Conversation replies being produced right now. */
  turns: number;
  /** Video generation jobs in flight. */
  videoJobs: number;
}

export function hasActiveWork(work: ActiveWork): boolean {
  return work.turns > 0 || work.videoJobs > 0;
}

/** What the confirm dialog tells the user is still running; empty when nothing is. */
export function describeActiveWork(work: ActiveWork): string[] {
  const lines: string[] = [];
  if (work.turns > 0) lines.push(`${work.turns} 个对话正在回复`);
  if (work.videoJobs > 0) lines.push(`${work.videoJobs} 个视频正在生成`);
  return lines;
}
