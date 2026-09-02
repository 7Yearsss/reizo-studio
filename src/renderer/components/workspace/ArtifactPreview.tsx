import { useEffect, useState } from 'react';
import { Copy, Download, History, X } from 'lucide-react';
import type { Artifact } from '../../../shared/artifact';
import * as api from '../../api';
import * as artifactStore from '../../state/artifactStore';
import { pickRenderer } from './renderers';
import ArtifactVersionRail from './ArtifactVersionRail';

export default function ArtifactPreview({
  artifact,
  onClose,
}: {
  artifact: Artifact;
  onClose: () => void;
}) {
  const [version, setVersion] = useState(artifact.version);
  const [text, setText] = useState('');
  const [rawUrl, setRawUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [showRail, setShowRail] = useState(false);

  // Reset when a different artifact is selected.
  useEffect(() => {
    setVersion(artifact.version);
  }, [artifact.id, artifact.version]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setText('');
    setRawUrl('');
    void (async () => {
      const full = await artifactStore.loadArtifactContent(artifact.id, version);
      if (cancelled) return;
      if (full?.rawUrl) {
        setRawUrl(await api.artifactRawUrl(artifact.id, version));
      } else {
        setText(full?.content ?? '');
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [artifact.id, version]);

  async function copy() {
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        /* clipboard unavailable */
      }
    }
  }

  async function download() {
    if (rawUrl) {
      const a = document.createElement('a');
      a.href = rawUrl;
      a.download = artifact.name;
      a.click();
      return;
    }
    const blob = new Blob([text], { type: artifact.mimeType || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  const Renderer = pickRenderer(artifact).Component;
  const hasHistory = artifact.versionCount > 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {artifact.name}
          {version !== artifact.version || hasHistory ? (
            <span className="ml-1.5 text-[10px] text-ink-muted">v{version}</span>
          ) : null}
        </span>
        {artifact.status === 'streaming' && (
          <span className="rounded bg-accent/10 px-1.5 text-[10px] text-accent">生成中…</span>
        )}
        {artifact.status === 'error' && (
          <span className="rounded bg-red-500/10 px-1.5 text-[10px] text-red-500">中断</span>
        )}
        {hasHistory && (
          <button
            type="button"
            onClick={() => setShowRail((v) => !v)}
            className={[
              'rounded p-1 hover:bg-paper-inset hover:text-ink',
              showRail ? 'text-accent' : 'text-ink-muted',
            ].join(' ')}
            title="版本历史"
          >
            <History size={12} />
          </button>
        )}
        {text ? (
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink"
            title="复制"
          >
            <Copy size={12} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void download()}
          className="rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink"
          title="下载"
        >
          <Download size={12} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink"
          aria-label="关闭预览"
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
          {loading ? (
            <p className="px-3 py-2 text-xs text-ink-muted">加载中…</p>
          ) : (
            <Renderer artifact={artifact} version={version} text={text} rawUrl={rawUrl} />
          )}
        </div>
        {showRail && hasHistory && (
          <ArtifactVersionRail
            artifactId={artifact.id}
            activeVersion={version}
            onPick={setVersion}
            onRestored={() => {
              artifactStore.invalidateArtifact(artifact.id);
              void artifactStore.loadSessionArtifacts(artifact.sessionId);
            }}
          />
        )}
      </div>
    </div>
  );
}
