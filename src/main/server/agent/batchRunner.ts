export type BatchTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'stopped';
export type BatchReason = 'completed' | 'error' | 'stalled' | 'aborted';

export interface BatchTaskInput {
  title: string;
  task: string;
  role?: string;
}

export interface BatchRow {
  index: number;
  title: string;
  status: BatchTaskStatus;
  reason?: BatchReason;
  /** Steps the sub-agent has finished so far (each one is a sign of life). */
  steps: number;
  /** The sub-agent's final answer (succeeded) or the failure message. */
  detail?: string;
}

export interface BatchContext {
  /** Call on every sign of progress; the stall timer only counts silence. */
  heartbeat(): void;
  signal: AbortSignal;
}

export const BATCH_MAX_TASKS = 16;
export const BATCH_MAX_CONCURRENCY = 6;
/** No step for this long ⇒ that one task is stopped (the others carry on). Long tasks that keep working are never cut off by total time. */
export const BATCH_STALL_MS = 120_000;

/**
 * Run tasks with at most `concurrency` in flight. A task is judged by its own heartbeat, not by wall-clock:
 * as long as it keeps finishing steps it may run for as long as it needs; if it goes quiet it is stopped alone.
 * Results keep the input order. `onUpdate` receives a fresh snapshot whenever any row changes.
 */
export async function runBatch(options: {
  tasks: BatchTaskInput[];
  concurrency: number;
  stallMs?: number;
  runOne: (task: BatchTaskInput, context: BatchContext) => Promise<string>;
  onUpdate?: (rows: BatchRow[]) => void;
  signal?: AbortSignal;
}): Promise<BatchRow[]> {
  const stallMs = options.stallMs ?? BATCH_STALL_MS;
  const rows: BatchRow[] = options.tasks.map((t, index) => ({ index, title: t.title, status: 'queued', steps: 0 }));
  const publish = () => options.onUpdate?.(rows.map((r) => ({ ...r })));
  publish();

  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= options.tasks.length) return;
      const row = rows[index];
      if (options.signal?.aborted) {
        row.status = 'stopped';
        row.reason = 'aborted';
        publish();
        continue;
      }
      row.status = 'running';
      publish();
      const controller = new AbortController();
      const onOuterAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onOuterAbort, { once: true });
      let stalled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arm = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { stalled = true; controller.abort(); }, stallMs);
      };
      arm();
      try {
        const detail = await options.runOne(options.tasks[index], {
          signal: controller.signal,
          heartbeat: () => { row.steps += 1; arm(); publish(); },
        });
        if (stalled) throw new Error('stalled');
        row.status = 'succeeded';
        row.reason = 'completed';
        row.detail = detail;
      } catch (error) {
        if (stalled) {
          row.status = 'stopped';
          row.reason = 'stalled';
          row.detail = `这个子任务超过 ${Math.round(stallMs / 1000)} 秒没有新进展，已单独停止`;
        } else if (options.signal?.aborted) {
          row.status = 'stopped';
          row.reason = 'aborted';
        } else {
          row.status = 'failed';
          row.reason = 'error';
          row.detail = error instanceof Error ? error.message : String(error);
        }
      } finally {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener('abort', onOuterAbort);
        publish();
      }
    }
  }

  const width = Math.max(1, Math.min(options.concurrency, options.tasks.length));
  await Promise.all(Array.from({ length: width }, () => worker()));
  return rows;
}

/** Text the main agent receives: one block per task with its status, so a stopped or failed task is never mistaken for done. */
export function formatBatchResult(rows: BatchRow[], maxPerTask = 3_000): string {
  const label: Record<BatchTaskStatus, string> = { queued: '未开始', running: '进行中', succeeded: '完成', failed: '失败', stopped: '已停止' };
  const done = rows.filter((r) => r.status === 'succeeded').length;
  const blocks = rows.map((r) => {
    const detail = (r.detail ?? '').trim();
    const clipped = detail.length > maxPerTask ? `${detail.slice(0, maxPerTask)}\n…(truncated)` : detail;
    return `### ${r.index + 1}. ${r.title} — ${label[r.status]}\n${clipped || '(no output)'}`;
  });
  return `${done}/${rows.length} tasks succeeded.\n\n${blocks.join('\n\n')}`;
}
