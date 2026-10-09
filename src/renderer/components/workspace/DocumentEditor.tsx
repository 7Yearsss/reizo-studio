import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Bold, Italic, List, ListOrdered, Table, Undo2, Redo2, Download, Quote, History } from 'lucide-react';
import type { Artifact, ArtifactWithContent } from '../../../shared/artifact';
import type { ArtifactReview } from '../../../shared/artifactReview';
import { documentExtensions, normalizeDocumentContent, parseDocumentContent, typographyCss, type DocumentContent, type DocumentSelection } from '../../../shared/documentContent';
import * as api from '../../api';
import * as artifacts from '../../state/artifactStore';
import { clearEditorRecovery, getEditorRecovery, registerEditorFlusher, setEditorRecovery, trackEditorWrite } from '../../state/editorPersistence';
import { referenceDocument, useDocumentWorkspace } from '../../state/documentWorkspace';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import DocumentReview, { ReviewLog } from './DocumentReview';
import ArtifactHistoryDialog from './ArtifactHistoryDialog';
import DocumentReadOnly from './DocumentReadOnly';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DocumentEditor({ artifact }: { artifact: Artifact }) {
  const [full, setFull] = useState<ArtifactWithContent | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void api.getArtifact(artifact.id).then((doc) => { if (!cancelled) { setFull(doc); setError(''); } }, (cause) => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; };
  }, [artifact.id, artifact.version]);
  return <>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}{full ? <Editor key={full.id} artifact={full} /> : <p role="status" className="p-4 text-xs">正在加载文档…</p>}</>;
}

