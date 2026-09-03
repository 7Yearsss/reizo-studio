import { useEffect, useState } from 'react';
import { Code2, Copy, Download, Eye, FileDown, History, X } from 'lucide-react';
import type { Artifact } from '../../../shared/artifact';
import { isBlobKind } from '../../../shared/artifact';
import * as api from '../../api';
import * as artifactStore from '../../state/artifactStore';
import { downloadBase64, toHtmlDocument } from '../../lib/artifactExport';
import { pickRenderer } from './renderers';
import ArtifactVersionRail from './ArtifactVersionRail';
import HandoffMenu from './HandoffMenu';

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
  const [sourceView, setSourceView] = useState(false);

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
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable */
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

  const isText = !isBlobKind(artifact.kind);
  const isLatest = version === artifact.version;
  const editable = isText && isLatest && !sourceView;
  const canPdf = artifact.kind === 'markdown' || artifact.kind === 'text' || artifact.kind === 'html';
  const [pdfBusy, setPdfBusy] = useState(false);

  async function exportPdf() {
    if (!window.reizo?.exportPdf) return;
    setPdfBusy(true);
    try {
      const base64 = await window.reizo.exportPdf(toHtmlDocument(artifact, text));
      downloadBase64(base64, artifact.name.replace(/\.[^.]+$/, '') + '.pdf', 'application/pdf');
    } catch {
      /* export failed */
    } finally {
      setPdfBusy(false);
    }
  }

  async function commitDraft(next: string): Promise<void> {
    await api.addArtifactVersion(artifact.id, next);
    artifactStore.invalidateArtifact(artifact.id);
    await Promise.all([
      artifactStore.loadArtifactVersions(artifact.id),
      artifactStore.loadSessionArtifacts(artifact.sessionId),
    ]);
  }

  const effective: Artifact = sourceView ? { ...artifact, renderer: 'code' } : artifact;
  const Renderer = pickRenderer(effective).Component;
  const hasHistory = artifact.versionCount > 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {artifact.name}
          {(!isLatest || hasHistory) && (
            <span className="ml-1.5 text-[10px] text-ink-muted">v{version}</span>
          )}
        </span>
        {artifact.status === 'streaming' && (
          <span className="rounded bg-accent/10 px-1.5 text-[10px] text-accent">生成中…</span>
        )}
        {artifact.status === 'error' && (
          <span className="rounded bg-red-500/10 px-1.5 text-[10px] text-red-500">中断</span>
        )}
        {isText && (
          <button
            type="button"
            onClick={() => setSourceView((v) => !v)}
            className={[
              'rounded p-1 hover:bg-paper-inset hover:text-ink',
              sourceView ? 'text-accent' : 'text-ink-muted',
            ].join(' ')}
            title={sourceView ? '渲染视图' : '源码视图'}
          >
            {sourceView ? <Eye size={12} /> : <Code2 size={12} />}
          </button>
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
        {text && (
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink"
            title="复制"
          >
            <Copy size={12} />
          </button>
        )}
        <HandoffMenu artifact={artifact} getContent={() => text} />
        {canPdf && (
          <button
            type="button"
            onClick={() => void exportPdf()}
            disabled={pdfBusy}
            className="rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink disabled:opacity-50"
            title="导出 PDF"
          >
            <FileDown size={12} />
          </button>
        )}
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
            <Renderer
              artifact={effective}
              version={version}
              text={text}
              rawUrl={rawUrl}
              onCommitDraft={editable ? commitDraft : undefined}
            />
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
