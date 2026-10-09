import { useCallback, useEffect, useRef, useState } from 'react';
import { History, Pin, Sparkles, X } from 'lucide-react';
import type { Artifact, ArtifactWithContent } from '../../../shared/artifact';
import { parseSheetContent } from '../../../shared/sheetContent';
import * as api from '../../api';
import * as artifactStore from '../../state/artifactStore';
import { clearSheetRecovery, discardWorkbookEdits, flushWorkbookEdits, getSheetRecovery, setSheetRecovery, trackSheetWrite, useSheetWorkspace, pinSheetSelection } from '../../state/sheetWorkspace';
import { createDeferredView } from '../DeferredView';
import type { SheetRendererProps } from './renderers/SheetRenderer';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import ArtifactVersionRail from './ArtifactVersionRail';
import { focusComposer, ReferenceStrip } from './workspaceChrome';

const Editor = createDeferredView<SheetRendererProps>(() => import('./renderers/SheetRenderer'), { label: 'Excel 编辑器', minHeight: 420 });
interface Frame { doc: ArtifactWithContent; generation: number; recovered: boolean; error?: string }

export default function SheetDocument({ artifact, onClose }: { artifact: Artifact; onClose(): void }) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const current = useRef<ArtifactWithContent | null>(null);
  const sequence = useRef(0);
  const [viewVersion, setViewVersion] = useState<number | undefined>();
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const activeSelection = useSheetWorkspace((s) => s.activeBySession[artifact.sessionId]);
  const ownSelection = activeSelection?.artifactId === artifact.id ? activeSelection : undefined;
  const pinnedCount = useSheetWorkspace((s) => (s.pinnedBySession[artifact.sessionId] ?? []).filter((ref) => ref.artifactId === artifact.id).length);

  useEffect(() => {
    if (!viewVersion && current.current?.id === artifact.id && current.current.version >= artifact.version && frame) return;
    let cancelled = false;
    void (async () => {
      await flushWorkbookEdits(artifact.id);
      const doc = await api.getArtifact(artifact.id, viewVersion);
      if (cancelled) return;
      const draft = !viewVersion ? getSheetRecovery(artifact.id) : undefined;
      const effective = draft ? { ...doc, content: draft.content, version: draft.expectedVersion } : doc;
      current.current = effective;
      setFrame({ doc: effective, generation: ++sequence.current, recovered: Boolean(draft), error: draft?.error });
      setError(draft?.error ?? null);
    })().catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : '表格加载失败'); });
    return () => { cancelled = true; };
  }, [artifact.id, artifact.version, viewVersion, reload]);

  const save = useCallback(async (content: string) => {
    const base = current.current;
    if (!base) throw new Error('表格尚未加载');
    setSheetRecovery(base.id, { sessionId: base.sessionId, content, expectedVersion: base.version });
    try {
      const saved = await trackSheetWrite(base.sessionId, api.addArtifactVersion(base.id, content, base.version));
      current.current = saved;
      clearSheetRecovery(base.id);
      setFrame((previous) => previous ? { ...previous, doc: saved } : previous);
      setError(null);
      artifactStore.upsertArtifact(saved);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '表格保存失败';
      setSheetRecovery(base.id, { sessionId: base.sessionId, content, expectedVersion: base.version, error: message });
      setError(message);
      throw cause;
    }
  }, []);

  async function discardAndReload() {
    await discardWorkbookEdits(artifact.id);
    current.current = null;
    setViewVersion(undefined);
    setReload((n) => n + 1);
  }
  async function pickVersion(version: number) {
    try { await flushWorkbookEdits(artifact.id); setViewVersion(version); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '请先保存表格'); }
  }
  const content = frame ? parseSheetContent(frame.doc.content) : null;
  const truncated = content?.importMeta && (content.importMeta.truncatedRows || content.importMeta.truncatedCols || content.importMeta.truncatedSheets);
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{artifact.name} · v{frame?.doc.version ?? artifact.version}{viewVersion ? ' · 历史版本' : ''}</span>
      {viewVersion && <Button variant="ghost" size="sm" onClick={() => { current.current = null; setViewVersion(undefined); }}>返回最新</Button>}
      <Button variant="ghost" size="icon-sm" aria-label="表格版本历史" onClick={() => setShowHistory((v) => !v)}><History /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="关闭表格" onClick={onClose}><X /></Button>
    </div>
    {!viewVersion && <ReferenceStrip attached={ownSelection?.range ? `${ownSelection.sheetName ?? ''}!${ownSelection.range}${pinnedCount ? ` · 另有 ${pinnedCount} 个固定选区` : ''}` : pinnedCount ? `${pinnedCount} 个固定选区` : undefined}
      hint="选中单元格后，发送消息时会自动带上选区">
      <Button size="xs" variant="ghost" disabled={!ownSelection?.range} title="固定这个选区，切换选择后仍会引用" onClick={() => pinSheetSelection(artifact.sessionId)}><Pin data-icon="inline-start" />固定选区</Button>
      <Button size="xs" variant="ghost" title="跳到对话输入框" onClick={() => focusComposer(artifact.sessionId)}><Sparkles data-icon="inline-start" />问 AI</Button>
    </ReferenceStrip>}
    {error && <Alert variant="destructive"><AlertDescription>{error}<Button variant="outline" size="sm" onClick={() => void discardAndReload()}>丢弃未保存编辑并重新加载</Button></AlertDescription></Alert>}
    {truncated && <Alert><AlertDescription>文件超过当前表格容量，已导入部分内容；原文件未被修改。最多 8 张工作表、2000 行、50 列和 40000 个单元格。</AlertDescription></Alert>}
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        {frame ? <Editor key={`${artifact.id}:${frame.generation}`} artifact={frame.doc} version={frame.doc.version} text={frame.doc.content} rawUrl="" onCommitDraft={!viewVersion ? save : undefined} initialDirty={frame.recovered} initialError={frame.error} /> : <p role="status" className="p-4 text-xs text-ink-muted">正在加载表格…</p>}
      </div>
      {showHistory && <ArtifactVersionRail artifactId={artifact.id} activeVersion={frame?.doc.version ?? artifact.version} onPick={(n) => void pickVersion(n)} onBeforeRestore={() => flushWorkbookEdits(artifact.id)} onRestored={() => { current.current = null; setViewVersion(undefined); setReload((n) => n + 1); void artifactStore.loadSessionArtifacts(artifact.sessionId); }} />}
    </div>
  </div>;
}
