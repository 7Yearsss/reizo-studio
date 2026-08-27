import { useEffect, useState } from 'react';
import { Copy, Download, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Artifact } from '../../../shared/artifact';
import * as artifactStore from '../../state/artifactStore';

export default function ArtifactPreview({
  artifact,
  onClose,
}: {
  artifact: Artifact;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void artifactStore.loadArtifactContent(artifact.id).then((full) => {
      if (!cancelled) {
        setContent(full?.content ?? '');
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [artifact.id]);

  async function copy() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      /* ignore */
    }
  }

  function download() {
    if (content === null) return;
    const blob = new Blob([content], { type: artifact.mimeType || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{artifact.name}</span>
        <button type="button" onClick={() => void copy()} className="rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink" title="复制">
          <Copy size={12} />
        </button>
        <button type="button" onClick={download} className="rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink" title="下载">
          <Download size={12} />
        </button>
        <button type="button" onClick={onClose} className="rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink" aria-label="关闭预览">
          <X size={12} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
        {loading ? (
          <p className="text-ink-muted">加载中…</p>
        ) : artifact.kind === 'markdown' ? (
          <div className="markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content ?? ''}</ReactMarkdown>
          </div>
        ) : artifact.kind === 'html' ? (
          <iframe
            title={artifact.name}
            sandbox=""
            className="h-full min-h-[120px] w-full rounded border border-line bg-paper-raised"
            srcDoc={content ?? ''}
          />
        ) : artifact.kind === 'image' && content && (content.startsWith('data:') || content.startsWith('http')) ? (
          <img src={content} alt={artifact.name} className="max-w-full rounded" />
        ) : (
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5">{content || '（空）'}</pre>
        )}
      </div>
    </div>
  );
}
