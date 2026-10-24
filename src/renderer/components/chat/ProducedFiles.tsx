import { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import type { ToolCallPart } from '../../../shared/chat';
import WorkspaceFileDialog from '../workspace/WorkspaceFileDialog';

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

export default function ProducedFiles({ parts }: { parts?: ToolCallPart[] }) {
  const paths = useMemo(() => producedFilePaths(parts), [parts]);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  if (!paths.length) return null;
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
    {paths.map(path => <button key={path} type="button" className="chat-file-link inline-flex min-w-0 max-w-full items-center gap-1.5 text-[13px]" title={path} onClick={() => setPreviewPath(path)}>
      <FileText size={14} className="shrink-0" /><span className="truncate">{path.split(/[/\\]/).pop()}</span>
    </button>)}
    {previewPath && <WorkspaceFileDialog path={previewPath} onClose={() => setPreviewPath(null)} />}
  </div>;
}
