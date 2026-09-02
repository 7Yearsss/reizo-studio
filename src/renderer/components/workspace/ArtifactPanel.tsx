import { useEffect, useMemo, useState } from 'react';
import {
  FileCode2,
  FileJson,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import type { ArtifactKind } from '../../../shared/artifact';
import { useArtifactStore } from '../../state/useArtifactStore';
import * as artifactStore from '../../state/artifactStore';
import ArtifactPreview from './ArtifactPreview';

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

const SOURCE_LABELS: Record<string, string> = {
  attachment: '附件',
  generated: '生成',
  manual: '手动',
};

function KindIcon({ kind }: { kind: ArtifactKind }) {
  const cls = 'h-3.5 w-3.5 shrink-0 text-accent';
  if (kind === 'json') return <FileJson className={cls} />;
  if (kind === 'html') return <FileCode2 className={cls} />;
  if (kind === 'image') return <ImageIcon className={cls} />;
  return <FileText className={cls} />;
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

export default function ArtifactPanel({ sessionId }: { sessionId: string }) {
  const artifacts = useArtifactStore((s) => s.bySession[sessionId]) ?? [];
  const loading = useArtifactStore((s) => s.loadingBySession[sessionId]) ?? false;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void artifactStore.loadSessionArtifacts(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (selectedId && !artifacts.some((a) => a.id === selectedId)) setSelectedId(null);
  }, [artifacts, selectedId]);

  const selected = useMemo(
    () => artifacts.find((a) => a.id === selectedId) ?? null,
    [artifacts, selectedId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
          <FolderKanban className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="truncate">本会话作品</span>
          {artifacts.length > 0 ? (
            <span className="rounded-full bg-paper-inset px-1.5 text-[10px] font-medium tabular-nums">
              {artifacts.length}
            </span>
          ) : null}
        </h2>
        <button
          type="button"
          onClick={() => void artifactStore.loadSessionArtifacts(sessionId)}
          disabled={loading}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-paper-inset hover:text-ink disabled:opacity-50"
          title="刷新"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && artifacts.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-6 text-xs text-ink-muted">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            加载中…
          </div>
        ) : artifacts.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <FolderKanban className="mx-auto h-6 w-6 text-ink-muted/50" />
            <p className="mt-2 text-xs text-ink-muted">暂无作品</p>
            <p className="mt-1 text-[11px] leading-4 text-ink-muted">
              附件和 Agent 写入的文件会出现在这里
            </p>
          </div>
        ) : (
          <ul className="flex flex-col p-2">
            {artifacts.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(a.id)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-xl px-2.5 py-2.5 text-left hover:bg-paper-inset/70',
                    selectedId === a.id && 'bg-paper-inset',
                  )}
                >
                  <KindIcon kind={a.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-xs font-medium">
                      <span className="truncate">{a.name}</span>
                      {a.versionCount > 1 ? (
                        <span className="shrink-0 rounded bg-paper-inset px-1 text-[9px] font-medium tabular-nums text-ink-muted">
                          v{a.version}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-muted">
                      {KIND_LABELS[a.kind]} · {SOURCE_LABELS[a.source] ?? a.source} · {formatTime(a.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected ? (
        <div className="flex max-h-[55%] min-h-[140px] shrink-0 flex-col border-t border-line">
          <ArtifactPreview artifact={selected} onClose={() => setSelectedId(null)} />
        </div>
      ) : null}
    </div>
  );
}
