import { useEffect, useState, type ReactElement } from 'react';
import { describeBackground } from '../../../shared/backgroundTasks';
import * as api from '../../api';

/** "N 个后台任务运行中" for commands the agent left running; hover for the commands and how long. Renders nothing when none. */
export default function BackgroundTasksChip({ sessionId }: { sessionId: string }): ReactElement | null {
  const [rows, setRows] = useState<api.BackgroundShellRow[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const poll = (): void => {
      void api.listBackgroundShells(sessionId).then(
        (next) => { if (!cancelled) { setRows(next); setNow(Date.now()); } },
        (): void => undefined,
      );
    };
    poll();
    const timer = window.setInterval(poll, 5000);
    return (): void => { cancelled = true; window.clearInterval(timer); };
  }, [sessionId]);

  const info = describeBackground(rows, now);
  if (!info) return null;
  return (
    <div className="mb-2 flex" role="status">
      <span title={info.detail} className="inline-flex items-center gap-1.5 rounded-full bg-paper-inset px-2.5 py-1 text-[11px] text-ink-muted">
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
        {info.label}
      </span>
    </div>
  );
}
