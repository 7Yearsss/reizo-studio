import { useEffect, useState } from 'react';
import { FileCode2, FileJson, FileText, Image as ImageIcon, LayoutGrid, RefreshCw } from 'lucide-react';
import type { Artifact, ArtifactKind } from '../../shared/artifact';
import * as api from '../api';
import ArtifactPreview from '../components/workspace/ArtifactPreview';
import Tooltip from '../components/ui/Tooltip';
import { Loader } from '../components/motion/loader';
import { toast } from '../lib/toast';

const KIND_LABELS: Record<ArtifactKind, string> = {
  markdown: 'Markdown',
  html: 'HTML',
  text: '文本',
  json: 'JSON',
  image: '图片',
  binary: '二进制',
  svg: 'SVG',
  diagram: '图表',
  code: '代码',
  video: '视频',
  audio: '音频',
  sketch: '手绘',
};

function KindIcon({ kind }: { kind: ArtifactKind }) {
  const className = 'h-4 w-4 shrink-0 text-accent';
  if (kind === 'json') return <FileJson className={className} />;
  if (kind === 'html') return <FileCode2 className={className} />;
  if (kind === 'image') return <ImageIcon className={className} />;
  return <FileText className={className} />;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function ArtifactsPage() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selected, setSelected] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh(showToast = false) {
    setLoading(true);
    try {
      const next = await api.listArtifacts();
      setArtifacts(next);
      setSelected((current) => (current && next.some((item) => item.id === current.id) ? current : null));
      if (showToast) toast.success(`已刷新作品列表（${next.length} 个）`);
    } catch {
      if (showToast) toast.error('刷新失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-line px-8 py-5">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">
            <LayoutGrid className="h-5 w-5 text-accent" />
            我的作品
          </h1>
          <p className="mt-1 text-sm text-ink-muted">集中查看所有会话生成的文件和附件。</p>
        </div>
        <Tooltip content="刷新作品列表">
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={loading}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-paper-inset hover:text-ink disabled:opacity-50 transition-colors"
            aria-label="刷新作品"
          >
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </button>
        </Tooltip>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-8 py-6">
          {loading && artifacts.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-ink-muted">
              <Loader variant="spinner" size={16} />
              加载中…
            </div>
          ) : artifacts.length === 0 ? (
            <div className="py-16 text-center text-sm text-ink-muted">暂无作品</div>
          ) : (
            <div className="grid max-w-5xl grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {artifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  type="button"
                  onClick={() => setSelected(artifact)}
                  className={[
                    'flex min-w-0 items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                    selected?.id === artifact.id
                      ? 'border-ink/30 bg-paper-inset'
                      : 'border-line bg-paper-raised hover:bg-paper-inset/70',
                  ].join(' ')}
                >
                  <KindIcon kind={artifact.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{artifact.name}</span>
                    <span className="mt-1 block truncate text-xs text-ink-muted">
                      {KIND_LABELS[artifact.kind]} · {artifact.source === 'attachment' ? '附件' : '生成'}
                    </span>
                    <span className="mt-1 block truncate font-mono text-[10px] text-ink-muted/80">
                      {formatTime(artifact.createdAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <aside className="flex w-[420px] shrink-0 flex-col border-l border-line bg-sidebar">
            <ArtifactPreview artifact={selected} onClose={() => setSelected(null)} />
          </aside>
        )}
      </div>
    </div>
  );
}
