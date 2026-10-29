import { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import type { ToolCallPart } from '../../../shared/chat';
import WorkspaceFileDialog from '../workspace/WorkspaceFileDialog';
import { toolDiffPreview } from './toolDisplay';
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

export default function ProducedFiles({ parts }: { parts?: ToolCallPart[] }) {
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
    {previewPath && <WorkspaceFileDialog path={previewPath} onClose={() => setPreviewPath(null)} />}
  </div>;
}
