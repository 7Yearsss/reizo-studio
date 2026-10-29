import { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import type { ToolCallPart } from '../../../shared/chat';
import WorkspaceFileDialog from '../workspace/WorkspaceFileDialog';
import { toolDiffPreview } from './toolDisplay';
import { Undo2 } from 'lucide-react';
import { ApiRequestError, rollbackSnapshot } from '../../api';
import { toast } from '../../lib/toast';
import { confirmDialog } from '../../state/confirmStore';
import { lineStats, type LineStats } from '../../../shared/lineStats';

export function producedFilePaths(parts: ToolCallPart[] = []): string[] {
  const paths = new Set<string>();
  for (const part of parts) {
    if (!['write_file', 'edit_file'].includes(part.name) || !part.result || part.error) continue;
    try {
      const result = JSON.parse(part.result);
      if (result.error || result.ok === false) continue;
      const path = typeof result.path === 'string' ? result.path : part.args.path;
      if (typeof path === 'string' && path.trim()) paths.add(path);
    } catch { /* Only confirmed tool outputs become file links. */ }
  }
  return [...paths];
}

/** Net line change per file across the turn: the first edit's "before" against the last edit's "after". */
export function producedFileStats(parts: ToolCallPart[] = []): Map<string, LineStats> {
  const span = new Map<string, { before: string; after: string }>();
  for (const part of parts) {
    if (!['write_file', 'edit_file'].includes(part.name) || part.error) continue;
    const preview = toolDiffPreview(part);
    if (!preview || preview.truncated) continue;
    const seen = span.get(preview.path);
    span.set(preview.path, { before: seen ? seen.before : preview.before, after: preview.after });
  }
  return new Map([...span].map(([path, { before, after }]) => [path, lineStats(before, after)]));
}

/** Snapshot ids of this turn's successful file edits, newest first — the order they must be undone in. */
export function turnSnapshotIds(parts: ToolCallPart[] = []): string[] {
  const ids: string[] = [];
  for (const part of parts) {
    if (!['write_file', 'edit_file'].includes(part.name) || part.error || !part.result) continue;
    try {
      const id = (JSON.parse(part.result) as { snapshotId?: unknown }).snapshotId;
      if (typeof id === 'string') ids.push(id);
    } catch { /* not a structured result */ }
  }
  return ids.reverse();
}

export default function ProducedFiles({ parts, sessionId }: { parts?: ToolCallPart[]; sessionId?: string }) {
  const [undoing, setUndoing] = useState(false);
  const snapshotIds = useMemo(() => turnSnapshotIds(parts), [parts]);
  async function undoTurn() {
    if (!sessionId || snapshotIds.length === 0) return;
    const ok = await confirmDialog({
      title: '撤销本轮的全部文件改动？',
      description: `将按相反顺序回滚 ${snapshotIds.length} 次修改；某个文件在这之后又被改过时会停下，不会覆盖。`,
      confirmLabel: '撤销',
      destructive: true,
    });
    if (!ok) return;
    setUndoing(true);
    let restored = 0;
    try {
      for (const id of snapshotIds) {
        await rollbackSnapshot(sessionId, id, false);
        restored++;
      }
      toast.success('已撤销本轮改动', `${restored} 次修改已回滚`);
    } catch (error) {
      const stale = error instanceof ApiRequestError && error.status === 409;
      toast.error(stale ? '已停下：有文件在这之后又被改过' : '撤销失败', `已回滚 ${restored}/${snapshotIds.length} 次；${error instanceof Error ? error.message : ''}`);
    } finally {
      setUndoing(false);
    }
  }
  const paths = useMemo(() => producedFilePaths(parts), [parts]);
  const stats = useMemo(() => producedFileStats(parts), [parts]);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  if (!paths.length) return null;
  const total = [...stats.values()].reduce((sum, v) => ({ added: sum.added + v.added, removed: sum.removed + v.removed }), { added: 0, removed: 0 });
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
    {paths.length > 1 && stats.size > 0 ? <span className="text-[12px] text-ink-muted tabular-nums">本轮改动 {paths.length} 个文件 · +{total.added} −{total.removed}</span> : null}
    {paths.map(path => <button key={path} type="button" className="chat-file-link inline-flex min-w-0 max-w-full items-center gap-1.5 text-[13px]" title={path} onClick={() => setPreviewPath(path)}>
      <FileText size={14} className="shrink-0" /><span className="truncate">{path.split(/[/\\]/).pop()}</span>
      {stats.get(path) ? <span className="shrink-0 text-[11px] text-ink-muted tabular-nums">+{stats.get(path)?.added} −{stats.get(path)?.removed}</span> : null}
    </button>)}
    {sessionId && snapshotIds.length > 0 ? <button type="button" disabled={undoing} onClick={() => void undoTurn()} className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink disabled:opacity-50"><Undo2 size={12} />{undoing ? '正在撤销' : '撤销本轮改动'}</button> : null}
    {previewPath && <WorkspaceFileDialog path={previewPath} onClose={() => setPreviewPath(null)} />}
  </div>;
}