function Editor({ artifact }: { artifact: ArtifactWithContent }) {
  const [initial] = useState(() => {
    const recovered = getEditorRecovery(artifact.id);
    const content = parseDocumentContent(recovered?.content ?? artifact.content);
    if (!content) throw new Error('文档格式无效');
    return { content, version: recovered?.expectedVersion ?? artifact.version, recovered };
  });
  const value = useRef<DocumentContent>(initial.content);
  const version = useRef(initial.version);
  const dirty = useRef(Boolean(initial.recovered));
  const writing = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const [status, setStatus] = useState(initial.recovered ? '有未保存内容' : '已保存');
  const [error, setError] = useState(initial.recovered?.error ?? '');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const [selection, setSelection] = useState<DocumentSelection | undefined>();
  const [reviews, setReviews] = useState<ArtifactReview[]>([]);
  const revision = useDocumentWorkspace((s) => s.revisions[artifact.id]);
  const activeReview = reviews.find((r) => r.changes.some((c) => c.status === 'pending'));
  const pendingBatches = reviews.filter((r) => r.changes.some((c) => c.status === 'pending')).length;
  const refreshReviews = useCallback(async () => { const next = await api.listArtifactReviews(artifact.id); if (mounted.current) setReviews(next); }, [artifact.id]);
  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    if (writing.current) return writing.current;
    const task = Promise.resolve().then(async () => {
      while (dirty.current) {
        const snapshot = JSON.stringify(value.current);
        const normalized = normalizeDocumentContent(value.current);
        const raw = JSON.stringify(normalized);
        if (mounted.current) setStatus('正在保存…');
        const saved = await api.addArtifactVersion(artifact.id, raw, version.current);
        version.current = saved.version;
        dirty.current = JSON.stringify(value.current) !== snapshot;
        if (!dirty.current) value.current = normalized;
        artifacts.upsertArtifact(saved);
        if (!dirty.current) clearEditorRecovery(artifact.id);
        else setEditorRecovery(artifact.id, { sessionId: artifact.sessionId, content: JSON.stringify(value.current), expectedVersion: version.current });
      }
      if (mounted.current) { setStatus('已保存'); setError(''); }
    }).catch((cause) => {
      const message = cause instanceof Error ? cause.message : '保存失败';
      setEditorRecovery(artifact.id, { sessionId: artifact.sessionId, content: JSON.stringify(value.current), expectedVersion: version.current, error: message });
      if (mounted.current) { setError(message); setStatus('尚未保存'); }
      throw cause;
    }).finally(() => { writing.current = null; });
    writing.current = trackEditorWrite(artifact.sessionId, task);
    return task;
  }, [artifact.id, artifact.sessionId]);
  const editor = useEditor({
    extensions: documentExtensions(), content: initial.content.doc,
    editorProps: { attributes: { class: 'document-prose min-h-80 px-6 py-5 outline-none', style: typographyCss(initial.content), 'aria-label': '文档正文', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: current }) => {
      if (JSON.stringify(value.current.doc) === JSON.stringify(current.getJSON())) return;
      value.current = { ...value.current, doc: current.getJSON() }; dirty.current = true; setStatus('尚未保存');
      setEditorRecovery(artifact.id, { sessionId: artifact.sessionId, content: JSON.stringify(value.current), expectedVersion: version.current });
      // Any edit invalidates the exact selection previously sent to the composer.
      referenceDocument(artifact.sessionId);
      clearTimeout(timer.current); timer.current = setTimeout(() => { void flush().catch((): void => { /* Error is shown by the save/review handler. */ }); }, 700);
    },
    onSelectionUpdate: ({ editor: current }) => {
      const { $from, $to, empty } = current.state.selection;
      setSelection(!empty && $from.sameParent($to) && $from.parent.isTextblock && typeof $from.parent.attrs.id === 'string'
        ? { blockId: $from.parent.attrs.id, start: $from.parentOffset, end: $to.parentOffset, text: current.state.doc.textBetween($from.pos, $to.pos).slice(0, 2000) } : undefined);
    },
  });
  useEffect(() => {
    mounted.current = true;
    const unregister = registerEditorFlusher(artifact.sessionId, artifact.id, flush);
    return () => { mounted.current = false; clearTimeout(timer.current); unregister(); void flush().catch((): void => { /* Error is shown by the save/review handler. */ }); };
  }, [artifact.id, artifact.sessionId, flush]);
  useEffect(() => { void refreshReviews().catch((cause) => setError(String(cause))); }, [refreshReviews, revision, artifact.version]);
  useEffect(() => {
    if (!editor || artifact.version <= version.current) return;
    if (dirty.current) { setError('原文已有新版本，当前未保存内容已保留。可下载恢复副本后重新载入。'); return; }
    const content = parseDocumentContent(artifact.content); if (!content) return;
    value.current = content; version.current = artifact.version;
    editor.commands.setContent(content.doc, { emitUpdate: false });
    referenceDocument(artifact.sessionId); setSelection(undefined); setStatus('已保存');
  }, [artifact, editor]);
  async function act(run: () => Promise<void>) {
    setBusy(true); editor?.setEditable(false, false); setError('');
    try { await flush(); await run(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); await refreshReviews().catch((): void => { /* Error is shown by the save/review handler. */ }); return false; }
    finally { setBusy(false); editor?.setEditable(true, false); }
  }
  async function decide(review: ArtifactReview, ids: string[], decision: 'accept' | 'reject') {
    await act(async () => {
      const result = await api.decideArtifactReview(artifact.id, review.id, review.reviewVersion, ids, decision);
      const next = parseDocumentContent(result.artifact.content);
      if (next && result.artifact.version > version.current) {
        value.current = next; version.current = result.artifact.version;
        editor?.commands.setContent(next.doc, { emitUpdate: false });
        referenceDocument(artifact.sessionId); setSelection(undefined);
      }
      artifacts.upsertArtifact(result.artifact); await refreshReviews();
    });
  }
  async function recover() {
    if (writing.current) await writing.current.catch((): void => { /* Error is shown by the save/review handler. */ });
    download(new Blob([JSON.stringify(value.current, null, 2)], { type: 'application/json' }), `${artifact.name}-恢复副本.json`);
    const latest = await api.getArtifact(artifact.id); const content = parseDocumentContent(latest.content); if (!content) throw new Error('文档格式无效');
    clearTimeout(timer.current); dirty.current = false; clearEditorRecovery(artifact.id);
    value.current = content; version.current = latest.version; editor?.commands.setContent(content.doc, { emitUpdate: false }); artifacts.upsertArtifact(latest); setError(''); setStatus('已保存');
  }
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-1 border-b border-line p-2" aria-label="文档格式">
      <Button size="icon-sm" variant="ghost" title="加粗" aria-label="加粗" disabled={!editor || busy || Boolean(activeReview)} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold /></Button>
      <Button size="icon-sm" variant="ghost" title="斜体" aria-label="斜体" disabled={!editor || busy || Boolean(activeReview)} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic /></Button>
      <Button size="sm" variant="ghost" disabled={!editor || busy || Boolean(activeReview)} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>标题</Button>
      <Button size="icon-sm" variant="ghost" aria-label="项目列表" disabled={!editor || busy || Boolean(activeReview)} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List /></Button>
      <Button size="icon-sm" variant="ghost" aria-label="编号列表" disabled={!editor || busy || Boolean(activeReview)} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered /></Button>
      <Button size="icon-sm" variant="ghost" aria-label="插入表格" disabled={!editor || busy || Boolean(activeReview)} onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table /></Button>
      <Button size="icon-sm" variant="ghost" aria-label="撤销" disabled={!editor || busy || Boolean(activeReview)} onClick={() => editor?.chain().focus().undo().run()}><Undo2 /></Button>
      <Button size="icon-sm" variant="ghost" aria-label="重做" disabled={!editor || busy || Boolean(activeReview)} onClick={() => editor?.chain().focus().redo().run()}><Redo2 /></Button>
      <span role="status" className="ml-auto text-xs text-ink-muted">{status} · v{version.current}</span>
      <Button size="icon-sm" variant="ghost" aria-label="文档版本历史" disabled={busy} onClick={() => void act(async () => { setHistory(true); })}><History /></Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(async () => { download(await api.exportDocument(artifact.id), `${artifact.name.replace(/\.docx$/i, '')}.docx`); })}><Download data-icon="inline-start" />导出</Button>
    </div>
    <div className="flex items-center gap-2 border-b border-line p-2">
      <Button size="xs" variant="outline" disabled={busy || !selection || Boolean(activeReview)} onClick={() => { const selected = selection; void act(async () => { referenceDocument(artifact.sessionId, { artifactId: artifact.id, name: artifact.name, version: version.current, selection: selected }); }); }}><Quote data-icon="inline-start" />引用选段</Button>
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => void act(async () => { referenceDocument(artifact.sessionId, { artifactId: artifact.id, name: artifact.name, version: version.current }); })}>引用全文</Button>
      <span className="text-xs text-ink-muted">{selection ? `已选 ${selection.end - selection.start} 个字符` : '选中一段文字，交给 AI 修改'}</span>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}<div className="mt-2 flex gap-2"><Button size="xs" variant="outline" onClick={() => void flush().catch((): void => { /* Error is shown by the save/review handler. */ })}>重试保存</Button><Button size="xs" variant="outline" onClick={() => void recover().catch((cause) => setError(String(cause)))}>下载恢复副本并重新载入</Button></div></AlertDescription></Alert>}
    <div className="min-h-0 flex-1 overflow-auto">
      {value.current.importWarnings?.length ? <details className="px-4 pt-3 text-xs text-ink-muted"><summary>导入说明</summary>{value.current.importWarnings.map((warning, i) => <p key={i} className="mt-1">{warning}</p>)}{value.current.originalArtifactId && <Button size="xs" variant="link" onClick={() => { void api.artifactRawUrl(value.current.originalArtifactId!).then((url) => { const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${artifact.name}-原始.docx`; anchor.click(); }); }}>下载原始文件</Button>}</details> : null}
      <div className={activeReview ? 'hidden' : undefined}><EditorContent editor={editor} /></div>
      {activeReview && <DocumentReview key={activeReview.id} review={activeReview} otherBatches={pendingBatches - 1} busy={busy} decide={(review, ids, decision) => void decide(review, ids, decision)} revise={(review, change, text) => act(async () => {
        await api.reviseArtifactReview(artifact.id, review.id, change.id, review.reviewVersion, { ...(change.operation as object), text }); await refreshReviews();
      })} />}
      <ReviewLog reviews={reviews} />
    </div>
    {history && <ArtifactHistoryDialog artifact={{ ...artifact, version: version.current }} close={() => setHistory(false)} flush={flush} getVersion={() => version.current} render={(content) => <DocumentReadOnly content={content} />} restored={async () => {
      const latest = await api.getArtifact(artifact.id); const content = parseDocumentContent(latest.content);
      if (!content) throw new Error('文档格式无效');
      value.current = content; version.current = latest.version; dirty.current = false;
      editor?.commands.setContent(content.doc, { emitUpdate: false }); referenceDocument(artifact.sessionId); setSelection(undefined);
      artifacts.upsertArtifact(latest); await refreshReviews();
    }} />}
  </div>;
}
