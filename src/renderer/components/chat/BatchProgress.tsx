import { CheckCircle2, CircleDashed, Loader2, OctagonX, XCircle } from 'lucide-react';
import type { BatchProgressRow, } from '../../../shared/stream';
import { useChatStore } from '../../state/useChatStore';
import { cn } from '../../lib/cn';

const STATUS_LABEL: Record<BatchProgressRow['status'], string> = { queued: '排队中', running: '进行中', succeeded: '完成', failed: '失败', stopped: '已停止' };

function Icon({ status }: { status: BatchProgressRow['status'] }) {
  if (status === 'running') return <Loader2 size={14} className="animate-spin text-accent motion-reduce:animate-none" />;
  if (status === 'succeeded') return <CheckCircle2 size={14} className="text-[#059669]" />;
  if (status === 'failed') return <XCircle size={14} className="text-danger" />;
  if (status === 'stopped') return <OctagonX size={14} className="text-danger" />;
  return <CircleDashed size={14} className="text-ink-muted" />;
}

/** One line per sub-task of a parallel batch, updated as they run. */
export default function BatchProgress({ id, tasks }: { id: string; tasks: number }) {
  const rows = useChatStore((s) => s.batchRowsById[id]);
  if (!rows) return <p className="text-xs text-ink-muted">正在分配 {tasks} 个子任务…</p>;
  const done = rows.filter((r) => r.status === 'succeeded').length;
  return (
    <div className="rounded-xl border border-line bg-paper-raised px-3 py-2">
      <p className="mb-1 text-xs text-ink-muted">并行子任务 {done}/{rows.length}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.index} className="flex items-center gap-2 text-sm">
            <Icon status={row.status} />
            <span className="min-w-0 flex-1 truncate text-ink">{row.title}</span>
            <span className={cn('shrink-0 text-xs', row.status === 'failed' || row.status === 'stopped' ? 'text-danger' : 'text-ink-muted')}>
              {STATUS_LABEL[row.status]}{row.status === 'running' && row.steps > 0 ? ` · ${row.steps} 步` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
