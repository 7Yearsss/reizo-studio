import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, History, Quote, Redo2, Undo2 } from 'lucide-react';
import type { Artifact, ArtifactWithContent } from '../../../shared/artifact';
import type { ArtifactReview } from '../../../shared/artifactReview';
import * as api from '../../api';
import { referenceHtml, useHtmlWorkspace, dropHtmlSelection } from '../../state/htmlWorkspace';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import LazyDiffView from '../chat/LazyDiffView';
import HtmlCodeEditor, { type HtmlCodeHandle } from './HtmlCodeEditor';
import HtmlPreview from './HtmlPreview';
import { useTextArtifact } from './useTextArtifact';
import ArtifactHistoryDialog from './ArtifactHistoryDialog';
import { focusComposer, ReferenceStrip, ReviewLog, SaveStatus } from './workspaceChrome';

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/html;charset=utf-8' })); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function HtmlEditor({ artifact }: { artifact: Artifact }) {
  const [full, setFull] = useState<ArtifactWithContent | null>(null); const [error, setError] = useState('');
  useEffect(() => { let cancelled = false; void api.getArtifact(artifact.id).then((next) => { if (!cancelled) setFull(next); }, (cause) => { if (!cancelled) setError(String(cause)); }); return () => { cancelled = true; }; }, [artifact.id, artifact.version]);
  return <>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}{full ? <Editor key={full.id} artifact={full} /> : <p role="status" className="p-4 text-xs">正在加载页面…</p>}</>;
}
function Editor({ artifact }: { artifact: ArtifactWithContent }) {
  const draft = useTextArtifact(artifact);
  const code = useRef<HtmlCodeHandle>(null);
  const [busy, setBusy] = useState(false); const [history, setHistory] = useState(false);
  const [run, setRun] = useState(false); const [preview, setPreview] = useState(draft.text);
  const [reviews, setReviews] = useState<ArtifactReview[]>([]);
  const revision = useHtmlWorkspace((s) => s.revisions[artifact.id]);
  const reference = useHtmlWorkspace((s) => s.references[artifact.sessionId]);
  const referenced = reference?.artifactId === artifact.id ? reference : undefined;
  const refresh = useCallback(async () => { setReviews(await api.listArtifactReviews(artifact.id)); }, [artifact.id]);
  useEffect(() => { const timer = setTimeout(() => setPreview(draft.text), 350); return () => clearTimeout(timer); }, [draft.text]);
  useEffect(() => { void refresh().catch((cause) => draft.setError(String(cause))); }, [refresh, revision, artifact.version]);
  const pending = reviews.filter((review) => review.changes.some((change) => change.status === 'pending'));
  async function act(action: () => Promise<void>) {
    if (busy) return; setBusy(true); draft.setError('');
    try { await draft.flush(); await action(); }
    catch (cause) { draft.setError(cause instanceof Error ? cause.message : '操作失败'); await refresh().catch((): void => { /* Original error remains visible. */ }); }
    finally { setBusy(false); }
  }
  async function decide(review: ArtifactReview, ids: string[], decision: 'accept' | 'reject') {
    await act(async () => {
      const result = await api.decideArtifactReview(artifact.id, review.id, review.reviewVersion, ids, decision);
      if (result.artifact.version !== draft.getVersion()) { draft.load(result.artifact); dropHtmlSelection(artifact.sessionId); setRun(false); }
      await refresh();
    });
  }
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1">
      <Button size="icon-sm" variant="ghost" className="size-7" aria-label="撤销源码修改" title="撤销" disabled={busy} onClick={() => code.current?.undo()}><Undo2 /></Button>
      <Button size="icon-sm" variant="ghost" className="size-7" aria-label="重做源码修改" title="重做" disabled={busy} onClick={() => code.current?.redo()}><Redo2 /></Button>
      <div className="ml-auto flex items-center gap-1 pl-2">
        <SaveStatus status={draft.status} version={draft.getVersion()} failed={Boolean(draft.error)} />
        <Button size="icon-sm" variant="ghost" className="size-7" aria-label="HTML 版本历史" title="版本历史" disabled={busy} onClick={() => void act(async () => setHistory(true))}><History /></Button>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void act(async () => download(draft.getText(), /\.html?$/i.test(artifact.name) ? artifact.name : `${artifact.name}.html`))}><Download data-icon="inline-start" />导出</Button>
      </div>
    </div>
    <ReferenceStrip attached={referenced ? (referenced.selection ? `选区「${referenced.selection.text}」` : '整页') : undefined} hint="在源码中选中一段交给 AI，或把整页作为上下文">
      <Button size="xs" variant="ghost" disabled={busy} title="引用源码中选中的内容" onClick={() => { const selection = code.current?.selection(); if (!selection) { draft.setError('请先在源码中选择一段内容'); return; } void act(async () => { referenceHtml(artifact.sessionId, { artifactId: artifact.id, name: artifact.name, version: draft.getVersion(), selection }); focusComposer(artifact.sessionId); }); }}><Quote data-icon="inline-start" />引用选区</Button>
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => void act(async () => { referenceHtml(artifact.sessionId, { artifactId: artifact.id, name: artifact.name, version: draft.getVersion() }); focusComposer(artifact.sessionId); })}>引用页面</Button>
    </ReferenceStrip>
    {draft.error && <Alert variant="destructive"><AlertDescription>{draft.error}<div className="mt-2 flex gap-2"><Button size="xs" variant="outline" onClick={() => void act(async () => { /* Flush retries the retained draft. */ })}>重试保存</Button><Button size="xs" variant="outline" onClick={() => { void (async () => { await draft.waitForSave()?.catch((): void => { /* Keep recovery source. */ }); download(draft.getText(), `${artifact.name}-恢复副本.html`); const latest = await api.getArtifact(artifact.id); draft.load(latest); dropHtmlSelection(artifact.sessionId); })().catch((cause) => draft.setError(String(cause))); }}>下载恢复副本并重新载入</Button></div></AlertDescription></Alert>}
    <div className="min-h-0 flex-1 overflow-auto">
      <Tabs defaultValue="code" className="gap-0"><div className="flex items-center justify-between gap-2 px-2 py-1"><TabsList><TabsTrigger value="code">源码</TabsTrigger><TabsTrigger value="preview">页面预览</TabsTrigger></TabsList><Button variant="ghost" size="xs" onClick={() => setRun((value) => !value)}>{run ? '停止脚本' : '运行页面脚本'}</Button></div>
        <TabsContent value="code" forceMount className="h-[420px] data-[state=inactive]:hidden"><div inert={busy} className="h-full"><HtmlCodeEditor key={draft.source.generation} ref={code} name={artifact.name} text={draft.source.text} onChange={(text) => { draft.change(text); dropHtmlSelection(artifact.sessionId); }} /></div></TabsContent>
        <TabsContent value="preview" forceMount className="h-[420px] data-[state=inactive]:hidden"><HtmlPreview html={preview} run={run} /></TabsContent>
      </Tabs>
      {run && <p className="px-3 py-1 text-xs text-ink-muted">已运行页面内脚本；外部脚本和网络请求未启用。</p>}
      <section aria-label="HTML 修改建议" className="flex flex-col gap-3 border-t border-line p-3"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">AI 修改建议</h3><span className="text-xs text-ink-muted">接受后更新源码</span></div>
        {!pending.length && <p className="text-xs text-ink-muted">暂无待审核修改。引用源码或整页后，可在对话中让 AI 修改。</p>}
        {pending.map((review) => <div key={review.id} className="flex flex-col gap-2 rounded-lg border border-line p-3">
          {review.stale && <Alert><AlertDescription>源码已更新，这批建议已过期，请重新生成。</AlertDescription></Alert>}
          <div className="flex items-center gap-2"><span className="mr-auto text-xs text-ink-muted">基于版本 {review.baseVersion}</span><Button size="xs" variant="outline" disabled={busy} onClick={() => void decide(review, review.changes.filter((c) => c.status === 'pending').map((c) => c.id), 'reject')}>全部拒绝</Button><Button size="xs" disabled={busy || review.stale} onClick={() => void decide(review, review.changes.filter((c) => c.status === 'pending').map((c) => c.id), 'accept')}>全部接受</Button></div>
          <details><summary className="cursor-pointer text-xs">预览本批建议效果</summary><div className="mt-2 h-72"><HtmlPreview html={review.candidateContent} title="HTML 修改建议预览" /></div></details>
          {review.changes.filter((change) => change.status === 'pending').map((change) => <div key={change.id} className="flex flex-col gap-2"><p className="text-xs text-ink-muted">{change.label}</p><LazyDiffView preview={{ path: artifact.name, before: change.before, after: change.after }} /><div className="flex justify-end gap-2"><Button size="xs" variant="outline" disabled={busy} onClick={() => void decide(review, [change.id], 'reject')}>拒绝</Button><Button size="xs" disabled={busy || review.stale} onClick={() => void decide(review, [change.id], 'accept')}>接受</Button></div></div>)}
        </div>)}
        <ReviewLog reviews={reviews} />
      </section>
    </div>
    {history && <ArtifactHistoryDialog artifact={{ ...artifact, version: draft.getVersion() }} close={() => setHistory(false)} flush={draft.flush} getVersion={draft.getVersion} render={(content) => <HtmlPreview html={content} title="HTML 历史版本预览" />} restored={async () => { draft.load(await api.getArtifact(artifact.id)); dropHtmlSelection(artifact.sessionId); setRun(false); await refresh(); }} />}
  </div>;
}
